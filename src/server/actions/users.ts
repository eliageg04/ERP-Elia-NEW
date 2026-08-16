"use server";

import { db } from "../db";
import { requireRole, hashPassword } from "../auth";
import { AppError } from "../errors";
import { writeAudit } from "../audit";
import { ROLES } from "@/lib/constants";
import { runAction, str } from "./helpers";
import type { ActionState } from "@/components/form";

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireRole("ADMIN");
    const name = str(formData, "name");
    const email = str(formData, "email").toLowerCase();
    const password = String(formData.get("password") ?? "");
    const role = str(formData, "role");
    if (!name || !email) throw new AppError("Name und E-Mail sind erforderlich.");
    if (password.length < 8) throw new AppError("Das Passwort muss mindestens 8 Zeichen lang sein.");
    if (!ROLES.includes(role as (typeof ROLES)[number])) throw new AppError("Ungültige Rolle.");
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new AppError("Ein Benutzer mit dieser E-Mail existiert bereits.");
    const user = await db.user.create({
      data: { name, email, passwordHash: await hashPassword(password), role },
    });
    await writeAudit({
      userId: admin.id,
      entityType: "USER",
      entityId: user.id,
      action: "CREATE",
      comment: `Benutzer ${name} (${role}) angelegt`,
    });
  });
}

export async function setUserRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireRole("ADMIN");
    const id = str(formData, "id");
    const role = str(formData, "role");
    if (!ROLES.includes(role as (typeof ROLES)[number])) throw new AppError("Ungültige Rolle.");
    if (id === admin.id && role !== "ADMIN") {
      throw new AppError("Du kannst deine eigene Admin-Rolle nicht entfernen.");
    }
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    await db.user.update({ where: { id }, data: { role } });
    await writeAudit({
      userId: admin.id,
      entityType: "USER",
      entityId: id,
      action: "UPDATE",
      changes: [{ field: "role", old: user.role, new: role }],
    });
  });
}

export async function toggleUserActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireRole("ADMIN");
    const id = str(formData, "id");
    if (id === admin.id) throw new AppError("Du kannst dich nicht selbst deaktivieren.");
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    await db.user.update({ where: { id }, data: { active: !user.active } });
    if (user.active) {
      // Sitzungen des deaktivierten Benutzers beenden
      await db.session.deleteMany({ where: { userId: id } });
    }
    await writeAudit({
      userId: admin.id,
      entityType: "USER",
      entityId: id,
      action: "UPDATE",
      changes: [{ field: "active", old: user.active, new: !user.active }],
    });
  });
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireRole("ADMIN");
    const id = str(formData, "id");
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) throw new AppError("Das Passwort muss mindestens 8 Zeichen lang sein.");
    await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    // Bestehende Sitzungen ungültig machen
    await db.session.deleteMany({ where: { userId: id } });
    await writeAudit({
      userId: admin.id,
      entityType: "USER",
      entityId: id,
      action: "UPDATE",
      comment: "Passwort zurückgesetzt",
    });
  });
}
