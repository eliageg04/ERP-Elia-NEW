import { db } from "../db";
import { AppError } from "../errors";
import { writeEvent } from "../audit";
import type { Prisma } from "@prisma/client";
import type { InventoryTxType } from "@/lib/constants";

type Tx = Prisma.TransactionClient;

// ============================================================
// Bestandslogik – Grundprinzipien:
//
// 1. Der physische Bestand ist NIE ein einzelnes Feld, sondern immer
//    die Summe aller InventoryTransactions eines Produkts (Ledger).
// 2. Jede positive Bewegung erzeugt eine Charge (PurchaseLot) mit
//    Einstandskosten. Jede negative Bewegung verbraucht Chargen per
//    FIFO und protokolliert den Verbrauch (LotConsumption).
//    Invariante: Σ lots.qtyRemaining == Σ transactions.qty (on hand).
// 3. Reservierungen (Allocations) verändern den physischen Bestand
//    nicht – sie binden verfügbare Ware an eine Kundenbestellung.
//    Verfügbar = Bestand − aktive Reservierungen.
// ============================================================

export type StockSummary = {
  onHand: number; // physisch vorhanden
  reserved: number; // aktiven Kundenbestellungen zugeordnet
  available: number; // onHand - reserved
};

export async function getStock(productId: string, tx?: Tx): Promise<StockSummary> {
  const client = tx ?? db;
  const [txAgg, allocAgg] = await Promise.all([
    client.inventoryTransaction.aggregate({ where: { productId }, _sum: { qty: true } }),
    client.allocation.aggregate({
      where: { productId, status: "ACTIVE" },
      _sum: { qty: true },
    }),
  ]);
  const onHand = txAgg._sum.qty ?? 0;
  const reserved = allocAgg._sum.qty ?? 0;
  return { onHand, reserved, available: onHand - reserved };
}

/** Bestandsübersicht für viele Produkte in wenigen Queries (Listen/Dashboard). */
export async function getStockMap(productIds?: string[]): Promise<Map<string, StockSummary>> {
  const whereTx = productIds ? { productId: { in: productIds } } : {};
  const [txGroups, allocGroups] = await Promise.all([
    db.inventoryTransaction.groupBy({ by: ["productId"], where: whereTx, _sum: { qty: true } }),
    db.allocation.groupBy({
      by: ["productId"],
      where: { ...whereTx, status: "ACTIVE" },
      _sum: { qty: true },
    }),
  ]);
  const map = new Map<string, StockSummary>();
  for (const g of txGroups) {
    map.set(g.productId, { onHand: g._sum.qty ?? 0, reserved: 0, available: g._sum.qty ?? 0 });
  }
  for (const g of allocGroups) {
    const entry = map.get(g.productId) ?? { onHand: 0, reserved: 0, available: 0 };
    entry.reserved = g._sum.qty ?? 0;
    entry.available = entry.onHand - entry.reserved;
    map.set(g.productId, entry);
  }
  return map;
}

/** Gewichteter Durchschnitts-Einstandspreis des aktuellen Bestands (Landed Cost, EUR-Cents). */
export async function getCurrentAvgCost(productId: string, tx?: Tx): Promise<number | null> {
  const client = tx ?? db;
  const lots = await client.purchaseLot.findMany({
    where: { productId, qtyRemaining: { gt: 0 } },
    select: { qtyRemaining: true, landedUnitCostEurCents: true },
  });
  const totalQty = lots.reduce((a, l) => a + l.qtyRemaining, 0);
  if (totalQty === 0) return null;
  const totalCost = lots.reduce((a, l) => a + l.qtyRemaining * l.landedUnitCostEurCents, 0);
  return Math.round(totalCost / totalQty);
}

/**
 * Positive Bestandsbewegung buchen: Transaktion + neue FIFO-Charge.
 * unitCostEurCents = Einstandskosten pro Basiseinheit; wenn unbekannt,
 * wird der aktuelle Durchschnitt verwendet (oder 0 mit Warnhinweis im Ledger).
 */
export async function postInbound(
  tx: Tx,
  params: {
    productId: string;
    qty: number;
    type: Extract<InventoryTxType, "RECEIPT" | "RETURN" | "ADJUSTMENT" | "CORRECTION">;
    unitCostEurCents?: number | null;
    landedUnitCostEurCents?: number | null;
    poLineId?: string | null;
    receiptItemId?: string | null;
    refType?: string;
    refId?: string;
    note?: string;
    userId?: string | null;
  }
) {
  if (params.qty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");
  let unitCost = params.unitCostEurCents ?? null;
  if (unitCost === null) unitCost = (await getCurrentAvgCost(params.productId, tx)) ?? 0;
  const landed = params.landedUnitCostEurCents ?? unitCost;

  const txn = await tx.inventoryTransaction.create({
    data: {
      productId: params.productId,
      type: params.type,
      qty: params.qty,
      refType: params.refType ?? null,
      refId: params.refId ?? null,
      note: params.note ?? null,
      createdById: params.userId ?? null,
    },
  });
  await tx.purchaseLot.create({
    data: {
      productId: params.productId,
      poLineId: params.poLineId ?? null,
      receiptItemId: params.receiptItemId ?? null,
      qtyReceived: params.qty,
      qtyRemaining: params.qty,
      unitCostEurCents: unitCost,
      landedUnitCostEurCents: landed,
    },
  });
  return txn;
}

/**
 * Negative Bestandsbewegung: verbraucht Chargen per FIFO.
 * Gibt die eingefrorenen Einstandskosten (EUR-Cents gesamt) zurück.
 */
export async function postOutbound(
  tx: Tx,
  params: {
    productId: string;
    qty: number; // positiv angeben
    type: Extract<InventoryTxType, "CUSTOMER_SHIPMENT" | "DAMAGE" | "LOSS" | "ADJUSTMENT" | "CORRECTION">;
    customerShipmentItemId?: string | null;
    refType?: string;
    refId?: string;
    note?: string;
    userId?: string | null;
    allowNegative?: boolean; // nur für manuelle Korrekturen durch Admin
  }
): Promise<{ cogsEurCents: number }> {
  if (params.qty <= 0) throw new AppError("Die Menge muss größer als 0 sein.");

  const stock = await getStock(params.productId, tx);
  if (stock.onHand < params.qty && !params.allowNegative) {
    throw new AppError(
      `Nicht genug Bestand: ${stock.onHand} vorhanden, ${params.qty} angefordert. ` +
        `Bitte zuerst den Wareneingang buchen oder den Bestand korrigieren.`
    );
  }

  const txn = await tx.inventoryTransaction.create({
    data: {
      productId: params.productId,
      type: params.type,
      qty: -params.qty,
      refType: params.refType ?? null,
      refId: params.refId ?? null,
      note: params.note ?? null,
      createdById: params.userId ?? null,
    },
  });

  // FIFO: älteste Chargen zuerst verbrauchen
  const lots = await tx.purchaseLot.findMany({
    where: { productId: params.productId, qtyRemaining: { gt: 0 } },
    orderBy: { receivedAt: "asc" },
  });

  let remaining = params.qty;
  let cogs = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qtyRemaining, remaining);
    await tx.purchaseLot.update({
      where: { id: lot.id },
      data: { qtyRemaining: { decrement: take } },
    });
    await tx.lotConsumption.create({
      data: {
        lotId: lot.id,
        customerShipmentItemId: params.customerShipmentItemId ?? null,
        inventoryTransactionId: txn.id,
        qty: take,
        unitCostEurCents: lot.landedUnitCostEurCents,
      },
    });
    cogs += take * lot.landedUnitCostEurCents;
    remaining -= take;
  }
  // Falls Chargen nicht reichen (historische Korrekturen): Rest zum Durchschnittspreis bewerten
  if (remaining > 0) {
    const avg = (await getCurrentAvgCost(params.productId, tx)) ?? 0;
    cogs += remaining * avg;
  }
  return { cogsEurCents: cogs };
}

/** Ware für eine Kundenbestellzeile reservieren. */
export async function allocate(
  tx: Tx,
  params: { productId: string; orderLineId: string; qty: number; userId?: string | null }
) {
  if (params.qty <= 0) throw new AppError("Die Reservierungsmenge muss größer als 0 sein.");
  const stock = await getStock(params.productId, tx);
  if (stock.available < params.qty) {
    throw new AppError(
      `Nur ${stock.available} Stück frei verfügbar (Bestand ${stock.onHand}, reserviert ${stock.reserved}).`
    );
  }
  const line = await tx.customerOrderLine.findUniqueOrThrow({
    where: { id: params.orderLineId },
    include: { allocations: { where: { status: { in: ["ACTIVE", "SHIPPED"] } } }, order: true },
  });
  const already = line.allocations.reduce((a, x) => a + x.qty, 0);
  if (already + params.qty > line.qty) {
    throw new AppError(
      `Zeile umfasst ${line.qty} Stück, davon sind bereits ${already} zugeordnet – maximal ${line.qty - already} weitere möglich.`
    );
  }
  const alloc = await tx.allocation.create({
    data: {
      productId: params.productId,
      customerOrderLineId: params.orderLineId,
      qty: params.qty,
      status: "ACTIVE",
    },
  });
  await writeEvent(
    {
      type: "INVENTORY_ALLOCATED",
      entityType: "CUSTOMER_ORDER",
      entityId: line.order.id,
      summary: `${params.qty} Stück reserviert (${line.order.orderNumber})`,
      meta: { productId: params.productId, qty: params.qty },
      userId: params.userId,
    },
    tx
  );
  return alloc;
}

/** Reservierung (teilweise) freigeben. */
export async function releaseAllocation(
  tx: Tx,
  params: { allocationId: string; userId?: string | null }
) {
  const alloc = await tx.allocation.findUniqueOrThrow({
    where: { id: params.allocationId },
    include: { orderLine: { include: { order: true } } },
  });
  if (alloc.status !== "ACTIVE") {
    throw new AppError("Nur aktive Reservierungen können freigegeben werden.");
  }
  await tx.allocation.update({
    where: { id: alloc.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
  await writeEvent(
    {
      type: "ALLOCATION_RELEASED",
      entityType: "CUSTOMER_ORDER",
      entityId: alloc.orderLine.order.id,
      summary: `Reservierung über ${alloc.qty} Stück freigegeben (${alloc.orderLine.order.orderNumber})`,
      userId: params.userId,
    },
    tx
  );
}

/** "Unterwegs"-Mengen (vom Lieferanten versendet, noch nicht angekommen) je Produkt. */
export async function getInboundInTransitMap(): Promise<Map<string, number>> {
  // versendet je PO-Zeile (Sendungen, die nicht storniert/nur angekündigt sind)
  const shipped = await db.inboundShipmentItem.findMany({
    where: { shipment: { status: { in: ["IN_TRANSIT", "DELAYED", "PARTIALLY_ARRIVED", "ARRIVED"] } } },
    select: { qty: true, poLineId: true, poLine: { select: { productId: true } } },
  });
  const received = await db.goodsReceiptItem.groupBy({
    by: ["poLineId"],
    _sum: { qtyReceived: true, qtyDamaged: true },
  });
  const receivedByLine = new Map(
    received.map((r) => [r.poLineId, (r._sum.qtyReceived ?? 0) + (r._sum.qtyDamaged ?? 0)])
  );
  const shippedByLine = new Map<string, { productId: string; qty: number }>();
  for (const s of shipped) {
    const cur = shippedByLine.get(s.poLineId) ?? { productId: s.poLine.productId, qty: 0 };
    cur.qty += s.qty;
    shippedByLine.set(s.poLineId, cur);
  }
  const map = new Map<string, number>();
  for (const [lineId, { productId, qty }] of shippedByLine) {
    const inTransit = Math.max(0, qty - (receivedByLine.get(lineId) ?? 0));
    if (inTransit > 0) map.set(productId, (map.get(productId) ?? 0) + inTransit);
  }
  return map;
}
