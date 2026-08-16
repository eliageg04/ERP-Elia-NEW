import { db } from "../db";

export type SearchResult = {
  type: string; // "Produkt" | "Bestellung" | ...
  title: string;
  subtitle?: string;
  href: string;
};

/**
 * Globale Suche über Produkte, Bestellungen, Kunden, Lieferanten,
 * Rechnungen und Trackingnummern. Tolerant (Teilstring, case-insensitiv).
 */
export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const results: SearchResult[] = [];

  const [products, pos, cos, customers, suppliers, invoices, inboundByTracking, outboundByTracking] =
    await Promise.all([
      db.product.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { sku: { contains: q } },
            { ean: { contains: q } },
            { setName: { contains: q } },
          ],
        },
        take: limit,
      }),
      db.purchaseOrder.findMany({
        where: {
          OR: [{ orderNumber: { contains: q } }, { supplierOrderNumber: { contains: q } }],
        },
        include: { supplier: true },
        take: limit,
      }),
      db.customerOrder.findMany({
        where: { orderNumber: { contains: q } },
        include: { customer: true },
        take: limit,
      }),
      db.customer.findMany({
        where: {
          OR: [{ name: { contains: q } }, { company: { contains: q } }, { code: { contains: q } }, { email: { contains: q } }],
        },
        take: limit,
      }),
      db.supplier.findMany({
        where: { OR: [{ name: { contains: q } }, { code: { contains: q } }] },
        take: limit,
      }),
      db.invoice.findMany({
        where: { OR: [{ invoiceNumber: { contains: q } }, { externalNumber: { contains: q } }] },
        include: { supplier: true, customer: true },
        take: limit,
      }),
      db.inboundShipment.findMany({
        where: { trackingNumber: { contains: q } },
        include: { purchaseOrder: true },
        take: limit,
      }),
      db.customerShipment.findMany({
        where: { trackingNumber: { contains: q } },
        include: { order: true },
        take: limit,
      }),
    ]);

  for (const p of products) {
    results.push({
      type: "Produkt",
      title: p.name,
      subtitle: [p.sku, p.setName, p.language].filter(Boolean).join(" · "),
      href: `/products/${p.id}`,
    });
  }
  for (const po of pos) {
    results.push({
      type: "Einkauf",
      title: po.orderNumber,
      subtitle: po.supplier.name,
      href: `/purchase-orders/${po.id}`,
    });
  }
  for (const co of cos) {
    results.push({
      type: "Kundenbestellung",
      title: co.orderNumber,
      subtitle: co.customer.name,
      href: `/customer-orders/${co.id}`,
    });
  }
  for (const c of customers) {
    results.push({ type: "Kunde", title: c.name, subtitle: c.company ?? c.code, href: `/customers/${c.id}` });
  }
  for (const s of suppliers) {
    results.push({ type: "Großhändler", title: s.name, subtitle: s.code, href: `/suppliers/${s.id}` });
  }
  for (const inv of invoices) {
    results.push({
      type: "Rechnung",
      title: inv.invoiceNumber + (inv.externalNumber ? ` (${inv.externalNumber})` : ""),
      subtitle: inv.supplier?.name ?? inv.customer?.name ?? undefined,
      href: `/invoices/${inv.id}`,
    });
  }
  for (const s of inboundByTracking) {
    results.push({
      type: "Tracking",
      title: s.trackingNumber ?? s.shipmentNumber,
      subtitle: `Eingehend · ${s.purchaseOrder.orderNumber}`,
      href: `/purchase-orders/${s.purchaseOrderId}`,
    });
  }
  for (const s of outboundByTracking) {
    results.push({
      type: "Tracking",
      title: s.trackingNumber ?? s.shipmentNumber,
      subtitle: `Ausgehend · ${s.order.orderNumber}`,
      href: `/customer-orders/${s.customerOrderId}`,
    });
  }
  return results.slice(0, 20);
}
