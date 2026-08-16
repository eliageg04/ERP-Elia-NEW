import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCoLineStats } from "@/server/services/sales";
import {
  getStockMap,
  getCurrentAvgCost,
  getInboundInTransitMap,
} from "@/server/services/inventory";
import {
  PageHeader,
  Card,
  StatCard,
  DL,
  DT,
  DD,
  Table,
  THead,
  Th,
  Td,
  Tr,
  LinkButton,
  StatusBadge,
  QtyProgress,
} from "@/components/ui";
import { ActionButton } from "@/components/form";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur, formatMoney, formatPercent, margin } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import {
  confirmOrderAction,
  cancelOrderAction,
  allocateAllAction,
  releaseAllocationAction,
  shipPreparedAction,
  deliveredAction,
  updateCoHeaderAction,
} from "@/server/actions/customer-orders";
import { CoForm } from "../co-form";
import {
  AddCoLineForm,
  AllocateLineForm,
  CoLineEditor,
  CreateCustomerShipmentForm,
} from "./panels";

export const dynamic = "force-dynamic";

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const co = await db.customerOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: {
        include: {
          product: { include: { baseUnit: true } },
          allocations: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } },
          _count: { select: { shipmentItems: true } },
        },
        orderBy: { position: "asc" },
      },
      shipments: { include: { items: true }, orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { issuedAt: "desc" } },
    },
  });
  if (!co) notFound();

  const [stats, stockMap, inTransitMap, customers, products] = await Promise.all([
    getCoLineStats(id),
    getStockMap(),
    getInboundInTransitMap(),
    db.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, listPriceCents: true },
    }),
  ]);
  const statsByLine = new Map(stats.map((s) => [s.lineId, s]));

  // Geschätzte Einstandskosten je Produkt (Ø Landed Cost des aktuellen Bestands)
  const lineProductIds = [...new Set(co.lines.map((l) => l.productId))];
  const avgCosts = await Promise.all(lineProductIds.map((pid) => getCurrentAvgCost(pid)));
  const avgCostMap = new Map<string, number | null>(
    lineProductIds.map((pid, i) => [pid, avgCosts[i]])
  );

  const totals = stats.reduce(
    (acc, s) => ({
      qty: acc.qty + s.qty,
      allocated: acc.allocated + s.allocated,
      shipped: acc.shipped + s.shipped,
      delivered: acc.delivered + s.delivered,
      open: acc.open + s.open,
    }),
    { qty: 0, allocated: 0, shipped: 0, delivered: 0, open: 0 }
  );

  const goodsValueCents = co.lines.reduce((a, l) => a + l.lineTotalCents, 0);
  const totalValueCents = goodsValueCents + co.shippingFeeCents;
  const estCostCents = co.lines.reduce(
    (a, l) => a + l.qty * (avgCostMap.get(l.productId) ?? 0),
    0
  );
  const expectedProfitCents = totalValueCents - estCostCents;

  // Realisierte Marge: Umsatz der versendeten Mengen vs. eingefrorene COGS
  const shippedRevenueCents = co.lines.reduce((a, l) => {
    const s = statsByLine.get(l.id);
    if (!s || s.shipped === 0 || l.qty <= 0) return a;
    return a + s.shipped * Math.round(l.lineTotalCents / l.qty);
  }, 0);
  const shippedCogsCents = co.shipments
    .filter((s) => s.status !== "PREPARED" && s.status !== "CANCELLED")
    .reduce((a, s) => a + s.items.reduce((b, i) => b + i.cogsEurCents, 0), 0);

  const isCancelled = co.status === "CANCELLED";
  const editable = !isCancelled && co.status !== "COMPLETED";
  const canCancel = editable && co.shipments.every((s) => s.status === "CANCELLED");
  const shippableLines = co.lines
    .map((l) => ({
      id: l.id,
      productName: l.product.name,
      allocated: statsByLine.get(l.id)?.allocated ?? 0,
    }))
    .filter((l) => l.allocated > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={co.orderNumber}
        backHref="/customer-orders"
        backLabel="Kundenbestellungen"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/customers/${co.customerId}`} className="font-medium hover:text-accent">
              {co.customer.name}
            </Link>
            <span>· {formatDate(co.orderedAt)}</span>
            <StatusBadge status={co.status} />
          </span>
        }
        actions={
          <>
            {co.status === "DRAFT" && (
              <ActionButton
                action={confirmOrderAction}
                variant="primary"
                size="md"
                hiddenFields={{ id }}
                confirmMessage="Bestellung bestätigen? Danach kann reserviert und versendet werden."
              >
                Bestätigen
              </ActionButton>
            )}
            {editable && totals.open > 0 && (
              <ActionButton action={allocateAllAction} size="md" hiddenFields={{ id }}>
                Alles Verfügbare reservieren
              </ActionButton>
            )}
            {canCancel && (
              <ActionButton
                action={cancelOrderAction}
                variant="danger"
                size="md"
                hiddenFields={{ id }}
                confirmMessage={`Bestellung ${co.orderNumber} wirklich stornieren? Aktive Reservierungen werden freigegeben.`}
              >
                Stornieren
              </ActionButton>
            )}
          </>
        }
      />

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Warenwert"
          value={formatEur(totalValueCents)}
          hint={co.shippingFeeCents > 0 ? `inkl. ${formatEur(co.shippingFeeCents)} Versand` : "EUR"}
        />
        <StatCard
          label="Geschätzte Kosten"
          value={formatEur(estCostCents)}
          hint="Ø Landed Cost des Bestands"
        />
        <StatCard
          label="Erwarteter Gewinn"
          value={formatEur(expectedProfitCents)}
          hint={`Marge ${formatPercent(margin(totalValueCents, estCostCents))}`}
          tone={expectedProfitCents < 0 ? "danger" : "default"}
        />
        <StatCard
          label="Offene Menge"
          value={formatNumber(totals.open)}
          hint="weder reserviert noch versendet"
          tone={totals.open > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Positionen */}
          <Card title="Positionen">
            {co.lines.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Positionen – unten die erste Position erfassen.
              </p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Produkt</Th>
                    <Th align="right">Menge</Th>
                    <Th align="right">VK/Einheit</Th>
                    <Th align="right">Rabatt</Th>
                    <Th align="right">Zeilensumme</Th>
                    <Th align="right">Verfügbar</Th>
                    <Th>Reserviert</Th>
                    <Th align="right">Versendet</Th>
                    <Th align="right">Zugestellt</Th>
                    <Th align="right">Offen</Th>
                    <Th>Reservierung</Th>
                    <Th align="right">Aktionen</Th>
                  </tr>
                </THead>
                <tbody>
                  {co.lines.map((l) => {
                    const s = statsByLine.get(l.id);
                    const allocated = s?.allocated ?? 0;
                    const shipped = s?.shipped ?? 0;
                    const delivered = s?.delivered ?? 0;
                    const open = s?.open ?? l.qty;
                    const stock = stockMap.get(l.productId) ?? {
                      onHand: 0,
                      reserved: 0,
                      available: 0,
                    };
                    const inTransit = inTransitMap.get(l.productId) ?? 0;
                    return (
                      <Tr key={l.id}>
                        <Td>
                          <Link href={`/products/${l.productId}`} className="font-medium hover:text-accent">
                            {l.product.name}
                          </Link>
                          <span className="block text-xs text-ink-tertiary">{l.product.sku}</span>
                        </Td>
                        <Td align="right" className="font-medium">
                          {formatNumber(l.qty)}
                          <span className="block text-xs text-ink-tertiary">
                            {l.product.baseUnit.name}
                          </span>
                        </Td>
                        <Td align="right">{formatEur(l.unitPriceCents)}</Td>
                        <Td align="right">
                          {l.discountCents > 0 ? `− ${formatEur(l.discountCents)}` : "–"}
                        </Td>
                        <Td align="right" className="font-medium">
                          {formatEur(l.lineTotalCents)}
                        </Td>
                        <Td align="right" className={stock.available <= 0 && open > 0 ? "text-warn font-medium" : undefined}>
                          {formatNumber(stock.available)}
                          {inTransit > 0 && (
                            <span className="block text-xs text-ink-tertiary">
                              {formatNumber(inTransit)} unterwegs
                            </span>
                          )}
                        </Td>
                        <Td>
                          <QtyProgress value={allocated} total={l.qty} toneWhenPartial="blue" />
                        </Td>
                        <Td align="right">{formatNumber(shipped)}</Td>
                        <Td align="right">{formatNumber(delivered)}</Td>
                        <Td align="right" className={open > 0 ? "text-warn font-medium" : undefined}>
                          {formatNumber(open)}
                        </Td>
                        <Td>
                          {editable ? (
                            <div className="flex flex-col gap-1.5">
                              <AllocateLineForm
                                orderLineId={l.id}
                                open={open}
                                available={stock.available}
                                inTransit={inTransit}
                              />
                              {l.allocations.length > 0 && (
                                <ul className="flex flex-col gap-1">
                                  {l.allocations.map((a) => (
                                    <li
                                      key={a.id}
                                      className="flex items-center gap-1.5 text-xs text-ink-secondary"
                                    >
                                      <span className="tnum">
                                        {formatNumber(a.qty)} Stk. · {formatDate(a.createdAt)}
                                      </span>
                                      <ActionButton
                                        action={releaseAllocationAction}
                                        variant="ghost"
                                        hiddenFields={{ allocationId: a.id }}
                                        confirmMessage={`Reservierung über ${a.qty} Stück wirklich freigeben?`}
                                      >
                                        Freigeben
                                      </ActionButton>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-tertiary">–</span>
                          )}
                        </Td>
                        <Td align="right">
                          {editable ? (
                            <CoLineEditor
                              line={{
                                id: l.id,
                                qty: l.qty,
                                unitPriceCents: l.unitPriceCents,
                                discountCents: l.discountCents,
                                reserved: allocated,
                              }}
                              canEdit={shipped === 0}
                              canDelete={l._count.shipmentItems === 0}
                            />
                          ) : (
                            <span className="text-xs text-ink-tertiary">–</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {editable && (
            <AddCoLineForm
              customerOrderId={id}
              products={products.map((p) => ({
                id: p.id,
                name: `${p.name} (${p.sku})`,
                available: stockMap.get(p.id)?.available ?? 0,
                listPriceCents: p.listPriceCents,
              }))}
            />
          )}

          {/* Versand */}
          <Card title="Versand">
            {co.shipments.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch kein Versand erstellt.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Status</Th>
                    <Th>Carrier</Th>
                    <Th>Tracking</Th>
                    <Th>Versendet</Th>
                    <Th>Zugestellt</Th>
                    <Th align="right">Einheiten</Th>
                    <Th align="right">COGS (EUR)</Th>
                    <Th align="right">Aktionen</Th>
                  </tr>
                </THead>
                <tbody>
                  {co.shipments.map((s) => (
                    <Tr key={s.id} muted={s.status === "CANCELLED"}>
                      <Td className="font-medium">{s.shipmentNumber}</Td>
                      <Td>
                        <StatusBadge status={s.status} />
                      </Td>
                      <Td>{s.carrier ?? "–"}</Td>
                      <Td className="font-mono text-xs">{s.trackingNumber ?? "–"}</Td>
                      <Td>{formatDate(s.shippedAt)}</Td>
                      <Td>{formatDate(s.deliveredAt)}</Td>
                      <Td align="right">{formatNumber(s.items.reduce((a, i) => a + i.qty, 0))}</Td>
                      <Td align="right">
                        {formatEur(s.items.reduce((a, i) => a + i.cogsEurCents, 0))}
                      </Td>
                      <Td align="right">
                        {s.status === "PREPARED" && (
                          <ActionButton
                            action={shipPreparedAction}
                            variant="primary"
                            hiddenFields={{ shipmentId: s.id }}
                            confirmMessage={`${s.shipmentNumber} als versendet buchen? Der Bestand wird ausgebucht.`}
                          >
                            Versenden
                          </ActionButton>
                        )}
                        {(s.status === "SHIPPED" || s.status === "IN_TRANSIT") && (
                          <ActionButton
                            action={deliveredAction}
                            hiddenFields={{ shipmentId: s.id }}
                            confirmMessage={`${s.shipmentNumber} als zugestellt markieren?`}
                          >
                            Als zugestellt markieren
                          </ActionButton>
                        )}
                        {(s.status === "DELIVERED" || s.status === "CANCELLED") && (
                          <span className="text-xs text-ink-tertiary">–</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {editable && co.status !== "DRAFT" && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium">Versand erstellen</h3>
                {shippableLines.length === 0 ? (
                  <p className="text-sm text-ink-tertiary">
                    Keine aktiven Reservierungen – zuerst Ware reservieren, dann versenden.
                  </p>
                ) : (
                  <CreateCustomerShipmentForm customerOrderId={id} lines={shippableLines} />
                )}
              </div>
            )}
            {co.status === "DRAFT" && (
              <p className="mt-3 text-xs text-ink-tertiary">
                Entwürfe können nicht versendet werden – Bestellung zuerst bestätigen.
              </p>
            )}
          </Card>

          {/* Rechnungen */}
          <Card
            title="Rechnungen"
            actions={
              !isCancelled ? (
                <LinkButton href={`/invoices/new?co=${id}`} size="sm">
                  Rechnung erstellen
                </LinkButton>
              ) : undefined
            }
          >
            {co.invoices.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Rechnungen verknüpft.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Datum</Th>
                    <Th align="right">Betrag</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {co.invoices.map((inv) => (
                    <Tr key={inv.id} muted={inv.status === "CANCELLED"}>
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-medium hover:text-accent">
                          {inv.invoiceNumber}
                        </Link>
                      </Td>
                      <Td>{formatDate(inv.issuedAt)}</Td>
                      <Td align="right" className="font-medium">
                        {formatMoney(inv.totalCents, inv.currency)}
                        {inv.currency !== "EUR" && (
                          <span className="block text-xs text-ink-tertiary">
                            {formatEur(inv.totalEurCents)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={inv.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Realisierte Marge */}
          {totals.shipped > 0 && (
            <Card title="Realisierte Marge (versendete Ware)">
              <DL>
                <DT>Umsatz (versendete Menge)</DT>
                <DD className="tnum">{formatEur(shippedRevenueCents)}</DD>
                <DT>Einkaufskosten (COGS, FIFO)</DT>
                <DD className="tnum">{formatEur(shippedCogsCents)}</DD>
                <DT>Gewinn</DT>
                <DD className="tnum font-medium">
                  {formatEur(shippedRevenueCents - shippedCogsCents)}
                </DD>
                <DT>Marge (Gewinn ÷ VK)</DT>
                <DD className="tnum font-medium">
                  {formatPercent(margin(shippedRevenueCents, shippedCogsCents))}
                </DD>
              </DL>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {/* Kopfdaten */}
          <Card title="Kopfdaten">
            <DL>
              <DT>Kunde</DT>
              <DD>
                <Link href={`/customers/${co.customerId}`} className="font-medium hover:text-accent">
                  {co.customer.name}
                </Link>
              </DD>
              <DT>Bestellt am</DT>
              <DD>{formatDate(co.orderedAt)}</DD>
              <DT>Versandkosten</DT>
              <DD className="tnum">{formatEur(co.shippingFeeCents)}</DD>
              <DT>Reserviert</DT>
              <DD className="tnum">{formatNumber(totals.allocated)}</DD>
              <DT>Versendet</DT>
              <DD className="tnum">
                {formatNumber(totals.shipped)} / {formatNumber(totals.qty)}
              </DD>
              <DT>Zugestellt</DT>
              <DD className="tnum">{formatNumber(totals.delivered)}</DD>
              <DT>Angelegt</DT>
              <DD>{formatDate(co.createdAt)}</DD>
              {co.cancelledAt && (
                <>
                  <DT>Storniert am</DT>
                  <DD>{formatDate(co.cancelledAt)}</DD>
                </>
              )}
            </DL>
            {editable && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-secondary hover:text-ink">
                  Kopfdaten bearbeiten
                </summary>
                <div className="mt-3">
                  <CoForm
                    action={updateCoHeaderAction}
                    customers={customers}
                    co={{
                      id: co.id,
                      customerId: co.customerId,
                      orderedAt: co.orderedAt ? co.orderedAt.toISOString() : null,
                      shippingFeeCents: co.shippingFeeCents,
                    }}
                  />
                </div>
              </details>
            )}
          </Card>

          <NotesPanel entityType="CUSTOMER_ORDER" entityId={id} />
          <HistoryPanel entityType="CUSTOMER_ORDER" entityId={id} />
        </div>
      </div>
    </div>
  );
}
