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
  StatusBadge,
  LinkButton,
  EmptyState,
  Badge,
  buttonClass,
} from "@/components/ui";
import { formatEur, toEurCents, weightedAverageCents } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { label } from "@/lib/constants";
import { PoUploadForm } from "./po-upload-form";
import { PoTrackingForm, PoDeliveredButton } from "./po-card-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // KI-Analyse von PDF-Rechnungen braucht Zeit
export const metadata = { title: "Vorbestellungen" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; supplierId?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "product" ? "product" : "supplier";

  const [suppliers, ai] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.integrationConfig.findUnique({ where: { provider: "AI" } }),
  ]);
  const aiEnabled = Boolean(
    (ai?.enabled && ai.config && JSON.parse(ai.config)?.apiKey) || process.env.ANTHROPIC_API_KEY
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Vorbestellungen"
        subtitle="Bestellungen beim Großhändler – Tracking hinzufügen, Zustellung abhaken, fertig."
        actions={
          <LinkButton href="/purchase-orders/new" variant="primary">
            Neue Bestellung
          </LinkButton>
        }
      />

      <PoUploadForm suppliers={suppliers} aiEnabled={aiEnabled} />

      {/* Ansicht umschalten */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/purchase-orders"
          className={buttonClass(view === "supplier" ? "primary" : "secondary", "sm")}
        >
          Bestellungen
        </Link>
        <Link
          href="/purchase-orders?view=product"
          className={buttonClass(view === "product" ? "primary" : "secondary", "sm")}
        >
          Nach Produkt (Ø-EK)
        </Link>
      </div>

      {view === "supplier" ? (
        <PoCardList supplierId={params.supplierId} suppliers={suppliers} />
      ) : (
        <ProductView />
      )}
    </div>
  );
}

// ---------- Vereinfachte Statusanzeige ----------

function simpleStatus(status: string): { text: string; tone: "neutral" | "blue" | "amber" | "green" | "red" | "violet" } {
  switch (status) {
    case "DRAFT":
      return { text: "In Erfassung", tone: "neutral" };
    case "ORDERED":
    case "CONFIRMED":
      return { text: "Bestellt", tone: "blue" };
    case "PARTIALLY_SHIPPED":
      return { text: "Teilweise versendet", tone: "amber" };
    case "SHIPPED":
      return { text: "Versendet", tone: "violet" };
    case "PARTIALLY_RECEIVED":
      return { text: "Teilweise zugestellt", tone: "amber" };
    case "RECEIVED":
    case "COMPLETED":
      return { text: "Zugestellt", tone: "green" };
    case "CANCELLED":
      return { text: "Storniert", tone: "red" };
    default:
      return { text: label(status), tone: "neutral" };
  }
}

// ---------- Ansicht: Bestellkarten ----------

async function PoCardList({
  supplierId,
  suppliers,
}: {
  supplierId?: string;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const pos = await db.purchaseOrder.findMany({
    where: {
      ...(supplierId ? { supplierId } : {}),
      status: { not: "CANCELLED" },
    },
    include: {
      supplier: true,
      lines: { include: { product: true }, orderBy: { position: "asc" } },
      shipments: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

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
      {/* Filter nach Lieferant */}
      {suppliers.length > 1 && (
        <form method="get" className="flex flex-wrap items-center gap-2">
          <select
            name="supplierId"
            defaultValue={supplierId ?? ""}
            className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">Alle Lieferanten</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
          >
            Filtern
          </button>
        </form>
      )}

      {pos.length === 0 ? (
        <EmptyState
          title="Keine Bestellungen"
          hint="Lade eine Rechnungs-PDF hoch oder lege eine Bestellung manuell an."
          action={
            <LinkButton href="/purchase-orders/new" variant="primary">
              Neue Bestellung
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {pos.map((po) => {
            const totals = totalsByPo.get(po.id) ?? { ordered: 0, shipped: 0, arrived: 0 };
            const valueEur = po.lines.reduce((a, l) => a + toEurCents(l.lineTotalCents, po.fxRate), 0);
            const st = simpleStatus(po.status);
            const fullyShipped = totals.ordered > 0 && totals.shipped >= totals.ordered;
            const fullyArrived = totals.ordered > 0 && totals.arrived >= totals.ordered;
            const tracked = po.shipments.filter((s) => s.trackingNumber);
            return (
              <details key={po.id} className="group rounded-xl border border-border bg-surface">
                <summary className="cursor-pointer select-none px-4 py-3 hover:bg-canvas/60">
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <div className="min-w-[180px]">
                      <span className="font-medium">
                        {po.supplierOrderNumber ?? po.orderNumber}
                      </span>
                      <span className="block text-xs text-ink-tertiary">
                        {po.supplierOrderNumber ? po.orderNumber : "ohne Ordernummer"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                      <span>
                        <span className="block text-xs text-ink-tertiary">Lieferant</span>
                        <span className="font-medium">{po.supplier.name}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-ink-tertiary">Bestellt am</span>
                        <span className="tnum">{formatDate(po.orderedAt)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-ink-tertiary">Einheiten</span>
                        <span className="tnum">{formatNumber(totals.ordered)}</span>
                      </span>
                      <span>
                        <span className="block text-xs text-ink-tertiary">Warenwert</span>
                        <span className="tnum font-medium">{formatEur(valueEur)}</span>
                      </span>
                      <Badge tone={st.tone}>{st.text}</Badge>
                    </div>
                  </div>
                </summary>
                <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
                  {/* Positionen */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {po.lines.map((l) => (
                          <tr key={l.id} className="border-b border-border/60 last:border-0">
                            <td className="py-1.5 pr-4">
                              <Link href={`/products/${l.productId}`} className="hover:text-accent">
                                {l.product.name}
                              </Link>
                            </td>
                            <td className="tnum py-1.5 pr-4 text-right">{formatNumber(l.qtyOrdered)} ×</td>
                            <td className="tnum py-1.5 pr-4 text-right">
                              {formatEur(toEurCents(l.unitPriceCents, po.fxRate))}
                            </td>
                            <td className="tnum py-1.5 text-right font-medium">
                              {formatEur(toEurCents(l.lineTotalCents, po.fxRate))}
                            </td>
                          </tr>
                        ))}
                        {po.lines.length === 0 && (
                          <tr>
                            <td className="py-1.5 text-ink-tertiary">
                              Noch keine Positionen – über „Details öffnen“ erfassen.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Tracking & Zustellung */}
                  {!fullyArrived && po.lines.length > 0 && (
                    <div className="flex flex-col gap-3 rounded-lg bg-canvas/70 p-3">
                      {tracked.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                            Tracking
                          </span>
                          {tracked.map((s) => (
                            <Badge key={s.id} tone="violet">
                              {s.carrier ? `${label(s.carrier)} · ` : ""}
                              {s.trackingNumber}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {!fullyShipped && <PoTrackingForm poId={po.id} />}
                      {(totals.shipped > 0 || fullyShipped) && (
                        <div>
                          <PoDeliveredButton poId={po.id} />
                        </div>
                      )}
                    </div>
                  )}
                  {fullyArrived && (
                    <p className="text-sm font-medium text-ok">
                      ✓ Zugestellt und im Bestand eingebucht
                      {po.shipments[0]?.arrivedAt ? ` (${formatDate(po.shipments[0].arrivedAt)})` : ""}.
                    </p>
                  )}

                  <div>
                    <Link
                      href={`/purchase-orders/${po.id}`}
                      className="text-sm font-medium text-ink-secondary hover:text-accent"
                    >
                      Details öffnen (Positionen bearbeiten, Teillieferungen, Kosten) →
                    </Link>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
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
