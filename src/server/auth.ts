import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { AppError } from "./errors";
import type { Role } from "@/lib/constants";

const SESSION_COOKIE = "erp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 Tage

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) throw new AppError("E-Mail oder Passwort ist falsch.");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError("E-Mail oder Passwort ist falsch.");

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { id: hashToken(token), userId: user.id, expiresAt } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
  return user;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { id: hashToken(token) } });
    jar.delete(SESSION_COOKIE);
  }
}

/** Aktueller Benutzer oder null. Pro Request gecacht. */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
});

/** Erzwingt eingeloggten Benutzer, sonst Redirect auf /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

const ROLE_RANK: Record<string, number> = { READONLY: 0, STAFF: 1, ADMIN: 2 };

/** Serverseitige Berechtigungsprüfung – wirft verständlichen Fehler. */
export async function requireRole(minRole: Role) {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Nicht angemeldet.");
  if ((ROLE_RANK[user.role] ?? -1) < ROLE_RANK[minRole]) {
    throw new AppError("Keine Berechtigung für diese Aktion.");
  }
  return user;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
