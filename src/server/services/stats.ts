import { db } from "../db";
import { toEurCents, weightedAverageCents } from "@/lib/money";
import { getStockMap, getInboundInTransitMap } from "./inventory";

// ============================================================
// Kennzahlen: Einkaufspreise, Verkäufe, Margen, Dashboard.
// Alle Preise in EUR-Cents pro Basiseinheit (Kurs eingefroren).
// ============================================================

export type PurchasePriceStats = {
  lastCents: number | null;
  lowestCents: number | null;
  highestCents: number | null;
  weightedAvgCents: number | null; // Gesamtkosten / Gesamtmenge (nie einfacher Durchschnitt!)
  totalQty: number;
  totalCostCents: number;
};

/** Einkaufspreis-Statistik je Produkt über alle nicht stornierten Bestellungen. */
export async function getPurchasePriceStats(productIds?: string[]): Promise<Map<string, PurchasePriceStats>> {
  const lines = await db.purchaseOrderLine.findMany({
    where: {
      ...(productIds ? { productId: { in: productIds } } : {}),
      purchaseOrder: { status: { notIn: ["DRAFT", "CANCELLED"] } },
    },
    select: {
      productId: true,
      qtyOrdered: true,
      lineTotalCents: true,
      purchaseOrder: { select: { fxRate: true, orderedAt: true, createdAt: true } },
    },
  });
  const byProduct = new Map<string, Array<{ qty: number; unitPriceCents: number; at: Date }>>();
  for (const l of lines) {
    if (l.qtyOrdered <= 0) continue;
    const totalEur = toEurCents(l.lineTotalCents, l.purchaseOrder.fxRate);
    const unitEur = Math.round(totalEur / l.qtyOrdered);
    const arr = byProduct.get(l.productId) ?? [];
    arr.push({
      qty: l.qtyOrdered,
      unitPriceCents: unitEur,
      at: l.purchaseOrder.orderedAt ?? l.purchaseOrder.createdAt,
    });
    byProduct.set(l.productId, arr);
  }
  const result = new Map<string, PurchasePriceStats>();
  for (const [productId, entries] of byProduct) {
    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    const prices = entries.map((e) => e.unitPriceCents);
    result.set(productId, {
      lastCents: prices[prices.length - 1] ?? null,
      lowestCents: prices.length ? Math.min(...prices) : null,
      highestCents: prices.length ? Math.max(...prices) : null,
      weightedAvgCents: weightedAverageCents(entries),
      totalQty: entries.reduce((a, e) => a + e.qty, 0),
      totalCostCents: entries.reduce((a, e) => a + e.qty * e.unitPriceCents, 0),
    });
  }
  return result;
}

export type SalesStats = {
  soldQty: number; // versendet an Kunden
  revenueCents: number; // Umsatz der versendeten Mengen
  cogsCents: number; // eingefrorene Einkaufskosten (FIFO)
  profitCents: number;
  marginPct: number | null; // Gewinn / Umsatz
};

/** Verkaufs-/Margenstatistik je Produkt (auf Basis tatsächlich versendeter Ware). */
export async function getSalesStats(productIds?: string[]): Promise<Map<string, SalesStats>> {
  const items = await db.customerShipmentItem.findMany({
    where: {
      shipment: { status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] } },
      ...(productIds ? { orderLine: { productId: { in: productIds } } } : {}),
    },
    select: {
      qty: true,
      cogsEurCents: true,
      orderLine: { select: { productId: true, qty: true, unitPriceCents: true, discountCents: true } },
    },
  });
  const result = new Map<string, SalesStats>();
  for (const item of items) {
    const pid = item.orderLine.productId;
    const cur = result.get(pid) ?? { soldQty: 0, revenueCents: 0, cogsCents: 0, profitCents: 0, marginPct: null };
    // Umsatz anteilig: Einheitspreis minus anteiliger Rabatt
    const discountPerUnit =
      item.orderLine.qty > 0 ? item.orderLine.discountCents / item.orderLine.qty : 0;
    const revenue = Math.round(item.qty * (item.orderLine.unitPriceCents - discountPerUnit));
    cur.soldQty += item.qty;
    cur.revenueCents += revenue;
    cur.cogsCents += item.cogsEurCents;
    result.set(pid, cur);
  }
  for (const stats of result.values()) {
    stats.profitCents = stats.revenueCents - stats.cogsCents;
    stats.marginPct = stats.revenueCents > 0 ? stats.profitCents / stats.revenueCents : null;
  }
  return result;
}

/** Vollständige Produktübersicht für Listen (Bestand + Preise + Verkäufe). */
export async function getProductOverview(productIds?: string[]) {
  const [stockMap, inTransitMap, priceMap, salesMap] = await Promise.all([
    getStockMap(productIds),
    getInboundInTransitMap(),
    getPurchasePriceStats(productIds),
    getSalesStats(productIds),
  ]);
  return { stockMap, inTransitMap, priceMap, salesMap };
}

// ---------- Kunden-Statistik ----------

export async function getCustomerStats(customerId: string) {
  const orders = await db.customerOrder.findMany({
    where: { customerId, status: { not: "CANCELLED" } },
    include: {
      lines: true,
      shipments: { where: { status: { not: "CANCELLED" } }, include: { items: true } },
      invoices: { include: { payments: true } },
    },
  });
  let revenueCents = 0;
  let totalQty = 0;
  let profitCents = 0;
  let openOrders = 0;
  const productQty = new Map<string, number>();
  for (const o of orders) {
    for (const l of o.lines) {
      revenueCents += l.lineTotalCents;
      totalQty += l.qty;
      productQty.set(l.productId, (productQty.get(l.productId) ?? 0) + l.qty);
    }
    if (!["DELIVERED", "COMPLETED"].includes(o.status)) openOrders++;
    for (const s of o.shipments) {
      for (const item of s.items) {
        if (["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(s.status)) {
          const line = o.lines.find((l) => l.id === item.orderLineId);
          if (line) {
            const discountPerUnit = line.qty > 0 ? line.discountCents / line.qty : 0;
            profitCents +=
              Math.round(item.qty * (line.unitPriceCents - discountPerUnit)) - item.cogsEurCents;
          }
        }
      }
    }
  }
  // offene Zahlungen über Kundenrechnungen
  const invoices = await db.invoice.findMany({
    where: { customerId, type: "CUSTOMER", status: { in: ["OPEN", "PARTIALLY_PAID"] } },
    include: { payments: true },
  });
  const openPaymentsCents = invoices.reduce(
    (a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0),
    0
  );
  return {
    orderCount: orders.length,
    revenueCents,
    totalQty,
    profitCents,
    openOrders,
    openPaymentsCents,
    avgOrderValueCents: orders.length > 0 ? Math.round(revenueCents / orders.length) : 0,
    topProducts: [...productQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    lastOrderAt: orders.length
      ? orders.reduce((latest, o) => (o.orderedAt > latest ? o.orderedAt : latest), orders[0].orderedAt)
      : null,
  };
}

// ---------- Lieferanten-Statistik ----------

export async function getSupplierStats(supplierId: string) {
  const orders = await db.purchaseOrder.findMany({
    where: { supplierId, status: { notIn: ["DRAFT", "CANCELLED"] } },
    include: { lines: true },
  });
  const volumeEurCents = orders.reduce(
    (a, o) => a + o.lines.reduce((x, l) => x + toEurCents(l.lineTotalCents, o.fxRate), 0),
    0
  );
  const openOrders = orders.filter((o) => !["RECEIVED", "COMPLETED"].includes(o.status)).length;
  const openInvoices = await db.invoice.count({
    where: { supplierId, type: "SUPPLIER", status: { in: ["OPEN", "PARTIALLY_PAID"] } },
  });
  const productIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)))];
  return { orderCount: orders.length, volumeEurCents, openOrders, openInvoices, productCount: productIds.length };
}

// ---------- Lagerwert ----------

export async function getInventoryValue(): Promise<{ valueCents: number; totalQty: number }> {
  const lots = await db.purchaseLot.findMany({
    where: { qtyRemaining: { gt: 0 } },
    select: { qtyRemaining: true, landedUnitCostEurCents: true },
  });
  return {
    valueCents: lots.reduce((a, l) => a + l.qtyRemaining * l.landedUnitCostEurCents, 0),
    totalQty: lots.reduce((a, l) => a + l.qtyRemaining, 0),
  };
}
