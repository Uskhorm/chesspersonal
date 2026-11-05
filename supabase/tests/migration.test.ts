// Optional embedded PostgreSQL verification; does not require Docker or a Supabase account.
import { PGlite } from 'npm:@electric-sql/pglite@0.3';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
Deno.test('migration: RLS, privileges, atomic passkey operations, LWW and cursor pagination', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await pg.exec(await Deno.readTextFile(new URL('../migrations/0001_init.sql', import.meta.url)));
    const rows = (await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('users','passkeys','challenges','kv') and relnamespace = 'public'::regnamespace",
    )).rows;
    assert(rows.length === 4 && rows.every(r => r.relrowsecurity), 'All tables must enable RLS');
    assert((await pg.query('select * from pg_policies where schemaname = $1', ['public'])).rows.length === 0, 'No RLS policies');
    const privileges = (await pg.query<{ table_access: boolean; rpc_access: boolean }>(
      "select has_table_privilege('anon', 'public.kv', 'SELECT') as table_access, has_function_privilege('authenticated', 'public.sync_push(uuid,jsonb)', 'EXECUTE') as rpc_access",
    )).rows[0];
    assert(!privileges.table_access && !privileges.rpc_access, 'Untrusted roles cannot access data or RPCs');
    const id = '0b968ec8-c707-4d38-97e3-ea737e91064d';
    const credential = (key: string) => JSON.stringify({ id: key, public_key: 'YQ', counter: 0, transports: ['internal'] });
    await pg.query('select public.save_passkey($1,$2,$3,$4,true)', [id, 'tester', '{"name":"Tester"}', credential('first')]);
    let duplicateRejected = false;
    try { await pg.query('select public.save_passkey($1,$2,$3,$4,true)', [id, 'tester', '{}', credential('attacker')]); }
    catch { duplicateRejected = true; }
    assert(duplicateRejected, 'Registration cannot claim an existing account');
    const remove = async (key: string) => (await pg.query<{ status: string }>('select public.remove_passkey($1,$2) as status', [id, key])).rows[0].status;
    assert(await remove('first') === 'last_passkey', 'Must retain the last passkey');
    await pg.query('select public.save_passkey($1,$2,$3,$4,false)', [id, 'tester', '{}', credential('second')]);
    assert(await remove('first') === 'ok', 'Remove one of multiple passkeys');
    assert(await remove('first') === 'not_found', 'Missing passkeys return not_found');

    const push = async (items: unknown[]) => await pg.query('select public.sync_push($1,$2)', [id, JSON.stringify(items)]);
    const item = { collection: 'games', key: 'one', data: { score: 1 }, updated_at: '2026-11-05T10:00:00.000001Z' };
    await push([item, { ...item, data: { score: 99 } }, { ...item, updated_at: '2026-11-05T10:00:00Z', data: null }]);
    await push([{ ...item, data: { score: 50 } }, { ...item, updated_at: '2026-11-04T10:00:00Z' }]);
    const stored = (await pg.query<{ data: { score: number } }>('select data from public.kv where user_id=$1', [id])).rows[0];
    assert(stored.data.score === 1, 'LWW rejects older writes and ties, including microseconds');
    await push([{ ...item, data: null, deleted: true, updated_at: '2026-11-05T10:00:00.000002Z' }]);
    assert((await pg.query<{ deleted: boolean }>('select deleted from public.kv where user_id=$1', [id])).rows[0].deleted, 'Tombstones survive');
    await pg.exec('delete from public.kv');
    await pg.query(`insert into public.kv(user_id,collection,key,data,updated_at)
      select $1, 'games', lpad(i::text, 5, '0'), '{}'::jsonb, '2026-11-05T10:00:00.000001Z'::timestamptz from generate_series(1,2001) i`, [id]);
    type Page = { items: { key: string }[]; more: boolean; cursor: unknown };
    const pull = async (cursor: unknown) => (await pg.query<{ page: Page }>('select public.sync_pull($1,null,$2) as page', [id, cursor ? JSON.stringify(cursor) : null])).rows[0].page;
    const first = await pull(null);
    assert(first.items.length === 2000 && first.more, 'Page cap and more flag');
    const second = await pull(first.cursor);
    assert(second.items.length === 1 && !second.more && second.items[0].key === '02001', 'Equal timestamps paginate without loss');
    const other = 'de35e6a8-c707-4d38-97e3-ea737e91064d';
    assert((await pg.query<{ page: Page }>('select public.sync_pull($1) as page', [other])).rows[0].page.items.length === 0, 'User isolation');
    await pg.query("insert into public.challenges(challenge,kind,expires_at) values ('old','login',now()-interval '1 minute'),('new','login',now()+interval '1 minute')");
    await pg.query('select public.cleanup_challenges()');
    assert((await pg.query<{ challenge: string }>('select challenge from public.challenges')).rows[0].challenge === 'new', 'Expired challenge cleanup');
  } finally { await pg.close(); }
});
