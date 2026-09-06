import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Health-Check: prüft die Datenbankverbindung und den Einrichtungsstand.
 * Gibt keine sensiblen Daten aus (keine URLs, keine Zugangsdaten).
 */
export async function GET() {
  const rawUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? "";
  const info: Record<string, unknown> = {
    dbUrlScheme: rawUrl ? rawUrl.split(":")[0] : "NICHT GESETZT",
    dbUrlIsPooler: rawUrl.includes("-pooler"),
    hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    hasAdminEnv: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD),
    // Diagnose Passwort-Reset (Wert ist nur true/false o.ä., nicht sensibel)
    resetFlag: (process.env.ADMIN_PASSWORD_RESET ?? "").trim().slice(0, 10) || "nicht gesetzt",
    runtime: process.env.VERCEL ? "vercel" : "lokal",
  };
  try {
    const [users, units] = await Promise.all([db.user.count(), db.unit.count()]);
    info.db = "ok";
    info.users = users;
    info.units = units;
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
    if (adminEmail) {
      info.adminEmailUserExists = Boolean(await db.user.findUnique({ where: { email: adminEmail } }));
    }
    const lastReset = await db.auditLog.findFirst({
      where: { comment: { contains: "Deployment-Reset" } },
      orderBy: { createdAt: "desc" },
    });
    info.lastPasswordReset = lastReset ? lastReset.createdAt.toISOString() : null;
  } catch (err) {
    const e = err as Error & { code?: string };
    info.db = "FEHLER";
    info.errorName = e.name;
    info.errorCode = e.code ?? null;
    info.errorMessage = String(e.message ?? "").replace(/postgres(ql)?:\/\/[^\s"']+/gi, "<url>").slice(0, 400);
  }
  return NextResponse.json(info);
}
