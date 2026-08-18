"use server";

import { requireRole } from "../auth";
import { AppError } from "../errors";
import { syncLexwarePurchaseInvoices } from "../services/lexware";
import { runAction } from "./helpers";
import type { ActionState } from "@/components/form";

export async function syncLexwareAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const result = await syncLexwarePurchaseInvoices(user.id);
    if (result.imported === 0) {
      // Einziger Rückkanal für eine Meldung – informativ, kein echter Fehler
      throw new AppError(
        `Keine neuen Belege gefunden. ${result.skipped} von ${result.totalSeen} Belegen waren bereits importiert.`
      );
    }
    return { redirect: "/imports" };
  });
}
