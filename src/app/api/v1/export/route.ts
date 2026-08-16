import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { getPurchasePriceStats } from "@/server/services/stats";
import { getStockMap } from "@/server/services/inventory";
import { toEurCents } from "@/lib/money";

// CSV-Export für deutsches Excel: Semikolon-getrennt, UTF-8 mit BOM,
// Beträge mit Komma-Dezimaltrennzeichen.

function eur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(";"), ...rows.map((r) => r.map(csvEscape).join(";"))];
  return "﻿" + lines.join("\r\n");
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const type = request.nextUrl.searchParams.get("type") ?? "";
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : null;
  const to = toParam ? new Date(toParam + "T23:59:59") : null;

  let csv: string;

  switch (type) {
    case "products": {
      const products = await db.product.findMany({ include: { baseUnit: true }, orderBy: { name: "asc" } });
      const stockMap = await getStockMap();
      csv = toCsv(
        ["SKU", "Name", "Set", "Sprache", "EAN", "Produktart", "Basiseinheit", "Bestand", "Reserviert", "Verfügbar", "Ziel-VK (EUR)", "Aktiv"],
        products.map((p) => {
          const s = stockMap.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 };
          return [p.sku, p.name, p.setName, p.language, p.ean, p.productType, p.baseUnit.name, s.onHand, s.reserved, s.available, eur(p.listPriceCents), p.active ? "ja" : "nein"];
        })
      );
      break;
    }
    case "inventory": {
      const lots = await db.purchaseLot.findMany({ where: { qtyRemaining: { gt: 0 } }, include: { product: true } });
      const agg = new Map<string, { sku: string; name: string; qty: number; value: number }>();
      for (const lot of lots) {
        const e = agg.get(lot.productId) ?? { sku: lot.product.sku, name: lot.product.name, qty: 0, value: 0 };
        e.qty += lot.qtyRemaining;
        e.value += lot.qtyRemaining * lot.landedUnitCostEurCents;
        agg.set(lot.productId, e);
      }
      csv = toCsv(
        ["SKU", "Produkt", "Bestand", "Bestandswert EUR (Landed Cost)"],
        [...agg.values()].map((e) => [e.sku, e.name, e.qty, eur(e.value)])
      );
      break;
    }
    case "customers": {
      const customers = await db.customer.findMany({ orderBy: { name: "asc" } });
      csv = toCsv(
        ["Kundennr", "Name", "Firma", "E-Mail", "Telefon", "Stadt", "Aktiv"],
        customers.map((c) => [c.code, c.name, c.company, c.email, c.phone, c.billingCity, c.active ? "ja" : "nein"])
      );
      break;
    }
    case "suppliers": {
      const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
      csv = toCsv(
        ["Code", "Name", "E-Mail", "Stadt", "Land", "Währung", "Zahlungsbedingungen", "Aktiv"],
        suppliers.map((s) => [s.code, s.name, s.email, s.city, s.country, s.currency, s.paymentTerms, s.active ? "ja" : "nein"])
      );
      break;
    }
    case "invoices": {
      const invoices = await db.invoice.findMany({
        include: { supplier: true, customer: true, payments: true },
        orderBy: { issuedAt: "desc" },
      });
      csv = toCsv(
        ["Nummer", "Extern", "Typ", "Partner", "Datum", "Fällig", "Währung", "Brutto", "Brutto EUR", "Bezahlt EUR", "Offen EUR", "Status"],
        invoices.map((inv) => {
          const paid = inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
          return [
            inv.invoiceNumber, inv.externalNumber,
            inv.type === "SUPPLIER" ? "Eingangsrechnung" : "Ausgangsrechnung",
            inv.supplier?.name ?? inv.customer?.name,
            inv.issuedAt.toLocaleDateString("de-DE"), inv.dueAt?.toLocaleDateString("de-DE"),
            inv.currency, eur(inv.totalCents), eur(inv.totalEurCents), eur(paid),
            inv.status === "CANCELLED" ? "0,00" : eur(inv.totalEurCents - paid), inv.status,
          ];
        })
      );
      break;
    }
    case "payments": {
      const payments = await db.payment.findMany({ include: { invoice: true }, orderBy: { paidAt: "desc" } });
      csv = toCsv(
        ["Datum", "Richtung", "Betrag EUR", "Währung", "Originalbetrag", "Rechnung", "Methode", "Referenz"],
        payments.map((p) => [
          p.paidAt.toLocaleDateString("de-DE"),
          p.direction === "INCOMING" ? "Eingehend" : "Ausgehend",
          eur(p.amountEurCents), p.currency, eur(p.amountCents),
          p.invoice?.invoiceNumber, p.method, p.reference,
        ])
      );
      break;
    }
    case "profit-by-product": {
      const items = await db.customerShipmentItem.findMany({
        where: {
          shipment: {
            status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] },
            ...(from || to ? { shippedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          },
        },
        include: { orderLine: { include: { product: true } } },
      });
      const agg = new Map<string, { sku: string; name: string; qty: number; revenue: number; cogs: number }>();
      for (const item of items) {
        const line = item.orderLine;
        const discountPerUnit = line.qty > 0 ? line.discountCents / line.qty : 0;
        const e = agg.get(line.productId) ?? { sku: line.product.sku, name: line.product.name, qty: 0, revenue: 0, cogs: 0 };
        e.qty += item.qty;
        e.revenue += Math.round(item.qty * (line.unitPriceCents - discountPerUnit));
        e.cogs += item.cogsEurCents;
        agg.set(line.productId, e);
      }
      csv = toCsv(
        ["SKU", "Produkt", "Verkauft", "Umsatz EUR", "Einkaufskosten EUR", "Gewinn EUR", "Marge %"],
        [...agg.values()].map((e) => [
          e.sku, e.name, e.qty, eur(e.revenue), eur(e.cogs), eur(e.revenue - e.cogs),
          e.revenue > 0 ? (((e.revenue - e.cogs) / e.revenue) * 100).toFixed(1).replace(".", ",") : "",
        ])
      );
      break;
    }
    case "revenue-by-customer": {
      const items = await db.customerShipmentItem.findMany({
        where: {
          shipment: {
            status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] },
            ...(from || to ? { shippedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          },
        },
        include: { orderLine: { include: { order: { include: { customer: true } } } } },
      });
      const agg = new Map<string, { code: string; name: string; qty: number; revenue: number; cogs: number }>();
      for (const item of items) {
        const line = item.orderLine;
        const customer = line.order.customer;
        const discountPerUnit = line.qty > 0 ? line.discountCents / line.qty : 0;
        const e = agg.get(customer.id) ?? { code: customer.code, name: customer.name, qty: 0, revenue: 0, cogs: 0 };
        e.qty += item.qty;
        e.revenue += Math.round(item.qty * (line.unitPriceCents - discountPerUnit));
        e.cogs += item.cogsEurCents;
        agg.set(customer.id, e);
      }
      csv = toCsv(
        ["Kundennr", "Kunde", "Menge", "Umsatz EUR", "Gewinn EUR"],
        [...agg.values()].map((e) => [e.code, e.name, e.qty, eur(e.revenue), eur(e.revenue - e.cogs)])
      );
      break;
    }
    case "purchases-by-supplier": {
      const lines = await db.purchaseOrderLine.findMany({
        where: {
          purchaseOrder: {
            status: { notIn: ["DRAFT", "CANCELLED"] },
            ...(from || to ? { orderedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          },
        },
        include: { purchaseOrder: { include: { supplier: true } } },
      });
      const agg = new Map<string, { name: string; orders: Set<string>; units: number; value: number }>();
      for (const line of lines) {
        const e = agg.get(line.purchaseOrder.supplierId) ?? { name: line.purchaseOrder.supplier.name, orders: new Set<string>(), units: 0, value: 0 };
        e.orders.add(line.purchaseOrderId);
        e.units += line.qtyOrdered;
        e.value += toEurCents(line.lineTotalCents, line.purchaseOrder.fxRate);
        agg.set(line.purchaseOrder.supplierId, e);
      }
      csv = toCsv(
        ["Großhändler", "Bestellungen", "Einheiten", "Warenwert EUR"],
        [...agg.values()].map((e) => [e.name, e.orders.size, e.units, eur(e.value)])
      );
      break;
    }
    case "purchases-by-product": {
      const stats = await getPurchasePriceStats();
      const products = await db.product.findMany({ where: { id: { in: [...stats.keys()] } } });
      const nameById = new Map(products.map((p) => [p.id, { sku: p.sku, name: p.name }]));
      csv = toCsv(
        ["SKU", "Produkt", "Menge", "Ø EK gewichtet EUR", "Niedrigster EUR", "Höchster EUR", "Gesamtkosten EUR"],
        [...stats.entries()].map(([id, s]) => [
          nameById.get(id)?.sku, nameById.get(id)?.name, s.totalQty,
          eur(s.weightedAvgCents), eur(s.lowestCents), eur(s.highestCents), eur(s.totalCostCents),
        ])
      );
      break;
    }
    default:
      return NextResponse.json({ error: `Unbekannter Export-Typ: ${type}` }, { status: 400 });
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${date}.csv"`,
    },
  });
}
