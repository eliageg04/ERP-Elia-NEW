import { db } from "../db";
import { AppError } from "../errors";
import { writeAudit, writeEvent } from "../audit";
import { nextNumber } from "../numbering";
import { postInbound } from "./inventory";
import { apportionCents, toEurCents } from "@/lib/money";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// ---------- Zeilen-Statistiken ----------

export type PoLineStats = {
  poLineId: string;
  productId: string;
  ordered: number; // Basiseinheiten
  shipped: number; // vom Lieferanten versendet
  arrivedOk: number; // unbeschädigt eingelagert
  damaged: number;
  missing: number;
  arrived: number; // arrivedOk + damaged
  open: number; // ordered - arrived
  inTransit: number; // shipped - arrived (min 0)
};

/** Versand-/Eingangszahlen je Bestellzeile (Basis für Status & Anzeige). */
export async function getPoLineStats(purchaseOrderId: string, tx?: Tx): Promise<PoLineStats[]> {
  const client = tx ?? db;
  const lines = await client.purchaseOrderLine.findMany({
    where: { purchaseOrderId },
    select: {
      id: true,
      productId: true,
      qtyOrdered: true,
      shipmentItems: {
        where: { shipment: { status: { not: "CANCELLED" } } },
        select: { qty: true, shipment: { select: { status: true } } },
      },
      receiptItems: { select: { qtyReceived: true, qtyDamaged: true, qtyMissing: true } },
    },
    orderBy: { position: "asc" },
  });
  return lines.map((l) => {
    const shipped = l.shipmentItems
      .filter((s) => s.shipment.status !== "ANNOUNCED")
      .reduce((a, s) => a + s.qty, 0);
    const arrivedOk = l.receiptItems.reduce((a, r) => a + r.qtyReceived, 0);
    const damaged = l.receiptItems.reduce((a, r) => a + r.qtyDamaged, 0);
    const missing = l.receiptItems.reduce((a, r) => a + r.qtyMissing, 0);
    const arrived = arrivedOk + damaged;
    return {
      poLineId: l.id,
      productId: l.productId,
      ordered: l.qtyOrdered,
      shipped,
      arrivedOk,
      damaged,
      missing,
      arrived,
      open: Math.max(0, l.qtyOrdered - arrived),
      inTransit: Math.max(0, shipped - arrived),
    };
  });
}

/** Status aus den Zahlen ableiten (manuelle Overrides bleiben erhalten). */
export function derivePoStatus(
  current: string,
  totals: { ordered: number; shipped: number; arrived: number }
): string {
  if (current === "CANCELLED" || current === "COMPLETED" || current === "DRAFT") return current;
  const { ordered, shipped, arrived } = totals;
  if (ordered > 0 && arrived >= ordered) return "RECEIVED";
  if (arrived > 0) return "PARTIALLY_RECEIVED";
  if (ordered > 0 && shipped >= ordered) return "SHIPPED";
  if (shipped > 0) return "PARTIALLY_SHIPPED";
  return current === "CONFIRMED" ? "CONFIRMED" : "ORDERED";
}

export async function recomputePoStatus(tx: Tx, purchaseOrderId: string, userId?: string | null) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
  if (po.statusOverridden) return; // manueller Status hat Vorrang
  const stats = await getPoLineStats(purchaseOrderId, tx);
  const totals = {
    ordered: stats.reduce((a, s) => a + s.ordered, 0),
    shipped: stats.reduce((a, s) => a + s.shipped, 0),
    arrived: stats.reduce((a, s) => a + s.arrived, 0),
  };
  const next = derivePoStatus(po.status, totals);
  if (next !== po.status) {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: next } });
    await writeAudit(
      {
        userId,
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        action: "STATUS_CHANGE",
        changes: [{ field: "status", old: po.status, new: next }],
        comment: "Automatisch aus Versand-/Eingangsmengen abgeleitet",
      },
      tx
    );
  }
}

// ---------- Eingehende Sendung ----------

export async function createInboundShipment(params: {
  purchaseOrderId: string;
  items: Array<{ poLineId: string; qty: number }>;
  carrier?: string | null;
  trackingNumber?: string | null;
  packageCount?: number | null;
  shippedAt?: Date | null;
  estimatedArrival?: Date | null;
  status?: string;
  userId?: string | null;
}) {
  if (params.items.length === 0 || params.items.every((i) => i.qty <= 0)) {
    throw new AppError("Die Sendung muss mindestens eine Position mit Menge enthalten.");
  }
  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: params.purchaseOrderId },
      include: { lines: true },
    });
    if (po.status === "CANCELLED") throw new AppError("Die Bestellung ist storniert.");

    // Integrität: versendet darf bestellt nicht überschreiten
    const stats = await getPoLineStats(po.id, tx);
    const statsByLine = new Map(stats.map((s) => [s.poLineId, s]));
    for (const item of params.items) {
      const line = po.lines.find((l) => l.id === item.poLineId);
      if (!line) throw new AppError("Position gehört nicht zu dieser Bestellung.");
      const s = statsByLine.get(item.poLineId)!;
      if (s.shipped + item.qty > line.qtyOrdered) {
        throw new AppError(
          `Es können maximal ${line.qtyOrdered - s.shipped} Einheiten als versendet gemeldet werden ` +
            `(bestellt ${line.qtyOrdered}, bereits versendet ${s.shipped}).`
        );
      }
    }

    const shipmentNumber = await nextNumber("WES", tx);
    const shipment = await tx.inboundShipment.create({
      data: {
        shipmentNumber,
        purchaseOrderId: po.id,
        status: params.status ?? "IN_TRANSIT",
        carrier: params.carrier ?? null,
        trackingNumber: params.trackingNumber?.trim() || null,
        packageCount: params.packageCount ?? null,
        shippedAt: params.shippedAt ?? new Date(),
        estimatedArrival: params.estimatedArrival ?? null,
        items: {
          create: params.items
            .filter((i) => i.qty > 0)
            .map((i) => ({ poLineId: i.poLineId, qty: i.qty })),
        },
      },
    });
    await writeEvent(
      {
        type: "SHIPMENT_SENT",
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        summary: `Sendung ${shipmentNumber} unterwegs (${params.items.reduce((a, i) => a + i.qty, 0)} Einheiten)`,
        meta: { shipmentId: shipment.id, trackingNumber: params.trackingNumber },
        userId: params.userId,
      },
      tx
    );
    await recomputePoStatus(tx, po.id, params.userId);
    return shipment;
  });
}

// ---------- Wareneingang ----------

export async function postGoodsReceipt(params: {
  purchaseOrderId: string;
  shipmentId?: string | null;
  receivedAt?: Date;
  packageCount?: number | null;
  items: Array<{
    poLineId: string;
    qtyReceived: number;
    qtyDamaged?: number;
    qtyMissing?: number;
    note?: string;
  }>;
  userId?: string | null;
}) {
  const items = params.items.filter(
    (i) => i.qtyReceived > 0 || (i.qtyDamaged ?? 0) > 0 || (i.qtyMissing ?? 0) > 0
  );
  if (items.length === 0) {
    throw new AppError("Bitte mindestens eine Menge erfassen.");
  }
  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: params.purchaseOrderId },
      include: { lines: true, costs: true },
    });
    if (po.status === "CANCELLED") throw new AppError("Die Bestellung ist storniert.");
    if (po.status === "DRAFT")
      throw new AppError("Für einen Entwurf kann kein Wareneingang gebucht werden – Bestellung zuerst als „Bestellt“ markieren.");

    const stats = await getPoLineStats(po.id, tx);
    const statsByLine = new Map(stats.map((s) => [s.poLineId, s]));

    // Integrität: angekommen darf bestellt nicht überschreiten (hart);
    // "angekommen > versendet" ist erlaubt, erzeugt aber eine Warnung im Dashboard.
    for (const item of items) {
      const line = po.lines.find((l) => l.id === item.poLineId);
      if (!line) throw new AppError("Position gehört nicht zu dieser Bestellung.");
      const s = statsByLine.get(item.poLineId)!;
      const addArrived = item.qtyReceived + (item.qtyDamaged ?? 0);
      if (s.arrived + addArrived > line.qtyOrdered) {
        throw new AppError(
          `Zeile überbucht: bestellt ${line.qtyOrdered}, bereits angekommen ${s.arrived}, ` +
            `jetzt gemeldet ${addArrived}. Bitte zuerst die Bestellmenge korrigieren.`
        );
      }
    }

    const receiptNumber = await nextNumber("WE", tx);
    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber,
        purchaseOrderId: po.id,
        shipmentId: params.shipmentId ?? null,
        receivedAt: params.receivedAt ?? new Date(),
        receivedById: params.userId ?? null,
        packageCount: params.packageCount ?? null,
      },
    });

    // Nebenkosten der Bestellung je Basiseinheit (für Landed Cost der Chargen)
    const overheadPerUnit = computeOverheadPerUnit(po);

    for (const item of items) {
      const line = po.lines.find((l) => l.id === item.poLineId)!;
      const receiptItem = await tx.goodsReceiptItem.create({
        data: {
          receiptId: receipt.id,
          poLineId: item.poLineId,
          qtyReceived: item.qtyReceived,
          qtyDamaged: item.qtyDamaged ?? 0,
          qtyMissing: item.qtyMissing ?? 0,
          note: item.note ?? null,
        },
      });
      if (item.qtyReceived > 0) {
        // Warenpreis pro Basiseinheit in EUR (Rabatt anteilig, Kurs eingefroren)
        const lineTotalEur = toEurCents(line.lineTotalCents, po.fxRate);
        const unitCostEur = line.qtyOrdered > 0 ? Math.round(lineTotalEur / line.qtyOrdered) : 0;
        const landed = unitCostEur + (overheadPerUnit.get(line.id) ?? 0);
        await postInbound(tx, {
          productId: line.productId,
          qty: item.qtyReceived,
          type: "RECEIPT",
          unitCostEurCents: unitCostEur,
          landedUnitCostEurCents: landed,
          poLineId: line.id,
          receiptItemId: receiptItem.id,
          refType: "GOODS_RECEIPT",
          refId: receipt.id,
          note: `Wareneingang ${receiptNumber} zu ${po.orderNumber}`,
          userId: params.userId,
        });
      }
    }

    // Sendungsstatus fortschreiben
    if (params.shipmentId) {
      const shipment = await tx.inboundShipment.findUnique({
        where: { id: params.shipmentId },
        include: { items: true },
      });
      if (shipment) {
        const announcedTotal = shipment.items.reduce((a, i) => a + i.qty, 0);
        const receivedForShipment = await tx.goodsReceiptItem.aggregate({
          where: { receipt: { shipmentId: shipment.id } },
          _sum: { qtyReceived: true, qtyDamaged: true },
        });
        const got =
          (receivedForShipment._sum.qtyReceived ?? 0) + (receivedForShipment._sum.qtyDamaged ?? 0);
        await tx.inboundShipment.update({
          where: { id: shipment.id },
          data:
            got >= announcedTotal
              ? { status: "ARRIVED", arrivedAt: new Date() }
              : { status: "PARTIALLY_ARRIVED" },
        });
      }
    }

    const totalIn = items.reduce((a, i) => a + i.qtyReceived, 0);
    const totalDamaged = items.reduce((a, i) => a + (i.qtyDamaged ?? 0), 0);
    await writeEvent(
      {
        type: "GOODS_RECEIVED",
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        summary:
          `Wareneingang ${receiptNumber}: ${totalIn} Einheiten eingelagert` +
          (totalDamaged > 0 ? `, ${totalDamaged} beschädigt` : ""),
        meta: { receiptId: receipt.id },
        userId: params.userId,
      },
      tx
    );
    await recomputePoStatus(tx, po.id, params.userId);
    return receipt;
  });
}

/**
 * Nebenkosten (Versand/Zoll/Gebühren) der Bestellung auf die Zeilen verteilen.
 * Rückgabe: EUR-Cents Aufschlag pro Basiseinheit je Zeile.
 * Standard: Verteilung nach Warenwert; alternativ nach Menge.
 */
export function computeOverheadPerUnit(po: {
  fxRate: number;
  lines: Array<{ id: string; qtyOrdered: number; lineTotalCents: number }>;
  costs: Array<{ amountEurCents: number; allocationMethod: string }>;
}): Map<string, number> {
  const result = new Map<string, number>();
  if (po.lines.length === 0) return result;
  const byValue = po.costs
    .filter((c) => c.allocationMethod !== "BY_QUANTITY")
    .reduce((a, c) => a + c.amountEurCents, 0);
  const byQty = po.costs
    .filter((c) => c.allocationMethod === "BY_QUANTITY")
    .reduce((a, c) => a + c.amountEurCents, 0);

  const valueWeights = po.lines.map((l) => Math.max(0, toEurCents(l.lineTotalCents, po.fxRate)));
  const qtyWeights = po.lines.map((l) => Math.max(0, l.qtyOrdered));
  const valueShares = apportionCents(byValue, valueWeights);
  const qtyShares = apportionCents(byQty, qtyWeights);

  po.lines.forEach((l, i) => {
    const totalShare = valueShares[i] + qtyShares[i];
    result.set(l.id, l.qtyOrdered > 0 ? Math.round(totalShare / l.qtyOrdered) : 0);
  });
  return result;
}

/**
 * Landed Costs aller Chargen einer Bestellung neu berechnen
 * (nach dem Erfassen/Ändern von Nebenkosten). Bereits verbrauchte
 * Mengen behalten ihre eingefrorenen Kosten (LotConsumption).
 */
export async function recomputeLandedCosts(tx: Tx, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { lines: true, costs: true },
  });
  const overheadPerUnit = computeOverheadPerUnit(po);
  for (const line of po.lines) {
    const lineTotalEur = toEurCents(line.lineTotalCents, po.fxRate);
    const unitCostEur = line.qtyOrdered > 0 ? Math.round(lineTotalEur / line.qtyOrdered) : 0;
    await tx.purchaseLot.updateMany({
      where: { poLineId: line.id },
      data: {
        unitCostEurCents: unitCostEur,
        landedUnitCostEurCents: unitCostEur + (overheadPerUnit.get(line.id) ?? 0),
      },
    });
  }
}
