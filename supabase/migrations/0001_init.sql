create table public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null check (username = lower(username)),
  display_name text,
  avatar text,
  created_at timestamptz default now()
);
create table public.passkeys (
  id text primary key,
  user_id uuid not null references public.users on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  device_name text,
  created_at timestamptz default now(),
  last_used_at timestamptz
);
create index passkeys_user_id_idx on public.passkeys(user_id);
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  kind text not null check (kind in ('register', 'login', 'add')),
  user_id uuid,
  username text,
  expires_at timestamptz not null
);
create index challenges_expires_at_idx on public.challenges(expires_at);
create table public.kv (
  user_id uuid not null references public.users on delete cascade,
  collection text not null,
  key text not null,
  data jsonb,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  primary key (user_id, collection, key)
);
create index kv_user_updated_at_idx on public.kv(user_id, updated_at, collection, key);
alter table public.users enable row level security;
alter table public.passkeys enable row level security;
alter table public.challenges enable row level security;
alter table public.kv enable row level security;
-- No policies. Only the Edge Function's service role may access these tables.
revoke all on public.users, public.passkeys, public.challenges, public.kv from anon, authenticated;
grant all on public.users, public.passkeys, public.challenges, public.kv to service_role;

create function public.cleanup_challenges() returns void language sql set search_path = '' as $$
  delete from public.challenges where expires_at <= now();
$$;

create function public.sync_push(p_user_id uuid, p_items jsonb) returns void
language sql set search_path = '' as $$
  -- DISTINCT ON handles duplicate keys within a batch; first item wins timestamp ties.
  insert into public.kv as kv (user_id, collection, key, data, updated_at, deleted)
  select p_user_id, collection, key, data, updated_at, deleted from (
    select distinct on (x->>'collection', x->>'key')
      x->>'collection' as collection, x->>'key' as key, x->'data' as data,
      (x->>'updated_at')::timestamptz as updated_at,
      coalesce((x->>'deleted')::boolean, false) as deleted
    from jsonb_array_elements(p_items) with ordinality as items(x, ordinal)
    order by x->>'collection', x->>'key', (x->>'updated_at')::timestamptz desc, ordinal
  ) incoming
  on conflict (user_id, collection, key) do update
  set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
  where excluded.updated_at > kv.updated_at;
$$;

create function public.sync_pull(p_user_id uuid, p_since timestamptz default null, p_cursor jsonb default null)
returns jsonb language sql stable set search_path = '' as $$
  with candidates as (
    select collection, key, data, updated_at, deleted from public.kv
    where user_id = p_user_id and (p_since is null or updated_at > p_since)
      and (p_cursor is null or (updated_at, collection, key) >
        ((p_cursor->>'updated_at')::timestamptz, p_cursor->>'collection', p_cursor->>'key'))
    order by updated_at, collection, key limit 2001
  ), page as (
    select * from candidates order by updated_at, collection, key limit 2000
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by updated_at, collection, key) from page p), '[]'::jsonb),
    'more', (select count(*) > 2000 from candidates),
    'now', statement_timestamp(),
    'cursor', (select jsonb_build_object('updated_at', updated_at, 'collection', collection, 'key', key)
      from page order by updated_at desc, collection desc, key desc limit 1)
  );
$$;

-- Serialize registration/addition/removal on the user row. A race cannot replace an account's first passkey.
create function public.save_passkey(p_user_id uuid, p_username text, p_profile jsonb, p_credential jsonb, p_register boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare u public.users;
begin
  if p_register then
    insert into public.users(id, username, display_name, avatar)
      values (p_user_id, p_username, p_profile->>'name', p_profile->>'avatar')
      on conflict (username) do nothing;
    select * into u from public.users where username = p_username for update;
    if u.id <> p_user_id or exists(select 1 from public.passkeys where user_id = u.id) then
      raise exception 'exists' using errcode = 'P0001';
    end if;
  else
    select * into u from public.users where id = p_user_id for update;
  end if;
  if u.id is null then raise exception 'not_found'; end if;
  insert into public.passkeys(id, user_id, public_key, counter, transports, device_name)
    values (p_credential->>'id', u.id, p_credential->>'public_key', (p_credential->>'counter')::bigint,
      array(select jsonb_array_elements_text(p_credential->'transports')), p_credential->>'device_name');
  return jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar', u.avatar);
end;
$$;
create function public.remove_passkey(p_user_id uuid, p_id text) returns text
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.users where id = p_user_id for update;
  if not exists(select 1 from public.passkeys where user_id = p_user_id and id = p_id) then return 'not_found'; end if;
  if (select count(*) from public.passkeys where user_id = p_user_id) <= 1 then return 'last_passkey'; end if;
  delete from public.passkeys where user_id = p_user_id and id = p_id;
  return 'ok';
end;
$$;
revoke all on function public.cleanup_challenges(), public.sync_push(uuid, jsonb),
  public.sync_pull(uuid, timestamptz, jsonb), public.save_passkey(uuid, text, jsonb, jsonb, boolean),
  public.remove_passkey(uuid, text) from public, anon, authenticated;
grant execute on function public.cleanup_challenges(), public.sync_push(uuid, jsonb),
  public.sync_pull(uuid, timestamptz, jsonb), public.save_passkey(uuid, text, jsonb, jsonb, boolean),
  public.remove_passkey(uuid, text) to service_role;
