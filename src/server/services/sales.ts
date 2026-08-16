import { db } from "../db";
import { AppError } from "../errors";
import { writeAudit, writeEvent } from "../audit";
import { nextNumber } from "../numbering";
import { postOutbound } from "./inventory";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// ---------- Zeilen-Statistiken ----------

export type CoLineStats = {
  lineId: string;
  productId: string;
  qty: number;
  allocated: number; // aktiv reserviert (noch nicht versendet)
  shipped: number;
  delivered: number;
  open: number; // qty - allocated - shipped
};

export async function getCoLineStats(customerOrderId: string, tx?: Tx): Promise<CoLineStats[]> {
  const client = tx ?? db;
  const lines = await client.customerOrderLine.findMany({
    where: { customerOrderId },
    select: {
      id: true,
      productId: true,
      qty: true,
      allocations: { where: { status: "ACTIVE" }, select: { qty: true } },
      shipmentItems: {
        where: { shipment: { status: { not: "CANCELLED" } } },
        select: { qty: true, shipment: { select: { status: true } } },
      },
    },
    orderBy: { position: "asc" },
  });
  return lines.map((l) => {
    const allocated = l.allocations.reduce((a, x) => a + x.qty, 0);
    const shipped = l.shipmentItems
      .filter((s) => s.shipment.status !== "PREPARED")
      .reduce((a, s) => a + s.qty, 0);
    const delivered = l.shipmentItems
      .filter((s) => s.shipment.status === "DELIVERED")
      .reduce((a, s) => a + s.qty, 0);
    return {
      lineId: l.id,
      productId: l.productId,
      qty: l.qty,
      allocated,
      shipped,
      delivered,
      open: Math.max(0, l.qty - allocated - shipped),
    };
  });
}

export function deriveCoStatus(
  current: string,
  totals: { qty: number; shipped: number; delivered: number }
): string {
  if (current === "CANCELLED" || current === "COMPLETED" || current === "DRAFT") return current;
  const { qty, shipped, delivered } = totals;
  if (qty > 0 && delivered >= qty) return "DELIVERED";
  if (delivered > 0) return "PARTIALLY_DELIVERED";
  if (qty > 0 && shipped >= qty) return "SHIPPED";
  if (shipped > 0) return "PARTIALLY_SHIPPED";
  return "CONFIRMED";
}

export async function recomputeCoStatus(tx: Tx, customerOrderId: string, userId?: string | null) {
  const order = await tx.customerOrder.findUniqueOrThrow({ where: { id: customerOrderId } });
  if (order.status === "DRAFT" || order.status === "CANCELLED" || order.status === "COMPLETED") return;
  const stats = await getCoLineStats(customerOrderId, tx);
  const totals = {
    qty: stats.reduce((a, s) => a + s.qty, 0),
    shipped: stats.reduce((a, s) => a + s.shipped, 0),
    delivered: stats.reduce((a, s) => a + s.delivered, 0),
  };
  const next = deriveCoStatus(order.status, totals);
  if (next !== order.status) {
    await tx.customerOrder.update({ where: { id: order.id }, data: { status: next } });
    await writeAudit(
      {
        userId,
        entityType: "CUSTOMER_ORDER",
        entityId: order.id,
        action: "STATUS_CHANGE",
        changes: [{ field: "status", old: order.status, new: next }],
        comment: "Automatisch aus Versand-/Zustellmengen abgeleitet",
      },
      tx
    );
  }
}

// ---------- Kundenversand ----------

/**
 * Versand erstellen: verbraucht aktive Reservierungen der Zeilen,
 * bucht den Bestand aus (FIFO) und friert die Einkaufskosten (COGS) ein.
 */
export async function createCustomerShipment(params: {
  customerOrderId: string;
  items: Array<{ orderLineId: string; qty: number }>;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: Date | null;
  markShipped?: boolean; // false = nur vorbereiten (PREPARED), Bestand bleibt reserviert
  userId?: string | null;
}) {
  const items = params.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new AppError("Der Versand muss mindestens eine Position enthalten.");

  return db.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUniqueOrThrow({
      where: { id: params.customerOrderId },
      include: { lines: { include: { allocations: { where: { status: "ACTIVE" } } } }, customer: true },
    });
    if (order.status === "CANCELLED") throw new AppError("Die Bestellung ist storniert.");
    if (order.status === "DRAFT")
      throw new AppError("Entwürfe können nicht versendet werden – Bestellung zuerst bestätigen.");

    // Prüfung: Versandmenge muss durch aktive Reservierungen gedeckt sein
    for (const item of items) {
      const line = order.lines.find((l) => l.id === item.orderLineId);
      if (!line) throw new AppError("Position gehört nicht zu dieser Bestellung.");
      const allocated = line.allocations.reduce((a, x) => a + x.qty, 0);
      if (item.qty > allocated) {
        throw new AppError(
          `Für diese Position sind nur ${allocated} Stück reserviert. ` +
            `Bitte zuerst Ware zuordnen (reservieren), dann versenden.`
        );
      }
    }

    const shipmentNumber = await nextNumber("VS", tx);
    const markShipped = params.markShipped ?? true;
    const shipment = await tx.customerShipment.create({
      data: {
        shipmentNumber,
        customerOrderId: order.id,
        status: markShipped ? "SHIPPED" : "PREPARED",
        carrier: params.carrier ?? null,
        trackingNumber: params.trackingNumber?.trim() || null,
        shippedAt: markShipped ? params.shippedAt ?? new Date() : null,
      },
    });

    for (const item of items) {
      const line = order.lines.find((l) => l.id === item.orderLineId)!;
      const shipmentItem = await tx.customerShipmentItem.create({
        data: { shipmentId: shipment.id, orderLineId: line.id, qty: item.qty },
      });

      if (markShipped) {
        // Reservierungen in Höhe der Versandmenge auf SHIPPED setzen (FIFO über Reservierungen)
        let remaining = item.qty;
        for (const alloc of line.allocations.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )) {
          if (remaining <= 0) break;
          if (alloc.qty <= remaining) {
            await tx.allocation.update({ where: { id: alloc.id }, data: { status: "SHIPPED" } });
            remaining -= alloc.qty;
          } else {
            // Reservierung teilen: versendeter Teil + verbleibender aktiver Rest
            await tx.allocation.update({
              where: { id: alloc.id },
              data: { qty: remaining, status: "SHIPPED" },
            });
            await tx.allocation.create({
              data: {
                productId: alloc.productId,
                customerOrderLineId: line.id,
                qty: alloc.qty - remaining,
                status: "ACTIVE",
                createdAt: alloc.createdAt,
              },
            });
            remaining = 0;
          }
        }

        // Bestand ausbuchen + COGS einfrieren
        const { cogsEurCents } = await postOutbound(tx, {
          productId: line.productId,
          qty: item.qty,
          type: "CUSTOMER_SHIPMENT",
          customerShipmentItemId: shipmentItem.id,
          refType: "CUSTOMER_SHIPMENT",
          refId: shipment.id,
          note: `Versand ${shipmentNumber} zu ${order.orderNumber}`,
          userId: params.userId,
        });
        await tx.customerShipmentItem.update({
          where: { id: shipmentItem.id },
          data: { cogsEurCents },
        });
      }
    }

    await writeEvent(
      {
        type: markShipped ? "CUSTOMER_ORDER_SHIPPED" : "CUSTOMER_SHIPMENT_PREPARED",
        entityType: "CUSTOMER_ORDER",
        entityId: order.id,
        summary: `${markShipped ? "Versendet" : "Versand vorbereitet"}: ${shipmentNumber} (${items.reduce((a, i) => a + i.qty, 0)} Einheiten) an ${order.customer.name}`,
        meta: { shipmentId: shipment.id, trackingNumber: params.trackingNumber },
        userId: params.userId,
      },
      tx
    );
    await recomputeCoStatus(tx, order.id, params.userId);
    return shipment;
  });
}

/** Vorbereiteten Versand tatsächlich als versendet buchen. */
export async function markShipmentShipped(params: {
  shipmentId: string;
  shippedAt?: Date;
  trackingNumber?: string | null;
  carrier?: string | null;
  userId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const shipment = await tx.customerShipment.findUniqueOrThrow({
      where: { id: params.shipmentId },
      include: {
        items: { include: { orderLine: { include: { allocations: { where: { status: "ACTIVE" } } } } } },
        order: true,
      },
    });
    if (shipment.status !== "PREPARED")
      throw new AppError("Nur vorbereitete Sendungen können als versendet markiert werden.");

    for (const item of shipment.items) {
      const allocated = item.orderLine.allocations.reduce((a, x) => a + x.qty, 0);
      if (item.qty > allocated) {
        throw new AppError(
          `Reservierung reicht nicht mehr aus (${allocated} reserviert, ${item.qty} benötigt).`
        );
      }
      let remaining = item.qty;
      for (const alloc of item.orderLine.allocations.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      )) {
        if (remaining <= 0) break;
        if (alloc.qty <= remaining) {
          await tx.allocation.update({ where: { id: alloc.id }, data: { status: "SHIPPED" } });
          remaining -= alloc.qty;
        } else {
          await tx.allocation.update({
            where: { id: alloc.id },
            data: { qty: remaining, status: "SHIPPED" },
          });
          await tx.allocation.create({
            data: {
              productId: alloc.productId,
              customerOrderLineId: item.orderLineId,
              qty: alloc.qty - remaining,
              status: "ACTIVE",
              createdAt: alloc.createdAt,
            },
          });
          remaining = 0;
        }
      }
      const { cogsEurCents } = await postOutbound(tx, {
        productId: item.orderLine.productId,
        qty: item.qty,
        type: "CUSTOMER_SHIPMENT",
        customerShipmentItemId: item.id,
        refType: "CUSTOMER_SHIPMENT",
        refId: shipment.id,
        note: `Versand ${shipment.shipmentNumber} zu ${shipment.order.orderNumber}`,
        userId: params.userId,
      });
      await tx.customerShipmentItem.update({ where: { id: item.id }, data: { cogsEurCents } });
    }

    const updated = await tx.customerShipment.update({
      where: { id: shipment.id },
      data: {
        status: "SHIPPED",
        shippedAt: params.shippedAt ?? new Date(),
        trackingNumber: params.trackingNumber?.trim() || shipment.trackingNumber,
        carrier: params.carrier ?? shipment.carrier,
      },
    });
    await writeEvent(
      {
        type: "CUSTOMER_ORDER_SHIPPED",
        entityType: "CUSTOMER_ORDER",
        entityId: shipment.customerOrderId,
        summary: `Versendet: ${shipment.shipmentNumber}`,
        userId: params.userId,
      },
      tx
    );
    await recomputeCoStatus(tx, shipment.customerOrderId, params.userId);
    return updated;
  });
}

/** Sendung als zugestellt markieren. */
export async function markShipmentDelivered(params: {
  shipmentId: string;
  deliveredAt?: Date;
  userId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const shipment = await tx.customerShipment.findUniqueOrThrow({
      where: { id: params.shipmentId },
      include: { order: true },
    });
    if (shipment.status !== "SHIPPED" && shipment.status !== "IN_TRANSIT") {
      throw new AppError("Nur versendete Sendungen können als zugestellt markiert werden.");
    }
    const updated = await tx.customerShipment.update({
      where: { id: shipment.id },
      data: { status: "DELIVERED", deliveredAt: params.deliveredAt ?? new Date() },
    });
    await tx.trackingEvent.create({
      data: {
        customerShipmentId: shipment.id,
        status: "DELIVERED",
        description: "Zustellung bestätigt",
        occurredAt: params.deliveredAt ?? new Date(),
        source: "MANUAL",
      },
    });
    await writeEvent(
      {
        type: "CUSTOMER_ORDER_DELIVERED",
        entityType: "CUSTOMER_ORDER",
        entityId: shipment.customerOrderId,
        summary: `Zugestellt: ${shipment.shipmentNumber} (${shipment.order.orderNumber})`,
        userId: params.userId,
      },
      tx
    );
    await recomputeCoStatus(tx, shipment.customerOrderId, params.userId);
    return updated;
  });
}
