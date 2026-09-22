import { db } from "../db";
import { toEurCents } from "@/lib/money";
import { getInventoryValue } from "./stats";
import { getStockMap } from "./inventory";
import { getPoLineStatsBulk } from "./purchasing";
import { getCoLineStatsBulk } from "./sales";

export type DashboardData = {
  purchase: {
    openPoCount: number;
    orderedUnits: number;
    notShippedUnits: number;
    inTransitUnits: number;
    partiallyReceivedCount: number;
    openPurchaseValueCents: number; // Warenwert noch nicht angekommener Bestellmengen
  };
  inventory: {
    valueCents: number;
    totalOnHand: number;
    totalReserved: number;
    totalAvailable: number;
    recentReceipts: Array<{ id: string; productName: string; qty: number; receivedAt: Date; receiptNumber: string; poId: string }>;
  };
  sales: {
    openOrderCount: number;
    toShipCount: number; // vollständig reserviert, noch nicht versendet
    inTransitCount: number;
    openPaymentsCents: number;
  };
  finance: {
    openInvoiceCount: number;
    openInvoiceCents: number;
    paidInvoiceCount: number;
    purchaseVolumeCents: number; // letzte 30 Tage
    salesVolumeCents: number; // letzte 30 Tage
    grossMarginPct: number | null;
  };
  todos: Array<{ label: string; count: number; href: string }>;
};

export async function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  // Alle unabhängigen Abfragen parallel (Neon: Latenz dominiert, nicht Last)
  const [
    openPos,
    invValue,
    stockMap,
    recentReceiptItems,
    openCos,
    inTransitCount,
    openInvoices,
    paidInvoiceCount,
    recentPoLines,
    recentShippedItems,
    pendingImports,
    draftPos,
  ] = await Promise.all([
    db.purchaseOrder.findMany({
      where: {
        status: { in: ["ORDERED", "CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED"] },
      },
      include: { lines: true },
    }),
    getInventoryValue(),
    getStockMap(),
    db.goodsReceiptItem.findMany({
      where: { qtyReceived: { gt: 0 } },
      include: {
        receipt: true,
        poLine: { include: { product: true } },
      },
      orderBy: { receipt: { receivedAt: "desc" } },
      take: 6,
    }),
    db.customerOrder.findMany({
      where: { status: { in: ["CONFIRMED", "PARTIALLY_SHIPPED"] } },
    }),
    db.customerShipment.count({ where: { status: { in: ["SHIPPED", "IN_TRANSIT"] } } }),
    db.invoice.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      include: { payments: true },
    }),
    db.invoice.count({ where: { status: "PAID" } }),
    db.purchaseOrderLine.findMany({
      where: { purchaseOrder: { orderedAt: { gte: thirtyDaysAgo }, status: { notIn: ["DRAFT", "CANCELLED"] } } },
      include: { purchaseOrder: true },
    }),
    db.customerShipmentItem.findMany({
      where: { shipment: { shippedAt: { gte: thirtyDaysAgo }, status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] } } },
      include: { orderLine: true },
    }),
    db.importItem.count({ where: { status: "PENDING", batch: { status: "REVIEW" } } }),
    db.purchaseOrder.count({ where: { status: "DRAFT" } }),
  ]);

  // Zeilen-Statistiken gebündelt (je EINE Abfrage statt eine pro Bestellung)
  const [poStatsMap, coStatsMap] = await Promise.all([
    getPoLineStatsBulk(openPos.map((po) => po.id)),
    getCoLineStatsBulk(openCos.map((co) => co.id)),
  ]);

  // --- Einkauf ---
  let orderedUnits = 0;
  let notShippedUnits = 0;
  let inTransitUnits = 0;
  let openPurchaseValueCents = 0;
  let partiallyReceivedCount = 0;
  for (const po of openPos) {
    const stats = poStatsMap.get(po.id) ?? [];
    for (const s of stats) {
      orderedUnits += s.ordered;
      notShippedUnits += Math.max(0, s.ordered - s.shipped);
      inTransitUnits += s.inTransit;
      const line = po.lines.find((l) => l.id === s.poLineId);
      if (line && s.open > 0 && line.qtyOrdered > 0) {
        const openValue = Math.round((toEurCents(line.lineTotalCents, po.fxRate) * s.open) / line.qtyOrdered);
        openPurchaseValueCents += openValue;
      }
    }
    if (po.status === "PARTIALLY_RECEIVED") partiallyReceivedCount++;
  }

  // --- Lager ---
  let totalOnHand = 0;
  let totalReserved = 0;
  for (const s of stockMap.values()) {
    totalOnHand += s.onHand;
    totalReserved += s.reserved;
  }

  // --- Verkauf ---
  let toShipCount = 0;
  for (const co of openCos) {
    const stats = coStatsMap.get(co.id) ?? [];
    if (stats.length > 0 && stats.every((s) => s.open === 0) && stats.some((s) => s.allocated > 0)) {
      toShipCount++;
    }
  }

  // --- Finanzen ---
  const openInvoiceCents = openInvoices.reduce(
    (a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0),
    0
  );
  const customerOpenInvoices = openInvoices.filter((i) => i.type === "CUSTOMER");
  const openPaymentsCents = customerOpenInvoices.reduce(
    (a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0),
    0
  );

  const purchaseVolumeCents = recentPoLines.reduce(
    (a, l) => a + toEurCents(l.lineTotalCents, l.purchaseOrder.fxRate),
    0
  );
  let salesVolumeCents = 0;
  let cogsCents = 0;
  for (const item of recentShippedItems) {
    const discountPerUnit = item.orderLine.qty > 0 ? item.orderLine.discountCents / item.orderLine.qty : 0;
    salesVolumeCents += Math.round(item.qty * (item.orderLine.unitPriceCents - discountPerUnit));
    cogsCents += item.cogsEurCents;
  }
  const grossMarginPct = salesVolumeCents > 0 ? (salesVolumeCents - cogsCents) / salesVolumeCents : null;

  // --- Was muss ich heute tun? ---
  const todos: DashboardData["todos"] = [];
  const receiptsToCheck = openPos.filter((po) => ["SHIPPED", "PARTIALLY_RECEIVED", "PARTIALLY_SHIPPED"].includes(po.status)).length;
  if (receiptsToCheck > 0) todos.push({ label: "Lieferungen prüfen / Wareneingang buchen", count: receiptsToCheck, href: "/goods-receipts" });
  if (toShipCount > 0) todos.push({ label: "Kundenbestellungen versenden", count: toShipCount, href: "/customer-orders?filter=ready" });
  const overdueInvoices = openInvoices.filter((i) => i.dueAt && i.dueAt < now).length;
  if (overdueInvoices > 0) todos.push({ label: "Überfällige Rechnungen klären", count: overdueInvoices, href: "/invoices?filter=overdue" });
  if (pendingImports > 0) todos.push({ label: "Importe prüfen", count: pendingImports, href: "/imports" });
  if (draftPos > 0) todos.push({ label: "Bestellentwürfe abschließen", count: draftPos, href: "/purchase-orders?status=DRAFT" });

  return {
    purchase: {
      openPoCount: openPos.length,
      orderedUnits,
      notShippedUnits,
      inTransitUnits,
      partiallyReceivedCount,
      openPurchaseValueCents,
    },
    inventory: {
      valueCents: invValue.valueCents,
      totalOnHand,
      totalReserved,
      totalAvailable: totalOnHand - totalReserved,
      recentReceipts: recentReceiptItems.map((r) => ({
        id: r.id,
        productName: r.poLine.product.name,
        qty: r.qtyReceived,
        receivedAt: r.receipt.receivedAt,
        receiptNumber: r.receipt.receiptNumber,
        poId: r.receipt.purchaseOrderId,
      })),
    },
    sales: {
      openOrderCount: openCos.length,
      toShipCount,
      inTransitCount,
      openPaymentsCents,
    },
    finance: {
      openInvoiceCount: openInvoices.length,
      openInvoiceCents,
      paidInvoiceCount,
      purchaseVolumeCents,
      salesVolumeCents,
      grossMarginPct,
    },
    todos,
  };
}
