import Link from "next/link";
import { db } from "@/server/db";
import { getPoLineStats } from "@/server/services/purchasing";
import {
  PageHeader,
  Table,
  THead,
  Th,
  Td,
  Tr,
  QtyProgress,
  StatusBadge,
  LinkButton,
  EmptyState,
  buttonClass,
} from "@/components/ui";
import { formatEur, toEurCents, weightedAverageCents } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { label, PO_STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vorbestellungen" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; supplierId?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "product" ? "product" : "supplier";

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <PageHeader
        title="Vorbestellungen / Einkauf"
        subtitle="Bestellungen beim Großhändler – nach Lieferant oder nach Produkt gruppiert"
        actions={
          <LinkButton href="/purchase-orders/new" variant="primary">
            Neue Bestellung
          </LinkButton>
        }
      />

      {/* Ansicht umschalten */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/purchase-orders"
          className={buttonClass(view === "supplier" ? "primary" : "secondary", "sm")}
        >
          Nach Lieferant
        </Link>
        <Link
          href="/purchase-orders?view=product"
          className={buttonClass(view === "product" ? "primary" : "secondary", "sm")}
        >
          Nach Produkt
        </Link>
      </div>

      {view === "supplier" ? (
        <SupplierView status={params.status} supplierId={params.supplierId} suppliers={suppliers} />
      ) : (
        <ProductView />
      )}
    </div>
  );
}

// ---------- Ansicht: Bestellungen je Lieferant ----------

async function SupplierView({
  status,
  supplierId,
  suppliers,
}: {
  status?: string;
  supplierId?: string;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const pos = await db.purchaseOrder.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: { supplier: true, lines: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Versand-/Eingangsfortschritt je Bestellung
  const totalsByPo = new Map<string, { ordered: number; shipped: number; arrived: number }>();
  for (const po of pos) {
    const stats = await getPoLineStats(po.id);
    totalsByPo.set(po.id, {
      ordered: stats.reduce((a, s) => a + s.ordered, 0),
      shipped: stats.reduce((a, s) => a + s.shipped, 0),
      arrived: stats.reduce((a, s) => a + s.arrived, 0),
    });
  }

  return (
    <>
      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value="supplier" />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Status</option>
          {PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          name="supplierId"
          defaultValue={supplierId ?? ""}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Lieferanten</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
        >
          Filtern
        </button>
      </form>

      {pos.length === 0 ? (
        <EmptyState
          title="Keine Bestellungen gefunden"
          hint="Filter anpassen oder eine neue Bestellung anlegen."
          action={
            <LinkButton href="/purchase-orders/new" variant="primary">
              Neue Bestellung
            </LinkButton>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Nummer</Th>
              <Th>Lieferant</Th>
              <Th>Status</Th>
              <Th>Bestellt am</Th>
              <Th>Erwartet</Th>
              <Th align="right">Positionen</Th>
              <Th align="right">Einheiten</Th>
              <Th align="right">Warenwert (EUR)</Th>
              <Th>Versendet</Th>
              <Th>Angekommen</Th>
            </tr>
          </THead>
          <tbody>
            {pos.map((po) => {
              const totals = totalsByPo.get(po.id) ?? { ordered: 0, shipped: 0, arrived: 0 };
              const valueEur = po.lines.reduce((a, l) => a + toEurCents(l.lineTotalCents, po.fxRate), 0);
              return (
                <Tr key={po.id} muted={po.status === "CANCELLED"}>
                  <Td>
                    <Link href={`/purchase-orders/${po.id}`} className="font-medium hover:text-accent">
                      {po.orderNumber}
                    </Link>
                    {po.supplierOrderNumber && (
                      <span className="block text-xs text-ink-tertiary">{po.supplierOrderNumber}</span>
                    )}
                  </Td>
                  <Td>
                    <Link href={`/suppliers/${po.supplierId}`} className="hover:text-accent">
                      {po.supplier.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={po.status} />
                    {po.statusOverridden && (
                      <span
                        className="ml-1 text-xs text-warn"
                        title={po.overrideReason ?? "Status manuell gesetzt"}
                      >
                        manuell
                      </span>
                    )}
                  </Td>
                  <Td>{formatDate(po.orderedAt)}</Td>
                  <Td>{formatDate(po.expectedAt)}</Td>
                  <Td align="right">{formatNumber(po.lines.length)}</Td>
                  <Td align="right">{formatNumber(totals.ordered)}</Td>
                  <Td align="right" className="font-medium">
                    {formatEur(valueEur)}
                  </Td>
                  <Td>
                    <QtyProgress value={totals.shipped} total={totals.ordered} toneWhenPartial="blue" />
                  </Td>
                  <Td>
                    <QtyProgress value={totals.arrived} total={totals.ordered} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

// ---------- Ansicht: Bestellzeilen je Produkt ----------

async function ProductView() {
  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrder: { status: { notIn: ["DRAFT", "CANCELLED"] } } },
    include: {
      product: { include: { baseUnit: true } },
      purchaseOrder: { include: { supplier: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  type Group = {
    productId: string;
    name: string;
    sku: string;
    baseUnitName: string;
    totalQty: number;
    totalCostEur: number;
    entries: Array<{ qty: number; unitPriceCents: number }>;
    rows: Array<{
      lineId: string;
      supplierId: string;
      supplierName: string;
      poId: string;
      poNumber: string;
      poStatus: string;
      qty: number;
      unitEur: number | null;
    }>;
  };

  const groups = new Map<string, Group>();
  for (const l of lines) {
    const g = groups.get(l.productId) ?? {
      productId: l.productId,
      name: l.product.name,
      sku: l.product.sku,
      baseUnitName: l.product.baseUnit.name,
      totalQty: 0,
      totalCostEur: 0,
      entries: [],
      rows: [],
    };
    const lineTotalEur = toEurCents(l.lineTotalCents, l.purchaseOrder.fxRate);
    const unitEur = l.qtyOrdered > 0 ? Math.round(lineTotalEur / l.qtyOrdered) : null;
    g.totalQty += l.qtyOrdered;
    g.totalCostEur += lineTotalEur;
    if (l.qtyOrdered > 0 && unitEur !== null) {
      g.entries.push({ qty: l.qtyOrdered, unitPriceCents: unitEur });
    }
    g.rows.push({
      lineId: l.id,
      supplierId: l.purchaseOrder.supplierId,
      supplierName: l.purchaseOrder.supplier.name,
      poId: l.purchaseOrderId,
      poNumber: l.purchaseOrder.orderNumber,
      poStatus: l.purchaseOrder.status,
      qty: l.qtyOrdered,
      unitEur,
    });
    groups.set(l.productId, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  if (sorted.length === 0) {
    return (
      <EmptyState
        title="Noch keine Bestellzeilen"
        hint="Es gibt noch keine bestellten Positionen (Entwürfe und stornierte Bestellungen werden hier nicht gezählt)."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((g) => {
        const prices = g.entries.map((e) => e.unitPriceCents);
        const avg = weightedAverageCents(g.entries);
        const lowest = prices.length ? Math.min(...prices) : null;
        const highest = prices.length ? Math.max(...prices) : null;
        return (
          <details key={g.productId} className="rounded-lg border border-border bg-surface">
            <summary className="cursor-pointer select-none px-4 py-3 hover:bg-canvas/60">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div className="min-w-[200px]">
                  <Link href={`/products/${g.productId}`} className="font-medium hover:text-accent">
                    {g.name}
                  </Link>
                  <span className="block text-xs text-ink-tertiary">{g.sku}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <span>
                    <span className="block text-xs text-ink-tertiary">Gesamtmenge</span>
                    <span className="tnum font-medium">
                      {formatNumber(g.totalQty)} {g.baseUnitName}
                    </span>
                  </span>
                  <span>
                    <span className="block text-xs text-ink-tertiary">Gewichteter Ø-EK</span>
                    <span className="tnum font-medium">{formatEur(avg)}</span>
                  </span>
                  <span>
                    <span className="block text-xs text-ink-tertiary">Niedrigster</span>
                    <span className="tnum">{formatEur(lowest)}</span>
                  </span>
                  <span>
                    <span className="block text-xs text-ink-tertiary">Höchster</span>
                    <span className="tnum">{formatEur(highest)}</span>
                  </span>
                  <span>
                    <span className="block text-xs text-ink-tertiary">Gesamtkosten</span>
                    <span className="tnum font-medium">{formatEur(g.totalCostEur)}</span>
                  </span>
                </div>
              </div>
            </summary>
            <div className="border-t border-border p-3">
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Lieferant</Th>
                    <Th>Bestellung</Th>
                    <Th>Status</Th>
                    <Th align="right">Menge</Th>
                    <Th align="right">EK/Basiseinheit (EUR)</Th>
                  </tr>
                </THead>
                <tbody>
                  {g.rows.map((r) => (
                    <Tr key={r.lineId}>
                      <Td>
                        <Link href={`/suppliers/${r.supplierId}`} className="hover:text-accent">
                          {r.supplierName}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/purchase-orders/${r.poId}`} className="font-medium hover:text-accent">
                          {r.poNumber}
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge status={r.poStatus} />
                      </Td>
                      <Td align="right">{formatNumber(r.qty)}</Td>
                      <Td align="right">{formatEur(r.unitEur)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
