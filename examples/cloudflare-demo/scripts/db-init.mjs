import { setTimeout as sleep } from 'node:timers/promises';
// Create the engine's tables in the demo's Postgres (`pnpm db:up` first). Idempotent: every
// statement is CREATE ... IF NOT EXISTS, so it is safe to run again.
import { renderPostgresDdl } from '@shware/workflow/store';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:pw@localhost:54320/workflow';
const sql = postgres(url, { max: 1 });
for (let attempt = 1; ; attempt++) {
  try {
    await sql`select 1`;
    break;
  } catch (error) {
    if (attempt === 30) throw error;
    await sleep(1000);
  }
}
await sql.unsafe(renderPostgresDdl());
await sql.end();
console.log(`tables ready at ${url}`);
