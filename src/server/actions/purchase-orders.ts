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
  postGoodsReceipt,
  recomputeLandedCosts,
} from "../services/purchasing";
import { addCost } from "../services/finance";
import { extractInvoiceFromPdf } from "../services/pdf-extract";
import { matchProduct, similarity, findOrCreateProduct } from "../services/matching";
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
      orderedAt: optDate(formData, "orderedAt") ?? before.orderedAt,
      expectedAt: optDate(formData, "expectedAt") ?? before.expectedAt,
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

// ---------- Schnell-Workflow: Tracking → versendet → zugestellt → Bestand ----------

/**
 * Tracking hinzufügen: meldet alle noch offenen Mengen der Bestellung als
 * versendet (eine Sendung mit Trackingnummer). Entwürfe werden dabei
 * automatisch als „Bestellt“ markiert.
 */
export async function addPoTrackingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const carrier = optStr(formData, "carrier");
    if (carrier && !(CARRIERS as readonly string[]).includes(carrier)) {
      throw new AppError("Ungültiger Versanddienstleister.");
    }
    const trackingNumber = optStr(formData, "trackingNumber");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (po.status === "CANCELLED") throw new AppError("Die Bestellung ist storniert.");
    if (po.lines.length === 0) {
      throw new AppError("Die Bestellung hat noch keine Positionen – bitte zuerst Produkte erfassen.");
    }
    if (po.status === "DRAFT") {
      await db.purchaseOrder.update({
        where: { id },
        data: { status: "ORDERED", orderedAt: po.orderedAt ?? new Date() },
      });
    }
    const stats = await getPoLineStats(id);
    const items = stats
      .filter((s) => s.ordered - s.shipped > 0)
      .map((s) => ({ poLineId: s.poLineId, qty: s.ordered - s.shipped }));
    if (items.length === 0) {
      throw new AppError("Alle Positionen sind bereits als versendet gemeldet.");
    }
    await createInboundShipment({
      purchaseOrderId: id,
      items,
      carrier,
      trackingNumber,
      userId: user.id,
    });
  });
}

/**
 * Als zugestellt markieren: bucht alle noch offenen Mengen als Wareneingang
 * ein – die Ware wandert damit automatisch in den Bestand (FIFO-Chargen).
 */
export async function markPoDeliveredAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const po = await db.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        lines: true,
        shipments: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (po.status === "CANCELLED") throw new AppError("Die Bestellung ist storniert.");
    if (po.lines.length === 0) {
      throw new AppError("Die Bestellung hat noch keine Positionen – bitte zuerst Produkte erfassen.");
    }
    // Auch ohne vorherige Sendungsmeldung möglich (z.B. Abholung)
    if (po.status === "DRAFT") {
      await db.purchaseOrder.update({
        where: { id },
        data: { status: "ORDERED", orderedAt: po.orderedAt ?? new Date() },
      });
    }
    const stats = await getPoLineStats(id);
    const items = stats
      .filter((s) => s.ordered - s.arrived > 0)
      .map((s) => ({ poLineId: s.poLineId, qtyReceived: s.ordered - s.arrived }));
    if (items.length === 0) {
      throw new AppError("Die Bestellung ist bereits vollständig im Bestand eingebucht.");
    }
    const openShipment = po.shipments.find((s) => s.status !== "ARRIVED") ?? po.shipments[0] ?? null;
    await postGoodsReceipt({
      purchaseOrderId: id,
      shipmentId: openShipment?.id ?? null,
      items,
      userId: user.id,
    });
  });
}

// ---------- PDF-Rechnung → Bestellung (KI) ----------

/**
 * Bezahlte Lieferantenrechnung als PDF hochladen: die KI liest Lieferant,
 * Ordernummer, Datum und Positionen aus und legt die Bestellung direkt an.
 * Unbekannte Produkte werden automatisch angelegt (exakter Name = Duplikatschutz).
 */
export async function uploadPoPdfAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Bitte eine PDF-Rechnung auswählen.");
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      throw new AppError("Bitte eine PDF-Datei hochladen (für CSV/Excel den Import-Bereich nutzen).");
    }
    if (file.size > 4 * 1024 * 1024) {
      throw new AppError("PDF zu groß (max. 4 MB). Bitte die Rechnung verkleinern.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const invoice = await extractInvoiceFromPdf(buffer);
    if (invoice.items.length === 0) {
      throw new AppError("In der PDF wurden keine Artikelpositionen erkannt – bitte manuell erfassen.");
    }

    // Lieferant: Formularauswahl hat Vorrang, sonst KI-Namenserkennung
    let supplierId = optStr(formData, "supplierId");
    let supplierNote = "";
    if (!supplierId && invoice.supplierName) {
      const suppliers = await db.supplier.findMany({ where: { active: true } });
      let best: (typeof suppliers)[number] | null = null;
      let bestScore = 0;
      for (const s of suppliers) {
        const score = similarity(invoice.supplierName, s.name);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best && bestScore >= 0.55) {
        supplierId = best.id;
        supplierNote = ` (Lieferant erkannt: ${best.name})`;
      }
    }
    if (!supplierId) {
      throw new AppError(
        (invoice.supplierName
          ? `Der Lieferant „${invoice.supplierName}“ ist nicht im System.`
          : "Der Lieferant konnte nicht erkannt werden.") +
          " Bitte beim Upload einen Lieferanten auswählen (oder unter Großhändler anlegen)."
      );
    }

    // Duplikatschutz: gleiche Ordernummer beim selben Lieferanten
    const orderNo = invoice.invoiceNumber?.trim() || null;
    if (orderNo) {
      const dupe = await db.purchaseOrder.findFirst({
        where: { supplierId, supplierOrderNumber: orderNo, status: { not: "CANCELLED" } },
      });
      if (dupe) {
        throw new AppError(
          `Zur Ordernummer ${orderNo} existiert bereits die Bestellung ${dupe.orderNumber}. Duplikat verhindert.`
        );
      }
    }

    const parsedDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : null;
    const orderedAt = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : new Date();

    const poId = await db.$transaction(
      async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber: await nextNumber("PO", tx),
            supplierId: supplierId!,
            supplierOrderNumber: orderNo,
            status: "ORDERED",
            orderedAt,
          },
        });
        let position = 0;
        for (const item of invoice.items) {
          const qty = Math.round(item.quantity);
          if (qty <= 0) continue;
          const unitPriceCents =
            item.unitPrice !== null
              ? Math.round(item.unitPrice * 100)
              : item.totalPrice !== null
                ? Math.round((item.totalPrice * 100) / qty)
                : 0;
          // Nur sichere Treffer verknüpfen – sonst neues Produkt (exakter Name dedupliziert)
          const match = await matchProduct({ name: item.description, sku: item.sku, supplierId });
          const product =
            match.productId && match.confidence >= 90
              ? await tx.product.findUniqueOrThrow({ where: { id: match.productId } })
              : await findOrCreateProduct(tx, { name: item.description });
          position += 1;
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: po.id,
              productId: product.id,
              position,
              enteredQty: qty,
              enteredUnitId: product.baseUnitId,
              unitFactor: 1,
              qtyOrdered: qty,
              unitPriceCents,
              lineTotalCents: qty * unitPriceCents,
            },
          });
          // Lieferanten-Bezeichnung → Produkt lernen (bessere Erkennung beim nächsten Mal)
          if (item.description.trim()) {
            await tx.supplierProductMapping.upsert({
              where: {
                supplierId_supplierName: { supplierId: supplierId!, supplierName: item.description.trim() },
              },
              create: {
                supplierId: supplierId!,
                productId: product.id,
                supplierName: item.description.trim(),
                supplierSku: item.sku?.trim() || null,
                lastPriceCents: unitPriceCents,
              },
              update: { productId: product.id, lastPriceCents: unitPriceCents },
            });
          }
        }
        if (position === 0) {
          throw new AppError("Keine Position mit Menge > 0 erkannt – bitte manuell erfassen.");
        }
        await writeAudit(
          {
            userId: user.id,
            entityType: "PURCHASE_ORDER",
            entityId: po.id,
            action: "IMPORT",
            comment: `Bestellung ${po.orderNumber} per KI aus PDF ${file.name} angelegt (${position} Positionen)${supplierNote}`,
          },
          tx
        );
        await writeEvent(
          {
            type: "PURCHASE_ORDER_CREATED",
            entityType: "PURCHASE_ORDER",
            entityId: po.id,
            summary: `Bestellung ${po.orderNumber} aus Rechnung ${orderNo ?? file.name} angelegt (${position} Positionen)`,
            userId: user.id,
          },
          tx
        );
        return po.id;
      },
      { timeout: 30_000 }
    );
    return { redirect: `/purchase-orders/${poId}` };
  });
}
