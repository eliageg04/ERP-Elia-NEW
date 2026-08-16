"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, writeEvent, diffChanges } from "../audit";
import { nextNumber } from "../numbering";
import {
  getPoLineStats,
  recomputePoStatus,
  createInboundShipment,
  recomputeLandedCosts,
} from "../services/purchasing";
import { addCost } from "../services/finance";
import { runAction, str, optStr, num, optNum, optDate } from "./helpers";
import {
  CURRENCIES,
  PO_STATUSES,
  COST_TYPES,
  COST_ALLOCATION_METHODS,
  CARRIERS,
} from "@/lib/constants";
import type { ActionState } from "@/components/form";

// ---------- Kopf ----------

export async function createPurchaseOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const supplierId = str(formData, "supplierId");
    if (!supplierId) throw new AppError("Bitte einen Lieferanten wählen.");
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new AppError("Der gewählte Lieferant wurde nicht gefunden.");

    const currency = str(formData, "currency") || "EUR";
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      throw new AppError("Ungültige Währung – erlaubt sind EUR, USD und GBP.");
    }
    let fxRate = optNum(formData, "fxRate") ?? 1;
    if (currency === "EUR") fxRate = 1;
    if (!(fxRate > 0)) throw new AppError("Der Wechselkurs muss größer als 0 sein.");

    const orderNumber = await nextNumber("PO");
    const po = await db.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId,
        supplierOrderNumber: optStr(formData, "supplierOrderNumber"),
        status: "DRAFT",
        currency,
        fxRate,
        orderedAt: optDate(formData, "orderedAt"),
        expectedAt: optDate(formData, "expectedAt"),
      },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PURCHASE_ORDER",
      entityId: po.id,
      action: "CREATE",
      comment: `Bestellung ${orderNumber} bei ${supplier.name} angelegt (Entwurf)`,
    });
    return { redirect: `/purchase-orders/${po.id}` };
  });
}

export async function updatePoHeaderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const before = await db.purchaseOrder.findUniqueOrThrow({ where: { id } });
    if (before.status === "CANCELLED") {
      throw new AppError("Stornierte Bestellungen können nicht mehr bearbeitet werden.");
    }

    const supplierId = str(formData, "supplierId") || before.supplierId;
    const currency = str(formData, "currency") || before.currency;
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      throw new AppError("Ungültige Währung – erlaubt sind EUR, USD und GBP.");
    }
    let fxRate = optNum(formData, "fxRate") ?? before.fxRate;
    if (currency === "EUR") fxRate = 1;
    if (!(fxRate > 0)) throw new AppError("Der Wechselkurs muss größer als 0 sein.");

    const data = {
      supplierId,
      supplierOrderNumber: optStr(formData, "supplierOrderNumber"),
      currency,
      fxRate,
      orderedAt: optDate(formData, "orderedAt"),
      expectedAt: optDate(formData, "expectedAt"),
    };
    const changes = diffChanges(before as unknown as Record<string, unknown>, data);
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data });
      if (changes.length > 0) {
        await writeAudit(
          { userId: user.id, entityType: "PURCHASE_ORDER", entityId: id, action: "UPDATE", changes },
          tx
        );
        // Kurs-/Währungsänderungen wirken auf die Einstandspreise der Chargen
        await recomputeLandedCosts(tx, id);
      }
    });
    return { redirect: `/purchase-orders/${id}` };
  });
}

// ---------- Positionen ----------

export async function addPoLineAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const purchaseOrderId = str(formData, "purchaseOrderId");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
    if (po.status === "CANCELLED" || po.status === "COMPLETED") {
      throw new AppError("Zu stornierten oder abgeschlossenen Bestellungen können keine Positionen hinzugefügt werden.");
    }

    const productId = str(formData, "productId");
    if (!productId) throw new AppError("Bitte ein Produkt wählen.");
    const product = await db.product.findUniqueOrThrow({
      where: { id: productId },
      include: { conversions: true, baseUnit: true },
    });

    const enteredQty = Math.round(num(formData, "enteredQty"));
    if (enteredQty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");
    const enteredUnitId = str(formData, "enteredUnitId");
    if (!enteredUnitId) throw new AppError("Bitte eine Einheit wählen.");

    // Umrechnungsfaktor: manuell überschreibbar, sonst automatisch
    const manualFactor = optNum(formData, "unitFactor");
    let unitFactor: number;
    if (manualFactor !== null) {
      unitFactor = Math.round(manualFactor);
    } else if (enteredUnitId === product.baseUnitId) {
      unitFactor = 1;
    } else {
      const conv = product.conversions.find((c) => c.unitId === enteredUnitId);
      if (!conv) {
        throw new AppError(
          `Für diese Einheit ist bei „${product.name}“ keine Umrechnung hinterlegt – bitte den Faktor manuell angeben.`
        );
      }
      unitFactor = conv.factor;
    }
    if (unitFactor <= 0) throw new AppError("Der Umrechnungsfaktor muss größer als 0 sein.");

    const unitPriceCents = Math.round(num(formData, "unitPriceCents"));
    if (unitPriceCents < 0) throw new AppError("Der Preis darf nicht negativ sein.");
    const discountCents = Math.round(optNum(formData, "discountCents") ?? 0);
    if (discountCents < 0) throw new AppError("Der Rabatt darf nicht negativ sein.");

    const qtyOrdered = enteredQty * unitFactor;
    const lineTotalCents = enteredQty * unitPriceCents - discountCents;
    if (lineTotalCents < 0) {
      throw new AppError("Der Rabatt darf den Warenwert der Zeile nicht überschreiten.");
    }

    const maxPos = await db.purchaseOrderLine.aggregate({
      where: { purchaseOrderId },
      _max: { position: true },
    });
    const line = await db.purchaseOrderLine.create({
      data: {
        purchaseOrderId,
        productId,
        position: (maxPos._max.position ?? 0) + 1,
        enteredQty,
        enteredUnitId,
        unitFactor,
        qtyOrdered,
        unitPriceCents,
        discountCents,
        lineTotalCents,
      },
      include: { enteredUnit: true },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrderId,
      action: "CREATE",
      changes: [
        { field: "enteredQty", old: null, new: enteredQty },
        { field: "unitFactor", old: null, new: unitFactor },
        { field: "qtyOrdered", old: null, new: qtyOrdered },
        { field: "unitPriceCents", old: null, new: unitPriceCents },
      ],
      comment: `Position hinzugefügt: ${enteredQty} × ${line.enteredUnit.name} ${product.name}`,
    });
  });
}

export async function updatePoLineAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const lineId = str(formData, "lineId");
    const reason = str(formData, "reason");
    if (!reason) {
      throw new AppError("Bitte eine Begründung angeben – Korrekturen müssen nachvollziehbar sein.");
    }
    const line = await db.purchaseOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      include: { purchaseOrder: true, product: true },
    });
    if (line.purchaseOrder.status === "CANCELLED") {
      throw new AppError("Positionen stornierter Bestellungen können nicht geändert werden.");
    }

    const enteredQty = Math.round(num(formData, "enteredQty"));
    if (enteredQty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");
    const unitFactor = Math.round(num(formData, "unitFactor"));
    if (unitFactor <= 0) throw new AppError("Der Umrechnungsfaktor muss größer als 0 sein.");
    const unitPriceCents = Math.round(num(formData, "unitPriceCents"));
    if (unitPriceCents < 0) throw new AppError("Der Preis darf nicht negativ sein.");
    const discountCents = Math.round(optNum(formData, "discountCents") ?? 0);
    if (discountCents < 0) throw new AppError("Der Rabatt darf nicht negativ sein.");

    const qtyOrdered = enteredQty * unitFactor;
    const lineTotalCents = enteredQty * unitPriceCents - discountCents;
    if (lineTotalCents < 0) {
      throw new AppError("Der Rabatt darf den Warenwert der Zeile nicht überschreiten.");
    }

    // Integrität: neue Menge darf bereits versendete/angekommene Mengen nicht unterschreiten
    const stats = await getPoLineStats(line.purchaseOrderId);
    const s = stats.find((x) => x.poLineId === lineId);
    if (s && qtyOrdered < s.shipped) {
      throw new AppError(
        `Die neue Bestellmenge (${qtyOrdered}) liegt unter der bereits versendeten Menge (${s.shipped}).`
      );
    }
    if (s && qtyOrdered < s.arrived) {
      throw new AppError(
        `Die neue Bestellmenge (${qtyOrdered}) liegt unter der bereits angekommenen Menge (${s.arrived}).`
      );
    }

    const data = { enteredQty, unitFactor, qtyOrdered, unitPriceCents, discountCents, lineTotalCents };
    const changes = diffChanges(line as unknown as Record<string, unknown>, data);
    await db.$transaction(async (tx) => {
      await tx.purchaseOrderLine.update({ where: { id: lineId }, data });
      if (changes.length > 0) {
        await writeAudit(
          {
            userId: user.id,
            entityType: "PURCHASE_ORDER",
            entityId: line.purchaseOrderId,
            action: "CORRECTION",
            changes,
            comment: `${line.product.name}: ${reason}`,
          },
          tx
        );
        await recomputeLandedCosts(tx, line.purchaseOrderId);
        await recomputePoStatus(tx, line.purchaseOrderId, user.id);
      }
    });
  });
}

export async function deletePoLineAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const lineId = str(formData, "lineId");
    const line = await db.purchaseOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      include: {
        product: true,
        purchaseOrder: true,
        _count: { select: { shipmentItems: true, receiptItems: true } },
      },
    });
    if (line.purchaseOrder.status === "CANCELLED") {
      throw new AppError("Positionen stornierter Bestellungen können nicht gelöscht werden.");
    }
    if (line._count.shipmentItems > 0 || line._count.receiptItems > 0) {
      throw new AppError(
        "Die Position hat bereits Sendungen oder Wareneingänge und kann nicht gelöscht werden – bitte stattdessen die Menge korrigieren."
      );
    }
    await db.$transaction(async (tx) => {
      await tx.purchaseOrderLine.delete({ where: { id: lineId } });
      await writeAudit(
        {
          userId: user.id,
          entityType: "PURCHASE_ORDER",
          entityId: line.purchaseOrderId,
          action: "DELETE",
          comment: `Position entfernt: ${line.enteredQty} × ${line.product.name} (${line.qtyOrdered} Basiseinheiten)`,
        },
        tx
      );
      await recomputePoStatus(tx, line.purchaseOrderId, user.id);
    });
  });
}

// ---------- Statuswechsel ----------

export async function markOrderedAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const po = await db.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (po.status !== "DRAFT") {
      throw new AppError("Nur Entwürfe können als bestellt markiert werden.");
    }
    if (po.lines.length === 0) {
      throw new AppError("Die Bestellung hat noch keine Positionen – bitte zuerst Positionen erfassen.");
    }
    const totalUnits = po.lines.reduce((a, l) => a + l.qtyOrdered, 0);
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "ORDERED", orderedAt: po.orderedAt ?? new Date() },
      });
      await writeAudit(
        {
          userId: user.id,
          entityType: "PURCHASE_ORDER",
          entityId: id,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: "DRAFT", new: "ORDERED" }],
          comment: "Als bestellt markiert",
        },
        tx
      );
      await writeEvent(
        {
          type: "PURCHASE_ORDER_ORDERED",
          entityType: "PURCHASE_ORDER",
          entityId: id,
          summary: `Bestellung ${po.orderNumber} bei ${po.supplier.name} bestellt (${totalUnits} Einheiten)`,
          userId: user.id,
        },
        tx
      );
    });
  });
}

export async function markConfirmedAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const po = await db.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (po.status !== "ORDERED") {
      throw new AppError("Nur bestellte Bestellungen können als bestätigt markiert werden.");
    }

    // Optional: vom Lieferanten bestätigte Mengen je Zeile übernehmen
    const confirmed: Array<{ lineId: string; qty: number }> = [];
    for (const line of po.lines) {
      const raw = String(formData.get(`qtyConfirmed_${line.id}`) ?? "").trim();
      if (raw === "") continue;
      const qty = Math.round(Number(raw.replace(",", ".")));
      if (!isFinite(qty) || qty < 0) {
        throw new AppError("Ungültige bestätigte Menge – bitte eine Zahl ≥ 0 angeben.");
      }
      confirmed.push({ lineId: line.id, qty });
    }

    await db.$transaction(async (tx) => {
      for (const c of confirmed) {
        await tx.purchaseOrderLine.update({
          where: { id: c.lineId },
          data: { qtyConfirmed: c.qty },
        });
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CONFIRMED" } });
      await writeAudit(
        {
          userId: user.id,
          entityType: "PURCHASE_ORDER",
          entityId: id,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: "ORDERED", new: "CONFIRMED" }],
          comment:
            confirmed.length > 0
              ? `Vom Lieferanten bestätigt (${confirmed.length} Positionen mit bestätigter Menge)`
              : "Vom Lieferanten bestätigt",
        },
        tx
      );
      await writeEvent(
        {
          type: "PURCHASE_ORDER_CONFIRMED",
          entityType: "PURCHASE_ORDER",
          entityId: id,
          summary: `Bestellung ${po.orderNumber} von ${po.supplier.name} bestätigt`,
          userId: user.id,
        },
        tx
      );
    });
  });
}

export async function cancelPoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const po = await db.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { goodsReceipts: true } } },
    });
    if (po.status === "CANCELLED") throw new AppError("Die Bestellung ist bereits storniert.");
    if (po._count.goodsReceipts > 0) {
      throw new AppError(
        "Zu dieser Bestellung existieren bereits Wareneingänge – Stornieren ist nicht möglich."
      );
    }
    await db.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PURCHASE_ORDER",
      entityId: id,
      action: "STATUS_CHANGE",
      changes: [{ field: "status", old: po.status, new: "CANCELLED" }],
      comment: `Bestellung ${po.orderNumber} storniert`,
    });
  });
}

export async function overrideStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const status = str(formData, "status");
    const reason = str(formData, "reason");
    if (!(PO_STATUSES as readonly string[]).includes(status)) {
      throw new AppError("Ungültiger Status.");
    }
    if (!reason) {
      throw new AppError("Bitte eine Begründung angeben – manuelle Status müssen nachvollziehbar sein.");
    }
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id } });
    await db.purchaseOrder.update({
      where: { id },
      data: {
        status,
        statusOverridden: true,
        overrideReason: reason,
        ...(status === "CANCELLED" ? { cancelledAt: po.cancelledAt ?? new Date() } : {}),
      },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PURCHASE_ORDER",
      entityId: id,
      action: "STATUS_CHANGE",
      changes: [
        { field: "status", old: po.status, new: status },
        { field: "statusOverridden", old: po.statusOverridden, new: true },
      ],
      comment: `Manueller Status-Override: ${reason}`,
    });
  });
}

export async function clearOverrideAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id } });
    if (!po.statusOverridden) {
      throw new AppError("Für diese Bestellung ist kein manueller Status gesetzt.");
    }
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: { statusOverridden: false, overrideReason: null },
      });
      await writeAudit(
        {
          userId: user.id,
          entityType: "PURCHASE_ORDER",
          entityId: id,
          action: "UPDATE",
          changes: [{ field: "statusOverridden", old: true, new: false }],
          comment: "Status-Override aufgehoben – Status wird wieder automatisch berechnet",
        },
        tx
      );
      await recomputePoStatus(tx, id, user.id);
    });
  });
}

// ---------- Sendung melden ----------

export async function createShipmentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const purchaseOrderId = str(formData, "purchaseOrderId");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
    if (po.status === "DRAFT") {
      throw new AppError(
        "Für einen Entwurf kann keine Sendung gemeldet werden – Bestellung zuerst als „Bestellt“ markieren."
      );
    }

    const items: Array<{ poLineId: string; qty: number }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("shipQty_")) continue;
      const qty = Math.round(Number(String(value).replace(",", ".")));
      if (isFinite(qty) && qty > 0) {
        items.push({ poLineId: key.slice("shipQty_".length), qty });
      }
    }
    if (items.length === 0) {
      throw new AppError("Bitte mindestens eine Position mit Menge größer 0 erfassen.");
    }

    const carrier = optStr(formData, "carrier");
    if (carrier && !(CARRIERS as readonly string[]).includes(carrier)) {
      throw new AppError("Ungültiger Versanddienstleister.");
    }
    const packageCountRaw = optNum(formData, "packageCount");

    await createInboundShipment({
      purchaseOrderId,
      items,
      carrier,
      trackingNumber: optStr(formData, "trackingNumber"),
      packageCount: packageCountRaw !== null ? Math.round(packageCountRaw) : null,
      shippedAt: optDate(formData, "shippedAt"),
      estimatedArrival: optDate(formData, "estimatedArrival"),
      userId: user.id,
    });
  });
}

// ---------- Nebenkosten ----------

export async function addPoCostAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const purchaseOrderId = str(formData, "purchaseOrderId");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
    if (po.status === "CANCELLED") {
      throw new AppError("Zu stornierten Bestellungen können keine Kosten erfasst werden.");
    }

    const type = str(formData, "type");
    if (!(COST_TYPES as readonly string[]).includes(type)) {
      throw new AppError("Ungültiger Kostentyp.");
    }
    const allocationMethod = str(formData, "allocationMethod") || "BY_VALUE";
    if (!(COST_ALLOCATION_METHODS as readonly string[]).includes(allocationMethod)) {
      throw new AppError("Ungültige Verteilmethode.");
    }
    const amountCents = Math.round(num(formData, "amountCents"));
    if (amountCents <= 0) throw new AppError("Der Betrag muss größer als 0 sein.");

    await addCost({
      type,
      description: optStr(formData, "description"),
      amountCents,
      currency: "EUR",
      fxRate: 1,
      allocationMethod,
      purchaseOrderId,
      userId: user.id,
    });
    await writeAudit({
      userId: user.id,
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrderId,
      action: "CREATE",
      changes: [{ field: "amountEurCents", old: null, new: amountCents }],
      comment: `Nebenkosten erfasst (${type}, ${allocationMethod})`,
    });
  });
}
