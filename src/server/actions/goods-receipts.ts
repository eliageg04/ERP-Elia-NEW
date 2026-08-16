"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit } from "../audit";
import { postGoodsReceipt } from "../services/purchasing";
import { runAction, str, optStr, num, optNum, optDate } from "./helpers";
import type { ActionState } from "@/components/form";

/**
 * Bucht einen Wareneingang zu einer Bestellung.
 * Liest pro Bestellzeile die Formularfelder recv_<poLineId>, dmg_<poLineId>,
 * miss_<poLineId> und note_<poLineId> aus und übergibt sie an den
 * Einkaufs-Service (postGoodsReceipt), der Bestand, Chargen, Sendungs- und
 * Bestellstatus fortschreibt.
 */
export async function postGoodsReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");

    const purchaseOrderId = str(formData, "purchaseOrderId");
    if (!purchaseOrderId) throw new AppError("Keine Bestellung angegeben.");

    const shipmentId = optStr(formData, "shipmentId");
    const receivedAt = optDate(formData, "receivedAt");
    const packageCountRaw = optNum(formData, "packageCount");
    const packageCount = packageCountRaw === null ? null : Math.round(packageCountRaw);
    if (packageCount !== null && packageCount < 0) {
      throw new AppError("Die Paketanzahl darf nicht negativ sein.");
    }

    if (shipmentId) {
      const shipment = await db.inboundShipment.findUnique({ where: { id: shipmentId } });
      if (!shipment || shipment.purchaseOrderId !== purchaseOrderId) {
        throw new AppError("Die gewählte Sendung gehört nicht zu dieser Bestellung.");
      }
    }

    // Zeilen einsammeln: recv_<poLineId> ist das Leitfeld je Position.
    const items: Array<{
      poLineId: string;
      qtyReceived: number;
      qtyDamaged: number;
      qtyMissing: number;
      note?: string;
    }> = [];
    const seen = new Set<string>();
    for (const key of Array.from(formData.keys())) {
      if (!key.startsWith("recv_")) continue;
      const poLineId = key.slice("recv_".length);
      if (!poLineId || seen.has(poLineId)) continue;
      seen.add(poLineId);

      const qtyReceived = Math.round(num(formData, `recv_${poLineId}`));
      const qtyDamaged = Math.round(optNum(formData, `dmg_${poLineId}`) ?? 0);
      const qtyMissing = Math.round(optNum(formData, `miss_${poLineId}`) ?? 0);
      if (qtyReceived < 0 || qtyDamaged < 0 || qtyMissing < 0) {
        throw new AppError("Mengen dürfen nicht negativ sein.");
      }
      items.push({
        poLineId,
        qtyReceived,
        qtyDamaged,
        qtyMissing,
        note: optStr(formData, `note_${poLineId}`) ?? undefined,
      });
    }

    const receipt = await postGoodsReceipt({
      purchaseOrderId,
      shipmentId,
      receivedAt: receivedAt ?? undefined,
      packageCount,
      items,
      userId: user.id,
    });

    await writeAudit({
      userId: user.id,
      entityType: "GOODS_RECEIPT",
      entityId: receipt.id,
      action: "CREATE",
      comment: `Wareneingang ${receipt.receiptNumber} gebucht`,
    });

    return { redirect: `/purchase-orders/${purchaseOrderId}` };
  });
}
