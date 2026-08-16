import { db } from "../db";
import { getPoLineStats } from "./purchasing";
import { getCoLineStats } from "./sales";
import { getStockMap } from "./inventory";
import { formatEur } from "@/lib/money";
import { daysAgo } from "@/lib/format";

export type Warning = {
  severity: "high" | "medium" | "low";
  category: string;
  message: string;
  href: string; // Deep-Link zum betroffenen Datensatz
};

/**
 * Warn-Engine: prüft aktiv auf operative Probleme.
 * Wird auf dem Dashboard und im Warnungs-Panel angezeigt.
 */
export async function computeWarnings(): Promise<Warning[]> {
  const warnings: Warning[] = [];

  // --- Einkauf: überfällig, Teillieferung, Mengenabweichung, fehlendes Tracking ---
  const openPos = await db.purchaseOrder.findMany({
    where: { status: { in: ["ORDERED", "CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED"] } },
    include: { supplier: true, shipments: true },
  });
  for (const po of openPos) {
    const stats = await getPoLineStats(po.id);
    const totals = {
      ordered: stats.reduce((a, s) => a + s.ordered, 0),
      shipped: stats.reduce((a, s) => a + s.shipped, 0),
      arrived: stats.reduce((a, s) => a + s.arrived, 0),
      missing: stats.reduce((a, s) => a + s.missing, 0),
      damaged: stats.reduce((a, s) => a + s.damaged, 0),
    };
    const href = `/purchase-orders/${po.id}`;
    if (po.expectedAt && po.expectedAt < new Date() && totals.arrived < totals.ordered) {
      warnings.push({
        severity: "high",
        category: "Überfällige Lieferung",
        message: `${po.orderNumber} (${po.supplier.name}) war für ${po.expectedAt.toLocaleDateString("de-DE")} erwartet – ${totals.ordered - totals.arrived} Einheiten offen.`,
        href,
      });
    }
    if (totals.missing > 0) {
      warnings.push({
        severity: "high",
        category: "Fehlmenge",
        message: `${po.orderNumber}: ${totals.missing} Einheiten fehlen laut Wareneingang.`,
        href,
      });
    }
    if (totals.damaged > 0) {
      warnings.push({
        severity: "medium",
        category: "Beschädigte Ware",
        message: `${po.orderNumber}: ${totals.damaged} Einheiten beschädigt angekommen.`,
        href,
      });
    }
    if (totals.arrived > totals.shipped && totals.shipped > 0) {
      warnings.push({
        severity: "medium",
        category: "Mengenabweichung",
        message: `${po.orderNumber}: ${totals.arrived} angekommen, aber nur ${totals.shipped} als versendet gemeldet.`,
        href,
      });
    }
    const shippedNoTracking = po.shipments.filter(
      (s) => ["IN_TRANSIT", "DELAYED"].includes(s.status) && !s.trackingNumber
    );
    if (shippedNoTracking.length > 0) {
      warnings.push({
        severity: "low",
        category: "Fehlendes Tracking",
        message: `${po.orderNumber}: ${shippedNoTracking.length} Sendung(en) ohne Trackingnummer unterwegs.`,
        href,
      });
    }
    if (po.status === "ORDERED" && po.orderedAt && daysAgo(po.orderedAt) >= 14 && totals.shipped === 0) {
      warnings.push({
        severity: "medium",
        category: "Keine Bewegung",
        message: `${po.orderNumber} ist seit ${daysAgo(po.orderedAt)} Tagen bestellt, aber noch nichts versendet.`,
        href,
      });
    }
    if (po.statusOverridden) {
      warnings.push({
        severity: "low",
        category: "Manueller Status",
        message: `${po.orderNumber}: Status wurde manuell gesetzt (${po.overrideReason ?? "ohne Begründung"}) – Zahlen weichen ggf. ab.`,
        href,
      });
    }
  }

  // --- Tracking ohne Bewegung ---
  const staleShipments = await db.inboundShipment.findMany({
    where: { status: { in: ["IN_TRANSIT", "DELAYED"] }, trackingNumber: { not: null } },
    include: { trackingEvents: { orderBy: { occurredAt: "desc" }, take: 1 }, purchaseOrder: true },
  });
  for (const s of staleShipments) {
    const lastMove = s.trackingEvents[0]?.occurredAt ?? s.shippedAt;
    if (lastMove && daysAgo(lastMove) >= 5) {
      warnings.push({
        severity: "medium",
        category: "Tracking ohne Bewegung",
        message: `Sendung ${s.shipmentNumber} (${s.trackingNumber}): seit ${daysAgo(lastMove)} Tagen keine Bewegung.`,
        href: `/purchase-orders/${s.purchaseOrderId}`,
      });
    }
  }

  // --- Verkauf: Reservierung ohne Deckung, versandbereite Bestellungen ---
  const openCos = await db.customerOrder.findMany({
    where: { status: { in: ["CONFIRMED", "PARTIALLY_SHIPPED"] } },
    include: { customer: true },
  });
  const stockMap = await getStockMap();
  for (const co of openCos) {
    const stats = await getCoLineStats(co.id);
    for (const s of stats) {
      const stock = stockMap.get(s.productId);
      if (stock && stock.available < 0) {
        warnings.push({
          severity: "high",
          category: "Überbuchung",
          message: `${co.orderNumber} (${co.customer.name}): Produkt ist stärker reserviert als vorhanden.`,
          href: `/customer-orders/${co.id}`,
        });
      }
    }
    const allAllocated = stats.every((s) => s.open === 0);
    const nothingShipped = stats.every((s) => s.shipped === 0);
    if (allAllocated && nothingShipped && stats.length > 0 && daysAgo(co.orderedAt) >= 7) {
      warnings.push({
        severity: "medium",
        category: "Versand fällig",
        message: `${co.orderNumber} (${co.customer.name}) ist seit ${daysAgo(co.orderedAt)} Tagen vollständig reserviert, aber nicht versendet.`,
        href: `/customer-orders/${co.id}`,
      });
    }
  }

  // --- Finanzen: offene / überfällige Rechnungen ---
  const openInvoices = await db.invoice.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
    include: { payments: true, supplier: true, customer: true },
  });
  for (const inv of openInvoices) {
    const paid = inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
    const open = inv.totalEurCents - paid;
    if (inv.dueAt && inv.dueAt < new Date()) {
      warnings.push({
        severity: "high",
        category: "Rechnung überfällig",
        message: `${inv.invoiceNumber} (${inv.supplier?.name ?? inv.customer?.name ?? ""}): ${formatEur(open)} seit ${daysAgo(inv.dueAt)} Tagen überfällig.`,
        href: `/invoices/${inv.id}`,
      });
    } else if (open >= 500_000) {
      warnings.push({
        severity: "medium",
        category: "Offene Zahlung",
        message: `${inv.invoiceNumber}: ${formatEur(open)} offen.`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  // --- Verkauf ohne bekannten Einkaufspreis ---
  const shippedItems = await db.customerShipmentItem.findMany({
    where: { cogsEurCents: 0, qty: { gt: 0 }, shipment: { status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] } } },
    include: { orderLine: { include: { product: true, order: true } } },
    take: 20,
  });
  for (const item of shippedItems) {
    warnings.push({
      severity: "medium",
      category: "Unbekannter Einkaufspreis",
      message: `${item.orderLine.product.name} wurde ohne hinterlegten Einkaufspreis versendet (${item.orderLine.order.orderNumber}).`,
      href: `/customer-orders/${item.orderLine.order.id}`,
    });
  }

  // --- Import-Inbox ---
  const pendingImports = await db.importItem.count({
    where: { status: "PENDING", batch: { status: "REVIEW" } },
  });
  if (pendingImports > 0) {
    warnings.push({
      severity: "low",
      category: "Import-Inbox",
      message: `${pendingImports} importierte Position(en) warten auf Prüfung.`,
      href: "/imports",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return warnings.sort((a, b) => order[a.severity] - order[b.severity]);
}
