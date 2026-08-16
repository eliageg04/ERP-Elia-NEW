import Link from "next/link";
import { db } from "@/server/db";
import { getPurchasePriceStats, getInventoryValue } from "@/server/services/stats";
import { PageHeader, Card, Table, THead, Th, Td, Tr } from "@/components/ui";
import { formatEur, formatPercent, toEurCents } from "@/lib/money";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margen & Reports" };

function csvLink(type: string, from?: string, to?: string) {
  const params = new URLSearchParams({ type });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `/api/v1/export?${params.toString()}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const from = params.from ? new Date(params.from) : null;
  const to = params.to ? new Date(params.to + "T23:59:59") : null;

  const shippedFilter = {
    shipment: {
      status: { in: ["SHIPPED", "IN_TRANSIT", "DELIVERED"] },
      ...(from || to
        ? { shippedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
  };

  // Versendete Positionen im Zeitraum (Basis für Gewinn nach Produkt & Kunde)
  const shippedItems = await db.customerShipmentItem.findMany({
    where: shippedFilter,
    include: {
      orderLine: { include: { product: true, order: { include: { customer: true } } } },
    },
  });

  type Agg = { qty: number; revenue: number; cogs: number };
  const byProduct = new Map<string, Agg & { name: string; id: string }>();
  const byCustomer = new Map<string, Agg & { name: string; id: string }>();
  for (const item of shippedItems) {
    const line = item.orderLine;
    const discountPerUnit = line.qty > 0 ? line.discountCents / line.qty : 0;
    const revenue = Math.round(item.qty * (line.unitPriceCents - discountPerUnit));
    const p = byProduct.get(line.productId) ?? { qty: 0, revenue: 0, cogs: 0, name: line.product.name, id: line.productId };
    p.qty += item.qty;
    p.revenue += revenue;
    p.cogs += item.cogsEurCents;
    byProduct.set(line.productId, p);
    const c = byCustomer.get(line.order.customerId) ?? { qty: 0, revenue: 0, cogs: 0, name: line.order.customer.name, id: line.order.customerId };
    c.qty += item.qty;
    c.revenue += revenue;
    c.cogs += item.cogsEurCents;
    byCustomer.set(line.order.customerId, c);
  }
  const productRows = [...byProduct.values()].sort((a, b) => (b.revenue - b.cogs) - (a.revenue - a.cogs)).slice(0, 50);
  const customerRows = [...byCustomer.values()].sort((a, b) => (b.revenue - b.cogs) - (a.revenue - a.cogs)).slice(0, 50);

  // Einkauf nach Großhändler
  const poLines = await db.purchaseOrderLine.findMany({
    where: {
      purchaseOrder: {
        status: { notIn: ["DRAFT", "CANCELLED"] },
        ...(from || to
          ? { orderedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
    },
    include: { purchaseOrder: { include: { supplier: true } } },
  });
  const bySupplier = new Map<string, { name: string; id: string; orders: Set<string>; units: number; value: number }>();
  for (const line of poLines) {
    const s = bySupplier.get(line.purchaseOrder.supplierId) ?? {
      name: line.purchaseOrder.supplier.name,
      id: line.purchaseOrder.supplierId,
      orders: new Set<string>(),
      units: 0,
      value: 0,
    };
    s.orders.add(line.purchaseOrderId);
    s.units += line.qtyOrdered;
    s.value += toEurCents(line.lineTotalCents, line.purchaseOrder.fxRate);
    bySupplier.set(line.purchaseOrder.supplierId, s);
  }
  const supplierRows = [...bySupplier.values()].sort((a, b) => b.value - a.value);

  // Einkauf nach Produkt (gesamt, gewichteter Durchschnitt)
  const priceStats = await getPurchasePriceStats();
  const products = await db.product.findMany({ where: { id: { in: [...priceStats.keys()] } } });
  const productNameById = new Map(products.map((p) => [p.id, p.name]));
  const purchaseRows = [...priceStats.entries()]
    .map(([id, s]) => ({ id, name: productNameById.get(id) ?? id, ...s }))
    .sort((a, b) => b.totalCostCents - a.totalCostCents)
    .slice(0, 50);

  // Lagerwert
  const invValue = await getInventoryValue();
  const lots = await db.purchaseLot.findMany({
    where: { qtyRemaining: { gt: 0 } },
    include: { product: true },
  });
  const stockValueByProduct = new Map<string, { name: string; id: string; qty: number; value: number }>();
  for (const lot of lots) {
    const e = stockValueByProduct.get(lot.productId) ?? { name: lot.product.name, id: lot.productId, qty: 0, value: 0 };
    e.qty += lot.qtyRemaining;
    e.value += lot.qtyRemaining * lot.landedUnitCostEurCents;
    stockValueByProduct.set(lot.productId, e);
  }
  const stockRows = [...stockValueByProduct.values()].sort((a, b) => b.value - a.value).slice(0, 20);

  const totals = {
    revenue: productRows.reduce((a, r) => a + r.revenue, 0),
    cogs: productRows.reduce((a, r) => a + r.cogs, 0),
  };

  const ExportLink = ({ type }: { type: string }) => (
    <a
      href={csvLink(type, params.from, params.to)}
      className="text-xs font-medium text-accent hover:underline"
    >
      CSV exportieren
    </a>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Margen & Reports" subtitle="Auswertungen auf Basis tatsächlich versendeter Ware (eingefrorene FIFO-Einkaufskosten)" />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Von</span>
          <input type="date" name="from" defaultValue={params.from ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-secondary">Bis</span>
          <input type="date" name="to" defaultValue={params.to ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm" />
        </label>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Anwenden
        </button>
        {(params.from || params.to) && (
          <Link href="/reports" className="px-2 py-1.5 text-sm text-ink-tertiary hover:text-ink">
            Zurücksetzen
          </Link>
        )}
      </form>

      <Card title="Gewinn nach Produkt" actions={<ExportLink type="profit-by-product" />}>
        {productRows.length === 0 ? (
          <p className="text-sm text-ink-tertiary">Keine versendeten Verkäufe im Zeitraum.</p>
        ) : (
          <Table className="border-0">
            <THead>
              <tr>
                <Th>Produkt</Th>
                <Th align="right">Verkauft</Th>
                <Th align="right">Umsatz</Th>
                <Th align="right">Einkaufskosten</Th>
                <Th align="right">Gewinn</Th>
                <Th align="right">Marge</Th>
              </tr>
            </THead>
            <tbody>
              {productRows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/products/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></Td>
                  <Td align="right">{formatNumber(r.qty)}</Td>
                  <Td align="right">{formatEur(r.revenue)}</Td>
                  <Td align="right">{formatEur(r.cogs)}</Td>
                  <Td align="right" className="font-medium">{formatEur(r.revenue - r.cogs)}</Td>
                  <Td align="right">{r.revenue > 0 ? formatPercent((r.revenue - r.cogs) / r.revenue) : "–"}</Td>
                </Tr>
              ))}
              <Tr className="bg-canvas/60 font-medium">
                <Td>Gesamt</Td>
                <Td align="right">{formatNumber(productRows.reduce((a, r) => a + r.qty, 0))}</Td>
                <Td align="right">{formatEur(totals.revenue)}</Td>
                <Td align="right">{formatEur(totals.cogs)}</Td>
                <Td align="right">{formatEur(totals.revenue - totals.cogs)}</Td>
                <Td align="right">{totals.revenue > 0 ? formatPercent((totals.revenue - totals.cogs) / totals.revenue) : "–"}</Td>
              </Tr>
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Umsatz & Gewinn nach Kunde" actions={<ExportLink type="revenue-by-customer" />}>
        {customerRows.length === 0 ? (
          <p className="text-sm text-ink-tertiary">Keine versendeten Verkäufe im Zeitraum.</p>
        ) : (
          <Table className="border-0">
            <THead>
              <tr>
                <Th>Kunde</Th>
                <Th align="right">Menge</Th>
                <Th align="right">Umsatz</Th>
                <Th align="right">Gewinn</Th>
                <Th align="right">Marge</Th>
              </tr>
            </THead>
            <tbody>
              {customerRows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/customers/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></Td>
                  <Td align="right">{formatNumber(r.qty)}</Td>
                  <Td align="right">{formatEur(r.revenue)}</Td>
                  <Td align="right" className="font-medium">{formatEur(r.revenue - r.cogs)}</Td>
                  <Td align="right">{r.revenue > 0 ? formatPercent((r.revenue - r.cogs) / r.revenue) : "–"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Einkauf nach Großhändler" actions={<ExportLink type="purchases-by-supplier" />}>
        {supplierRows.length === 0 ? (
          <p className="text-sm text-ink-tertiary">Keine Bestellungen im Zeitraum.</p>
        ) : (
          <Table className="border-0">
            <THead>
              <tr>
                <Th>Großhändler</Th>
                <Th align="right">Bestellungen</Th>
                <Th align="right">Einheiten</Th>
                <Th align="right">Warenwert (EUR)</Th>
              </tr>
            </THead>
            <tbody>
              {supplierRows.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/suppliers/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></Td>
                  <Td align="right">{formatNumber(r.orders.size)}</Td>
                  <Td align="right">{formatNumber(r.units)}</Td>
                  <Td align="right">{formatEur(r.value)}</Td>
                </Tr>
              ))}
              <Tr className="bg-canvas/60 font-medium">
                <Td>Gesamt</Td>
                <Td align="right">{formatNumber(supplierRows.reduce((a, r) => a + r.orders.size, 0))}</Td>
                <Td align="right">{formatNumber(supplierRows.reduce((a, r) => a + r.units, 0))}</Td>
                <Td align="right">{formatEur(supplierRows.reduce((a, r) => a + r.value, 0))}</Td>
              </Tr>
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Einkauf nach Produkt (gesamte Historie)" actions={<ExportLink type="purchases-by-product" />}>
        <Table className="border-0">
          <THead>
            <tr>
              <Th>Produkt</Th>
              <Th align="right">Menge</Th>
              <Th align="right">Ø EK (gewichtet)</Th>
              <Th align="right">Niedrigster</Th>
              <Th align="right">Höchster</Th>
              <Th align="right">Gesamtkosten</Th>
            </tr>
          </THead>
          <tbody>
            {purchaseRows.map((r) => (
              <Tr key={r.id}>
                <Td><Link href={`/products/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></Td>
                <Td align="right">{formatNumber(r.totalQty)}</Td>
                <Td align="right" className="font-medium">{formatEur(r.weightedAvgCents)}</Td>
                <Td align="right">{formatEur(r.lowestCents)}</Td>
                <Td align="right">{formatEur(r.highestCents)}</Td>
                <Td align="right">{formatEur(r.totalCostCents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card
        title={`Lagerwert: ${formatEur(invValue.valueCents)} (${formatNumber(invValue.totalQty)} Einheiten)`}
        actions={<ExportLink type="inventory" />}
      >
        <Table className="border-0">
          <THead>
            <tr>
              <Th>Produkt</Th>
              <Th align="right">Bestand</Th>
              <Th align="right">Bestandswert (Landed Cost)</Th>
            </tr>
          </THead>
          <tbody>
            {stockRows.map((r) => (
              <Tr key={r.id}>
                <Td><Link href={`/products/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></Td>
                <Td align="right">{formatNumber(r.qty)}</Td>
                <Td align="right" className="font-medium">{formatEur(r.value)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
