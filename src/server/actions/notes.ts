"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { runAction, str } from "./helpers";
import type { ActionState } from "@/components/form";

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const entityType = str(formData, "entityType");
    const entityId = str(formData, "entityId");
    const body = str(formData, "body");
    if (!body) throw new AppError("Die Notiz darf nicht leer sein.");
    if (!entityType || !entityId) throw new AppError("Ungültiger Bezug für die Notiz.");
    await db.note.create({
      data: { entityType, entityId, body, authorId: user.id },
    });
  });
}
