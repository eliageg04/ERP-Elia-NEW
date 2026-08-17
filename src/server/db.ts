import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Datenbank-URL auflösen: lokal SQLite (file:…), auf Vercel PostgreSQL.
 * Bei Neons gepoolter Verbindung (Hostname enthält "-pooler") werden die
 * für Prisma nötigen PgBouncer-Parameter ergänzt, falls sie fehlen.
 */
function resolveDbUrl(): string | undefined {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (url?.startsWith("postgres") && url.includes("-pooler") && !url.includes("pgbouncer")) {
    return url + (url.includes("?") ? "&" : "?") + "pgbouncer=true&connection_limit=1";
  }
  return url;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolveDbUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
