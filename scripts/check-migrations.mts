// Applies every top-level migration in order on an empty database, as a fresh deployment would.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key); create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid,bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
const files = readdirSync('supabase/migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of files) await db.exec(readFileSync('supabase/migrations/' + f, 'utf8').replace(/create extension[^;]+;/g, ''));
const fns = (await db.query<{ n: string }>(`select proname n from pg_proc where pronamespace='public'::regnamespace order by 1`)).rows.map((r) => r.n);
console.log(`PASS: ${files.length} migrations (${files[0]}..${files[files.length - 1]}) apply in order on an empty database; ${fns.length} public functions.`);
