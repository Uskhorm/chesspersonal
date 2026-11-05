# Hindsight API

One Supabase Edge Function. It uses custom HS256 sessions, not Supabase Auth JWTs.
Database RLS is enabled without policies; tables and RPCs are available only to the service role.

## Environment and deployment

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: provided automatically by Supabase. Never expose the service role key to the client.
- `SESSION_SECRET`: at least 32 random bytes of secret material. Sessions last 60 days. Rotation invalidates existing sessions.
- `ALLOWED_ORIGINS`: comma-separated exact origins, without trailing slashes. Example: `https://uskhorm.github.io,http://localhost:5199,http://localhost:5173`.

Run from the repository root after logging in and linking your Supabase project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set SESSION_SECRET=YOUR_RANDOM_SECRET ALLOWED_ORIGINS=https://YOUR_FRONTEND_ORIGIN,http://localhost:5173
supabase functions deploy api --no-verify-jwt
```

Supply actual secret values through your secret manager or a protected local env file; avoid shared shell history. No secrets are checked in.
Set the frontend `VITE_API_URL` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/api`.
The router also accepts `/api/...` and unmounted paths for local invocation.

## Routes

Every request must have an allowed `Origin`. Authenticated requests also require `Authorization: Bearer <token>`.
POST bodies and responses are JSON. Errors have `{error: string}` and appropriate HTTP status codes.
`user = {id, username, display_name, avatar}`.

| Method/path | Body | Success |
| --- | --- | --- |
| POST `/auth/register/options` | `{username}` | `{challengeId, options}` |
| POST `/auth/register/verify` | `{challengeId, response, deviceName?}` | `{token, user}` |
| POST `/auth/login/options` | `{}` | `{challengeId, options}` |
| POST `/auth/login/verify` | `{challengeId, response}` | `{token, user}` |
| POST `/auth/passkeys/options` | `{}` | `{challengeId, options}` |
| POST `/auth/passkeys/verify` | `{challengeId, response, deviceName?}` | `{ok:true}` |
| GET `/auth/passkeys` | — | `[{id, device_name, created_at, last_used_at}]` |
| DELETE `/auth/passkeys/:id` | — | `{ok:true}`; 409 `last_passkey` if only one remains |
| GET `/me` | — | `{user}` |
| POST `/sync/pull` | `{since?: ISO, cursor?: string}` | `{items, now, more, cursor: string|null}` |
| POST `/sync/push` | `{items}` | `{ok:true, now}` |

`SyncItem = {collection: string, key: string, data: unknown, updated_at: ISO, deleted?: boolean}`.
Push accepts at most 200 items, and all POST bodies have a streaming 4 MiB limit (413 on overflow).
Timestamps require a timezone and accept up to six fractional digits. LWW uses a single SQL INSERT/ON CONFLICT with a strict timestamp comparison. Equal timestamps retain the stored value; duplicate batch keys choose the newest item, with the first winning ties. Tombstones remain until overwritten by a newer value.

Pull orders by `(updated_at, collection, key)` and returns at most 2000 items. While `more` is true, retain the original `since` and pass the returned opaque `cursor` on the next call. Do not advance `since` to `now` between pages. The cursor preserves microseconds and disambiguates equal timestamps. After finishing, retain the last item timestamp as the next incremental watermark; replay a small overlap when concurrent writes or device clock skew are possible. `now` is a server observation time, not a guarantee that future pushes cannot carry older timestamps. An idle pull returns an empty array, `more:false`, and `cursor:null`.

## Passkey behavior

Registration validates a lowercase chess.com username against the public profile API and copies its name/avatar. A public profile does **not** prove ownership of the chess.com account; the first passkey claims the Hindsight username, as required by the architecture. A profile 404 yields 400 `not_found`; an already registered username yields 409 `exists`.
WebAuthn uses `rpName=Hindsight`, the allowed Origin hostname as RP ID, discoverable resident credentials, and preferred user verification. Verification accepts user-presence-only authenticators consistently with that preference. An RP hostname change requires new passkeys; different localhost ports share an RP ID but challenges remain bound to the exact origin.

Challenges expire in five minutes, bind the operation and origin (and the user for add-passkey), and are atomically deleted before verification. A failed verification requires fresh options. The `challenge` text column stores an internal JSON envelope containing the challenge and its origin. Expired entries are cleaned during auth calls; `select public.cleanup_challenges();` can also run from a privileged scheduler.
Registration and passkey removal serialize on the user row so concurrent requests cannot replace the first credential or remove every credential. Login verifies the signature, origin, RP ID, user handle when supplied, and counter before issuing a token. Credential IDs/public keys are base64url text. No password recovery or server-side session revocation is specified; deleting a passkey does not invalidate sessions it previously issued.

## Checks

```sh
npx vitest run supabase/functions/api/lib.test.ts
npx -y deno@2 check --config supabase/functions/api/deno.json supabase/functions/api/index.ts
npx -y deno@2 test --config supabase/functions/api/deno.json --allow-read --allow-env supabase/tests/migration.test.ts
```

`deno.json` disables local node_modules and lockfile writes so npm specifiers resolve through Deno's cache without editing the app's dependencies. The explicit `--config` is needed when running from the Node app root.
Unit tests cover portable JWT, base64url, exact CORS matching, path parsing, timestamp validation, and LWW semantics. The optional migration test uses `npm:@electric-sql/pglite@0.3` from Deno's cache (no app dependency changes) to execute the SQL against embedded PostgreSQL and check permissions, first-passkey protection, last-passkey protection, LWW/tombstones, cleanup, user isolation and equal-timestamp pagination. Hosted Supabase/PostgREST integration and browser authenticator ceremonies still require a linked/local Supabase instance and allowed HTTPS frontend (localhost is supported for development).
Production abuse controls (rate limiting on anonymous auth/chess.com calls) should be configured at the gateway before public launch.
