import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Datenbank-URL auflösen: lokal SQLite (file:…), auf Vercel PostgreSQL.
 * Bei Neons gepoolter Verbindung (Hostname enthält "-pooler") werden die
 * für Prisma nötigen PgBouncer-Parameter ergänzt, falls sie fehlen.
 */
function resolveDbUrl(): string | undefined {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (!url?.startsWith("postgres")) return url;
  const extra: string[] = [];
  // PgBouncer-Modus (Neon-Pooler): Prepared Statements deaktivieren
  if (!url.includes("pgbouncer")) extra.push("pgbouncer=true");
  // Serverless: eine Verbindung pro Funktion
  if (!url.includes("connection_limit")) extra.push("connection_limit=1");
  // Neon-Kaltstart kann einige Sekunden dauern
  if (!url.includes("connect_timeout")) extra.push("connect_timeout=15");
  if (extra.length === 0) return url;
  return url + (url.includes("?") ? "&" : "?") + extra.join("&");
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolveDbUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
