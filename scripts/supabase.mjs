// Database tasks through the Supabase Management API, using the local-only values in .env.local.
// Works on any OS and needs only a project-scoped access token (Database read and write).
//   node scripts/supabase.mjs migrate   apply supabase/migrations/*.sql not yet applied
//   node scripts/supabase.mjs types     write src/lib/database.types.ts
//   node scripts/supabase.mjs status    list applied migrations
// Applied migrations are recorded in supabase_migrations.schema_migrations, the table the
// Supabase CLI uses, so `supabase db push` would see them as applied. Never prints secrets.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

if (!existsSync('.env.local')) fail('No .env.local. Copy .env.example to .env.local and fill it in.');
process.loadEnvFile('.env.local');
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) fail('.env.local needs SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN.');

const api = `https://api.supabase.com/v1/projects/${ref}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function call(path, init) {
  const res = await fetch(api + path, { headers, ...init });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? ' The access token may have expired: generate a new one (Account → Access Tokens).' : '';
    fail(`Supabase API ${res.status}: ${text}${hint}`);
  }
  return text;
}

const sql = async query => JSON.parse(await call('/database/query', { method: 'POST', body: JSON.stringify({ query }) }));
const literal = s => `'${s.replaceAll("'", "''")}'`;

async function applied() {
  await sql(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  return new Set((await sql('select version from supabase_migrations.schema_migrations')).map(r => r.version));
}

const files = () => readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort();
const parse = f => { const [, version, name] = f.match(/^(\d+)_(.+)\.sql$/); return { version, name }; };

const command = process.argv[2];
if (command === 'migrate') {
  const done = await applied();
  const pending = files().filter(f => !done.has(parse(f).version));
  if (!pending.length) console.log('Database is up to date.');
  for (const f of pending) {
    const { version, name } = parse(f);
    const body = readFileSync(`supabase/migrations/${f}`, 'utf8');
    // One request = one transaction: the migration and its record commit together or not at all.
    await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, name, statements)
      values (${literal(version)}, ${literal(name)}, array[${literal(body)}]);\ncommit;`);
    console.log(`Applied ${f}`);
  }
} else if (command === 'status') {
  const done = await applied();
  for (const f of files()) console.log(done.has(parse(f).version) ? 'applied ' : 'pending ', f);
} else if (command === 'types') {
  const { types } = JSON.parse(await call('/types/typescript?included_schemas=public'));
  writeFileSync('src/lib/database.types.ts', types);
  console.log('Wrote src/lib/database.types.ts');
} else {
  fail('Usage: node scripts/supabase.mjs migrate | status | types');
}
