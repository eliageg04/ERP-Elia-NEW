"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, writeEvent, diffChanges } from "../audit";
import { nextNumber } from "../numbering";
import {
  getCoLineStats,
  recomputeCoStatus,
  createCustomerShipment,
  markShipmentShipped,
  markShipmentDelivered,
} from "../services/sales";
import { getStock, allocate, releaseAllocation } from "../services/inventory";
import { runAction, str, optStr, num, optNum, optDate } from "./helpers";
import { CARRIERS } from "@/lib/constants";
import type { ActionState } from "@/components/form";

// ---------- Kopf ----------

export async function createCustomerOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const customerId = str(formData, "customerId");
    if (!customerId) throw new AppError("Bitte einen Kunden wählen.");
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AppError("Der gewählte Kunde wurde nicht gefunden.");

    const shippingFeeCents = Math.round(optNum(formData, "shippingFeeCents") ?? 0);
    if (shippingFeeCents < 0) throw new AppError("Die Versandkosten dürfen nicht negativ sein.");

    const orderNumber = await nextNumber("SO");
    const order = await db.customerOrder.create({
      data: {
        orderNumber,
        customerId,
        status: "DRAFT",
        orderedAt: optDate(formData, "orderedAt") ?? new Date(),
        shippingFeeCents,
      },
    });
    await writeAudit({
      userId: user.id,
      entityType: "CUSTOMER_ORDER",
      entityId: order.id,
      action: "CREATE",
      comment: `Kundenbestellung ${orderNumber} für ${customer.name} angelegt (Entwurf)`,
    });
    return { redirect: `/customer-orders/${order.id}` };
  });
}

export async function updateCoHeaderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const before = await db.customerOrder.findUniqueOrThrow({ where: { id } });
    if (before.status === "CANCELLED") {
      throw new AppError("Stornierte Bestellungen können nicht mehr bearbeitet werden.");
    }

    const customerId = str(formData, "customerId") || before.customerId;
    if (customerId !== before.customerId) {
      const customer = await db.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new AppError("Der gewählte Kunde wurde nicht gefunden.");
    }
    const shippingFeeCents = Math.round(
      optNum(formData, "shippingFeeCents") ?? before.shippingFeeCents
    );
    if (shippingFeeCents < 0) throw new AppError("Die Versandkosten dürfen nicht negativ sein.");

    const data = {
      customerId,
      orderedAt: optDate(formData, "orderedAt") ?? before.orderedAt,
      shippingFeeCents,
    };
    const changes = diffChanges(before as unknown as Record<string, unknown>, data);
    await db.customerOrder.update({ where: { id }, data });
    if (changes.length > 0) {
      await writeAudit({
        userId: user.id,
        entityType: "CUSTOMER_ORDER",
        entityId: id,
        action: "UPDATE",
        changes,
      });
    }
    return { redirect: `/customer-orders/${id}` };
  });
}

// ---------- Positionen ----------

export async function addCoLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const customerOrderId = str(formData, "customerOrderId");
    const order = await db.customerOrder.findUniqueOrThrow({ where: { id: customerOrderId } });
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      throw new AppError(
        "Zu stornierten oder abgeschlossenen Bestellungen können keine Positionen hinzugefügt werden."
      );
    }

    const productId = str(formData, "productId");
    if (!productId) throw new AppError("Bitte ein Produkt wählen.");
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });

    const qty = Math.round(num(formData, "qty"));
    if (qty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");
    const unitPriceCents = Math.round(num(formData, "unitPriceCents"));
    if (unitPriceCents < 0) throw new AppError("Der Verkaufspreis darf nicht negativ sein.");
    const discountCents = Math.round(optNum(formData, "discountCents") ?? 0);
    if (discountCents < 0) throw new AppError("Der Rabatt darf nicht negativ sein.");
    const lineTotalCents = qty * unitPriceCents - discountCents;
    if (lineTotalCents < 0) {
      throw new AppError("Der Rabatt darf den Warenwert der Zeile nicht überschreiten.");
    }

    const maxPos = await db.customerOrderLine.aggregate({
      where: { customerOrderId },
      _max: { position: true },
    });
    await db.$transaction(async (tx) => {
      await tx.customerOrderLine.create({
        data: {
          customerOrderId,
          productId,
          position: (maxPos._max.position ?? 0) + 1,
          qty,
          unitPriceCents,
          discountCents,
          lineTotalCents,
        },
      });
      await writeAudit(
        {
          userId: user.id,
          entityType: "CUSTOMER_ORDER",
          entityId: customerOrderId,
          action: "CREATE",
          changes: [
            { field: "qty", old: null, new: qty },
            { field: "unitPriceCents", old: null, new: unitPriceCents },
            { field: "discountCents", old: null, new: discountCents },
          ],
          comment: `Position hinzugefügt: ${qty} × ${product.name}`,
        },
        tx
      );
      await recomputeCoStatus(tx, customerOrderId, user.id);
    });
  });
}

export async function updateCoLineAction(
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
    const line = await db.customerOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      include: {
        order: true,
        product: true,
        allocations: { where: { status: "ACTIVE" } },
      },
    });
    if (line.order.status === "CANCELLED") {
      throw new AppError("Positionen stornierter Bestellungen können nicht geändert werden.");
    }

    // Nur solange nichts versendet wurde
    const stats = await getCoLineStats(line.customerOrderId);
    const s = stats.find((x) => x.lineId === lineId);
    if (s && s.shipped > 0) {
      throw new AppError(
        `Für diese Position wurden bereits ${s.shipped} Stück versendet – sie kann nicht mehr geändert werden.`
      );
    }

    const qty = Math.round(num(formData, "qty"));
    if (qty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");
    const reserved = line.allocations.reduce((a, x) => a + x.qty, 0);
    if (qty < reserved) {
      throw new AppError(
        `Die neue Menge (${qty}) liegt unter der bereits reservierten Menge (${reserved}). ` +
          `Bitte zuerst Reservierungen freigeben, dann die Menge ändern.`
      );
    }
    const unitPriceCents = Math.round(num(formData, "unitPriceCents"));
    if (unitPriceCents < 0) throw new AppError("Der Verkaufspreis darf nicht negativ sein.");
    const discountCents = Math.round(optNum(formData, "discountCents") ?? 0);
    if (discountCents < 0) throw new AppError("Der Rabatt darf nicht negativ sein.");
    const lineTotalCents = qty * unitPriceCents - discountCents;
    if (lineTotalCents < 0) {
      throw new AppError("Der Rabatt darf den Warenwert der Zeile nicht überschreiten.");
    }

    const data = { qty, unitPriceCents, discountCents, lineTotalCents };
    const changes = diffChanges(line as unknown as Record<string, unknown>, data);
    await db.$transaction(async (tx) => {
      await tx.customerOrderLine.update({ where: { id: lineId }, data });
      if (changes.length > 0) {
        await writeAudit(
          {
            userId: user.id,
            entityType: "CUSTOMER_ORDER",
            entityId: line.customerOrderId,
            action: "CORRECTION",
            changes,
            comment: `${line.product.name}: ${reason}`,
          },
          tx
        );
        await recomputeCoStatus(tx, line.customerOrderId, user.id);
      }
    });
  });
}

export async function deleteCoLineAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const lineId = str(formData, "lineId");
    const line = await db.customerOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      include: {
        order: true,
        product: true,
        allocations: { where: { status: "ACTIVE" } },
        _count: { select: { shipmentItems: true } },
      },
    });
    if (line.order.status === "CANCELLED") {
      throw new AppError("Positionen stornierter Bestellungen können nicht gelöscht werden.");
    }
    if (line._count.shipmentItems > 0) {
      throw new AppError(
        "Zu dieser Position existiert bereits ein Versand – sie kann nicht gelöscht werden. Bitte stattdessen die Menge korrigieren."
      );
    }
    await db.$transaction(async (tx) => {
      // Aktive Reservierungen zuerst freigeben (schreibt Events)
      for (const a of line.allocations) {
        await releaseAllocation(tx, { allocationId: a.id, userId: user.id });
      }
      // Freigegebene Reservierungs-Datensätze entfernen, damit die Zeile löschbar ist
      await tx.allocation.deleteMany({ where: { customerOrderLineId: lineId } });
      await tx.customerOrderLine.delete({ where: { id: lineId } });
      await writeAudit(
        {
          userId: user.id,
          entityType: "CUSTOMER_ORDER",
          entityId: line.customerOrderId,
          action: "DELETE",
          comment: `Position entfernt: ${line.qty} × ${line.product.name}`,
        },
        tx
      );
      await recomputeCoStatus(tx, line.customerOrderId, user.id);
    });
  });
}

// ---------- Statuswechsel ----------

export async function confirmOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const order = await db.customerOrder.findUniqueOrThrow({
      where: { id },
      include: { lines: true, customer: true },
    });
    if (order.status !== "DRAFT") {
      throw new AppError("Nur Entwürfe können bestätigt werden.");
    }
    if (order.lines.length === 0) {
      throw new AppError("Die Bestellung hat noch keine Positionen – bitte zuerst Positionen erfassen.");
    }
    const totalUnits = order.lines.reduce((a, l) => a + l.qty, 0);
    await db.$transaction(async (tx) => {
      await tx.customerOrder.update({ where: { id }, data: { status: "CONFIRMED" } });
      await writeAudit(
        {
          userId: user.id,
          entityType: "CUSTOMER_ORDER",
          entityId: id,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: "DRAFT", new: "CONFIRMED" }],
          comment: "Bestellung bestätigt",
        },
        tx
      );
      await writeEvent(
        {
          type: "CUSTOMER_ORDER_CONFIRMED",
          entityType: "CUSTOMER_ORDER",
          entityId: id,
          summary: `Bestellung ${order.orderNumber} von ${order.customer.name} bestätigt (${totalUnits} Einheiten)`,
          userId: user.id,
        },
        tx
      );
    });
  });
}

export async function cancelOrderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const order = await db.customerOrder.findUniqueOrThrow({
      where: { id },
      include: { shipments: true },
    });
    if (order.status === "CANCELLED") throw new AppError("Die Bestellung ist bereits storniert.");
    if (order.status === "COMPLETED") {
      throw new AppError("Abgeschlossene Bestellungen können nicht storniert werden.");
    }
    if (order.shipments.some((s) => s.status !== "CANCELLED")) {
      throw new AppError(
        "Zu dieser Bestellung existiert bereits ein Versand – Stornieren ist nicht möglich."
      );
    }
    await db.$transaction(async (tx) => {
      const activeAllocations = await tx.allocation.findMany({
        where: { status: "ACTIVE", orderLine: { customerOrderId: id } },
        select: { id: true },
      });
      for (const a of activeAllocations) {
        await releaseAllocation(tx, { allocationId: a.id, userId: user.id });
      }
      await tx.customerOrder.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await writeAudit(
        {
          userId: user.id,
          entityType: "CUSTOMER_ORDER",
          entityId: id,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: order.status, new: "CANCELLED" }],
          comment: `Bestellung ${order.orderNumber} storniert${activeAllocations.length > 0 ? ` (${activeAllocations.length} Reservierungen freigegeben)` : ""}`,
        },
        tx
      );
    });
  });
}

// ---------- Reservierungen ----------

export async function allocateLineAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const orderLineId = str(formData, "orderLineId");
    const qty = Math.round(num(formData, "qty"));
    if (qty <= 0) throw new AppError("Die Reservierungsmenge muss größer als 0 sein.");
    const line = await db.customerOrderLine.findUniqueOrThrow({
      where: { id: orderLineId },
      include: { order: true },
    });
    if (line.order.status === "CANCELLED" || line.order.status === "COMPLETED") {
      throw new AppError(
        "Für stornierte oder abgeschlossene Bestellungen kann nichts reserviert werden."
      );
    }
    await db.$transaction(async (tx) => {
      await allocate(tx, {
        productId: line.productId,
        orderLineId,
        qty,
        userId: user.id,
      });
    });
  });
}

export async function allocateAllAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const order = await db.customerOrder.findUniqueOrThrow({ where: { id } });
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      throw new AppError(
        "Für stornierte oder abgeschlossene Bestellungen kann nichts reserviert werden."
      );
    }
    await db.$transaction(async (tx) => {
      const stats = await getCoLineStats(id, tx);
      let total = 0;
      for (const s of stats) {
        if (s.open <= 0) continue;
        const stock = await getStock(s.productId, tx);
        const take = Math.min(s.open, Math.max(0, stock.available));
        if (take <= 0) continue;
        await allocate(tx, {
          productId: s.productId,
          orderLineId: s.lineId,
          qty: take,
          userId: user.id,
        });
        total += take;
      }
      if (total === 0) {
        throw new AppError(
          "Es konnte nichts reserviert werden – entweder sind alle Positionen bereits zugeordnet oder es ist kein Bestand frei verfügbar."
        );
      }
    });
  });
}

export async function releaseAllocationAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const allocationId = str(formData, "allocationId");
    await db.$transaction(async (tx) => {
      await releaseAllocation(tx, { allocationId, userId: user.id });
    });
  });
}

// ---------- Versand ----------

export async function createShipmentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const customerOrderId = str(formData, "customerOrderId");

    const items: Array<{ orderLineId: string; qty: number }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("ship_")) continue;
      const qty = Math.round(Number(String(value).replace(",", ".")));
      if (isFinite(qty) && qty > 0) {
        items.push({ orderLineId: key.slice("ship_".length), qty });
      }
    }
    if (items.length === 0) {
      throw new AppError("Bitte mindestens eine Position mit Menge größer 0 erfassen.");
    }

    const carrier = optStr(formData, "carrier");
    if (carrier && !(CARRIERS as readonly string[]).includes(carrier)) {
      throw new AppError("Ungültiger Versanddienstleister.");
    }

    await createCustomerShipment({
      customerOrderId,
      items,
      carrier,
      trackingNumber: optStr(formData, "trackingNumber"),
      shippedAt: optDate(formData, "shippedAt"),
      markShipped: str(formData, "markShipped") === "1",
      userId: user.id,
    });
  });
}

export async function shipPreparedAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentId = str(formData, "shipmentId");
    await markShipmentShipped({ shipmentId, userId: user.id });
  });
}

export async function deliveredAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentId = str(formData, "shipmentId");
    await markShipmentDelivered({ shipmentId, userId: user.id });
  });
}
