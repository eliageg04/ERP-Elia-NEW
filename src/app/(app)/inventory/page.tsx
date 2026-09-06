import Link from "next/link";
import { db } from "@/server/db";
import { getStockMap, getInboundInTransitMap } from "@/server/services/inventory";
import { getPoLineStats } from "@/server/services/purchasing";
import { getInventoryValue } from "@/server/services/stats";
import { PageHeader, StatCard, Table, THead, Th, Td, Tr, LinkButton, EmptyState, Badge } from "@/components/ui";
import { formatEur, toEurCents } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bestand" };

/**
 * Eingehende Ware: offene Vorbestellungen, die noch nicht (vollständig)
 * zugestellt sind – bewusst grau dargestellt, weil die Ware noch unterwegs ist.
 */
async function IncomingOrders() {
  const pos = await db.purchaseOrder.findMany({
    where: { status: { in: ["ORDERED", "CONFIRMED", "PARTIALLY_SHIPPED", "SHIPPED", "PARTIALLY_RECEIVED"] } },
    include: { supplier: true, lines: { include: { product: true } } },
    orderBy: { orderedAt: "desc" },
    take: 30,
  });
  if (pos.length === 0) return null;

  const rows: Array<{
    id: string;
    number: string;
    supplierName: string;
    orderedAt: Date | null;
    openUnits: number;
    openValueEur: number;
    shipped: boolean;
    products: string;
  }> = [];
  for (const po of pos) {
    const stats = await getPoLineStats(po.id);
    const openUnits = stats.reduce((a, s) => a + Math.max(0, s.ordered - s.arrived), 0);
    if (openUnits <= 0) continue;
    const unitValues = new Map(
      po.lines.map((l) => [l.id, l.qtyOrdered > 0 ? toEurCents(l.lineTotalCents, po.fxRate) / l.qtyOrdered : 0])
    );
    const openValueEur = Math.round(
      stats.reduce((a, s) => a + Math.max(0, s.ordered - s.arrived) * (unitValues.get(s.poLineId) ?? 0), 0)
    );
    rows.push({
      id: po.id,
      number: po.supplierOrderNumber ?? po.orderNumber,
      supplierName: po.supplier.name,
      orderedAt: po.orderedAt,
      openUnits,
      openValueEur,
      shipped: stats.some((s) => s.shipped > s.arrived),
      products: po.lines.map((l) => l.product.name).slice(0, 3).join(", ") + (po.lines.length > 3 ? " …" : ""),
    });
  }
  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-ink-secondary">
        Eingehende Ware ({rows.length} {rows.length === 1 ? "Bestellung" : "Bestellungen"} unterwegs)
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/purchase-orders/${r.id}`}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border border-dashed border-border bg-canvas/60 px-4 py-2.5 text-sm text-ink-secondary opacity-80 transition-opacity hover:opacity-100"
          >
            <span className="min-w-[160px]">
              <span className="font-medium text-ink">{r.number}</span>
              <span className="block text-xs text-ink-tertiary">{r.supplierName}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-tertiary">{r.products}</span>
            <span className="tnum text-xs">{formatDate(r.orderedAt)}</span>
            <span className="tnum">{formatNumber(r.openUnits)} Einheiten</span>
            <span className="tnum font-medium">{formatEur(r.openValueEur)}</span>
            <Badge tone={r.shipped ? "violet" : "neutral"}>{r.shipped ? "Versendet" : "Bestellt"}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const showAll = params.all === "1";

  const [inventoryValue, stockMap, inTransitMap, lots, products] = await Promise.all([
    getInventoryValue(),
    getStockMap(),
    getInboundInTransitMap(),
    db.purchaseLot.findMany({
      where: { qtyRemaining: { gt: 0 } },
      select: { productId: true, qtyRemaining: true, landedUnitCostEurCents: true },
    }),
    db.product.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }] } : {},
      orderBy: { name: "asc" },
    }),
  ]);

  // Ø Landed Cost + Bestandswert je Produkt aus den offenen Chargen (JS-Aggregation)
  const lotAgg = new Map<string, { qty: number; valueCents: number }>();
  for (const lot of lots) {
    const entry = lotAgg.get(lot.productId) ?? { qty: 0, valueCents: 0 };
    entry.qty += lot.qtyRemaining;
    entry.valueCents += lot.qtyRemaining * lot.landedUnitCostEurCents;
    lotAgg.set(lot.productId, entry);
  }

  // Globale Kennzahlen (unabhängig von Suche/Filter)
  let totalOnHand = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  for (const s of stockMap.values()) {
    totalOnHand += s.onHand;
    totalReserved += s.reserved;
    totalAvailable += s.available;
  }
  let totalInTransit = 0;
  for (const v of inTransitMap.values()) totalInTransit += v;

  const rows = products
    .map((p) => {
      const stock = stockMap.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 };
      const inTransit = inTransitMap.get(p.id) ?? 0;
      const agg = lotAgg.get(p.id);
      return {
        product: p,
        stock,
        inTransit,
        lotQty: agg?.qty ?? 0,
        valueCents: agg?.valueCents ?? 0,
        avgLandedCents: agg && agg.qty > 0 ? Math.round(agg.valueCents / agg.qty) : null,
      };
    })
    .filter((r) => showAll || r.stock.onHand > 0 || r.stock.reserved > 0 || r.inTransit > 0);

  // Summenzeile über die angezeigten Zeilen
  const sum = rows.reduce(
    (acc, r) => {
      acc.onHand += r.stock.onHand;
      acc.reserved += r.stock.reserved;
      acc.available += r.stock.available;
      acc.inTransit += r.inTransit;
      acc.lotQty += r.lotQty;
      acc.valueCents += r.valueCents;
      return acc;
    },
    { onHand: 0, reserved: 0, available: 0, inTransit: 0, lotQty: 0, valueCents: 0 }
  );
  const sumAvgLandedCents = sum.lotQty > 0 ? Math.round(sum.valueCents / sum.lotQty) : null;

  return (
    <div>
      <PageHeader
        title="Bestand"
        subtitle={`${rows.length} Produkte`}
        actions={<LinkButton href="/inventory/movements">Bewegungen ansehen</LinkButton>}
      />

      {/* Kennzahlen */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Lagerwert" value={formatEur(inventoryValue.valueCents)} hint="Landed Cost des Bestands" />
        <StatCard label="Gesamtbestand" value={formatNumber(totalOnHand)} hint="Basiseinheiten" />
        <StatCard label="Reserviert" value={formatNumber(totalReserved)} hint="für Kundenbestellungen" />
        <StatCard label="Frei verfügbar" value={formatNumber(totalAvailable)} />
        <StatCard label="Unterwegs" value={formatNumber(totalInTransit)} hint="vom Lieferanten versendet" />
      </div>

      <IncomingOrders />

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name oder SKU…"
          className="w-64 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
          <input type="checkbox" name="all" value="1" defaultChecked={showAll} />
          Alle Produkte zeigen
        </label>
        <button
          type="submit"
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
        >
          Filtern
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="Kein Bestand gefunden"
          hint={
            q
              ? "Suchbegriff anpassen oder „Alle Produkte zeigen“ aktivieren."
              : "Aktuell gibt es keine Produkte mit Bestand, Reservierung oder unterwegs befindlicher Ware."
          }
          action={<LinkButton href="/inventory?all=1">Alle Produkte zeigen</LinkButton>}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Produkt</Th>
              <Th>SKU</Th>
              <Th align="right">Bestand</Th>
              <Th align="right">Reserviert</Th>
              <Th align="right">Frei</Th>
              <Th align="right">Unterwegs</Th>
              <Th align="right">Ø Landed Cost</Th>
              <Th align="right">Bestandswert</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.product.id} muted={!r.product.active}>
                <Td>
                  <Link href={`/products/${r.product.id}`} className="font-medium hover:text-accent">
                    {r.product.name}
                  </Link>
                  {!r.product.active && <span className="block text-xs text-ink-tertiary">archiviert</span>}
                </Td>
                <Td className="font-mono text-xs text-ink-secondary">{r.product.sku}</Td>
                <Td align="right">{formatNumber(r.stock.onHand)}</Td>
                <Td align="right">{r.stock.reserved > 0 ? formatNumber(r.stock.reserved) : "–"}</Td>
                <Td align="right" className="font-medium">
                  {formatNumber(r.stock.available)}
                </Td>
                <Td align="right">{r.inTransit > 0 ? formatNumber(r.inTransit) : "–"}</Td>
                <Td align="right">{formatEur(r.avgLandedCents)}</Td>
                <Td align="right" className="font-medium">
                  {formatEur(r.valueCents)}
                </Td>
              </Tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-canvas font-medium">
              <Td colSpan={2}>Summe ({rows.length} Produkte)</Td>
              <Td align="right">{formatNumber(sum.onHand)}</Td>
              <Td align="right">{sum.reserved > 0 ? formatNumber(sum.reserved) : "–"}</Td>
              <Td align="right">{formatNumber(sum.available)}</Td>
              <Td align="right">{sum.inTransit > 0 ? formatNumber(sum.inTransit) : "–"}</Td>
              <Td align="right">{formatEur(sumAvgLandedCents)}</Td>
              <Td align="right">{formatEur(sum.valueCents)}</Td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}
