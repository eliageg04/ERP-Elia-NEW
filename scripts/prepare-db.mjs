/**
 * Wird vor `next build` ausgeführt und wählt die richtige Datenbank:
 * - DATABASE_URL beginnt mit "file:"      → SQLite (lokale Entwicklung)
 * - DATABASE_URL beginnt mit "postgres"   → PostgreSQL (Vercel/Neon)
 *
 * Im Postgres-Modus wird aus prisma/schema.prisma automatisch eine
 * Postgres-Variante erzeugt (nur der Provider wird getauscht – das
 * Datenmodell ist identisch), das Schema per `db push` angewendet und
 * die Grunddaten (Einheiten + Admin) idempotent angelegt.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? "";
const isPostgres = url.startsWith("postgres");

function run(cmd, extraEnv = {}) {
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

if (isPostgres) {
  console.log("Datenbank-Modus: PostgreSQL (Vercel/Neon)");
  const schema = readFileSync("prisma/schema.prisma", "utf8").replace(
    'provider = "sqlite"',
    'provider = "postgresql"'
  );
  if (!schema.includes('provider = "postgresql"')) {
    console.error("Konnte den Datenbank-Provider im Schema nicht umstellen.");
    process.exit(1);
  }
  writeFileSync("prisma/schema.postgres.prisma", schema);

  // Für Schema-Änderungen die ungepoolte Direktverbindung nutzen (Neon/Vercel)
  const directUrl =
    process.env.DIRECT_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    url;

  run("npx prisma generate --schema prisma/schema.postgres.prisma");
  run("npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate", {
    DATABASE_URL: directUrl,
  });
  run("npx tsx scripts/bootstrap.ts", { DATABASE_URL: directUrl });
} else {
  console.log("Datenbank-Modus: SQLite (lokal)");
  if (!existsSync(".env")) run("node scripts/setup.mjs");
  run("npx prisma generate");
}
