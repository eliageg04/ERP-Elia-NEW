import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getPoLineStats, computeOverheadPerUnit } from "@/server/services/purchasing";
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
  Badge,
  StatusBadge,
  QtyProgress,
} from "@/components/ui";
import { ActionButton } from "@/components/form";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur, formatMoney, toEurCents } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { label } from "@/lib/constants";
import {
  markOrderedAction,
  markConfirmedAction,
  cancelPoAction,
  clearOverrideAction,
  updatePoHeaderAction,
} from "@/server/actions/purchase-orders";
import { PoForm } from "../po-form";
import {
  AddPoLineForm,
  PoLineEditor,
  ConfirmPoForm,
  StatusOverrideForm,
  CreateShipmentForm,
  AddCostForm,
} from "./panels";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: {
        include: {
          product: { include: { baseUnit: true } },
          enteredUnit: true,
          _count: { select: { shipmentItems: true, receiptItems: true } },
        },
        orderBy: { position: "asc" },
      },
      shipments: { include: { items: true }, orderBy: { createdAt: "desc" } },
      goodsReceipts: { include: { items: true }, orderBy: { receivedAt: "desc" } },
      invoices: { orderBy: { issuedAt: "desc" } },
      costs: { orderBy: { incurredAt: "desc" } },
    },
  });
  if (!po) notFound();

  const [stats, products, units, suppliers] = await Promise.all([
    getPoLineStats(id),
    db.product.findMany({
      where: { active: true },
      include: { baseUnit: true, conversions: true },
      orderBy: { name: "asc" },
    }),
    db.unit.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
  ]);

  const statsByLine = new Map(stats.map((s) => [s.poLineId, s]));
  const totals = stats.reduce(
    (acc, s) => ({
      ordered: acc.ordered + s.ordered,
      shipped: acc.shipped + s.shipped,
      arrived: acc.arrived + s.arrived,
      open: acc.open + s.open,
    }),
    { ordered: 0, shipped: 0, arrived: 0, open: 0 }
  );
  const goodsValueEur = po.lines.reduce((a, l) => a + toEurCents(l.lineTotalCents, po.fxRate), 0);
  const overheadEur = po.costs.reduce((a, c) => a + c.amountEurCents, 0);
  const overheadPerUnit = computeOverheadPerUnit(po);

  const isCancelled = po.status === "CANCELLED";
  const editable = !isCancelled && po.status !== "COMPLETED";
  const canCancel = editable && po.goodsReceipts.length === 0;
  const shippableLines = po.lines
    .map((l) => {
      const s = statsByLine.get(l.id);
      return {
        id: l.id,
        productName: l.product.name,
        remaining: Math.max(0, l.qtyOrdered - (s?.shipped ?? 0)),
      };
    })
    .filter((l) => l.remaining > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={po.orderNumber}
        backHref="/purchase-orders"
        backLabel="Vorbestellungen"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/suppliers/${po.supplierId}`} className="font-medium hover:text-accent">
              {po.supplier.name}
            </Link>
            {po.supplierOrderNumber && (
              <span className="font-mono text-xs">· {po.supplierOrderNumber}</span>
            )}
            <StatusBadge status={po.status} />
            {po.statusOverridden && (
              <span title={po.overrideReason ?? "Status manuell gesetzt"}>
                <Badge tone="amber">Status manuell</Badge>
              </span>
            )}
            {po.currency !== "EUR" && (
              <Badge>
                {po.currency} · Kurs {po.fxRate}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {po.status === "DRAFT" && (
              <ActionButton
                action={markOrderedAction}
                variant="primary"
                size="md"
                hiddenFields={{ id }}
                confirmMessage="Bestellung als bestellt markieren?"
              >
                Als bestellt markieren
              </ActionButton>
            )}
            {po.status === "ORDERED" && (
              <ActionButton action={markConfirmedAction} size="md" hiddenFields={{ id }}>
                Bestätigen
              </ActionButton>
            )}
            {po.statusOverridden && (
              <ActionButton action={clearOverrideAction} size="md" hiddenFields={{ id }}>
                Override aufheben
              </ActionButton>
            )}
            {canCancel && (
              <ActionButton
                action={cancelPoAction}
                variant="danger"
                size="md"
                hiddenFields={{ id }}
                confirmMessage={`Bestellung ${po.orderNumber} wirklich stornieren?`}
              >
                Stornieren
              </ActionButton>
            )}
          </>
        }
      />

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Positionen" value={formatNumber(po.lines.length)} />
        <StatCard label="Bestellt" value={formatNumber(totals.ordered)} hint="Basiseinheiten" />
        <StatCard label="Versendet" value={formatNumber(totals.shipped)} />
        <StatCard label="Angekommen" value={formatNumber(totals.arrived)} />
        <StatCard label="Offen" value={formatNumber(totals.open)} tone={totals.open > 0 ? "warn" : "default"} />
        <StatCard label="Warenwert" value={formatEur(goodsValueEur)} hint="EUR, Kurs eingefroren" />
        <StatCard label="Nebenkosten" value={formatEur(overheadEur)} hint="Versand, Zoll, Gebühren" />
        <StatCard label="Landed gesamt" value={formatEur(goodsValueEur + overheadEur)} hint="Warenwert + Nebenkosten" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Positionen */}
          <Card title="Positionen">
            {po.lines.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Positionen – unten die erste Position erfassen.
              </p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Produkt</Th>
                    <Th align="right">Erfasst</Th>
                    <Th align="right">Bestellt</Th>
                    <Th>Versendet</Th>
                    <Th>Angekommen</Th>
                    <Th align="right">Offen</Th>
                    <Th align="right">EK/Einheit</Th>
                    <Th align="right">EK/Basiseinheit (EUR)</Th>
                    <Th align="right">Zeilensumme</Th>
                    <Th align="right">Aktionen</Th>
                  </tr>
                </THead>
                <tbody>
                  {po.lines.map((l) => {
                    const s = statsByLine.get(l.id);
                    const shipped = s?.shipped ?? 0;
                    const arrivedOk = s?.arrivedOk ?? 0;
                    const damaged = s?.damaged ?? 0;
                    const arrived = s?.arrived ?? 0;
                    const open = s?.open ?? l.qtyOrdered;
                    const lineTotalEur = toEurCents(l.lineTotalCents, po.fxRate);
                    const unitEur = l.qtyOrdered > 0 ? Math.round(lineTotalEur / l.qtyOrdered) : null;
                    const overhead = overheadPerUnit.get(l.id) ?? 0;
                    return (
                      <Tr key={l.id}>
                        <Td>
                          <Link href={`/products/${l.productId}`} className="font-medium hover:text-accent">
                            {l.product.name}
                          </Link>
                          <span className="block text-xs text-ink-tertiary">{l.product.sku}</span>
                        </Td>
                        <Td align="right">
                          {formatNumber(l.enteredQty)} × {l.enteredUnit.name}
                          <span className="block text-xs text-ink-tertiary">
                            Faktor {l.unitFactor}
                          </span>
                        </Td>
                        <Td align="right" className="font-medium">
                          {formatNumber(l.qtyOrdered)}
                          {l.qtyConfirmed !== null && l.qtyConfirmed !== l.qtyOrdered && (
                            <span className="block text-xs text-warn">
                              bestätigt: {formatNumber(l.qtyConfirmed)}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <QtyProgress value={shipped} total={l.qtyOrdered} toneWhenPartial="blue" />
                        </Td>
                        <Td>
                          <QtyProgress value={arrived} total={l.qtyOrdered} />
                          {damaged > 0 && (
                            <span className="block text-xs text-danger">
                              {formatNumber(arrivedOk)} OK · {formatNumber(damaged)} beschädigt
                            </span>
                          )}
                        </Td>
                        <Td align="right">{formatNumber(open)}</Td>
                        <Td align="right">
                          {formatMoney(l.unitPriceCents, po.currency)}
                          {l.discountCents > 0 && (
                            <span className="block text-xs text-ink-tertiary">
                              − {formatMoney(l.discountCents, po.currency)} Rabatt
                            </span>
                          )}
                        </Td>
                        <Td align="right">
                          {formatEur(unitEur)}
                          {overhead > 0 && unitEur !== null && (
                            <span className="block text-xs text-ink-tertiary">
                              Landed {formatEur(unitEur + overhead)}
                            </span>
                          )}
                        </Td>
                        <Td align="right" className="font-medium">
                          {formatMoney(l.lineTotalCents, po.currency)}
                          {po.currency !== "EUR" && (
                            <span className="block text-xs text-ink-tertiary">{formatEur(lineTotalEur)}</span>
                          )}
                        </Td>
                        <Td align="right">
                          {editable ? (
                            <PoLineEditor
                              line={{
                                id: l.id,
                                enteredQty: l.enteredQty,
                                unitFactor: l.unitFactor,
                                unitPriceCents: l.unitPriceCents,
                                discountCents: l.discountCents,
                                unitName: l.enteredUnit.name,
                              }}
                              canDelete={l._count.shipmentItems === 0 && l._count.receiptItems === 0}
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
            <AddPoLineForm
              purchaseOrderId={id}
              currency={po.currency}
              products={products.map((p) => ({
                id: p.id,
                name: p.name,
                sku: p.sku,
                baseUnitId: p.baseUnitId,
                baseUnitName: p.baseUnit.name,
                conversions: p.conversions.map((c) => ({ unitId: c.unitId, factor: c.factor })),
              }))}
              units={units}
            />
          )}

          {po.status === "ORDERED" && (
            <ConfirmPoForm
              poId={id}
              lines={po.lines.map((l) => ({
                id: l.id,
                productName: l.product.name,
                qtyOrdered: l.qtyOrdered,
              }))}
            />
          )}

          {/* Sendungen */}
          <Card title="Sendungen">
            {po.shipments.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Sendungen gemeldet.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Status</Th>
                    <Th>Carrier</Th>
                    <Th>Tracking</Th>
                    <Th>Versendet am</Th>
                    <Th>ETA</Th>
                    <Th align="right">Einheiten</Th>
                    <Th align="right">Pakete</Th>
                  </tr>
                </THead>
                <tbody>
                  {po.shipments.map((s) => (
                    <Tr key={s.id} muted={s.status === "CANCELLED"}>
                      <Td className="font-medium">{s.shipmentNumber}</Td>
                      <Td>
                        <StatusBadge status={s.status} />
                      </Td>
                      <Td>{s.carrier ?? "–"}</Td>
                      <Td className="font-mono text-xs">{s.trackingNumber ?? "–"}</Td>
                      <Td>{formatDate(s.shippedAt)}</Td>
                      <Td>{formatDate(s.estimatedArrival)}</Td>
                      <Td align="right">{formatNumber(s.items.reduce((a, i) => a + i.qty, 0))}</Td>
                      <Td align="right">{s.packageCount !== null ? formatNumber(s.packageCount) : "–"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {editable && po.status !== "DRAFT" && shippableLines.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium">Sendung melden</h3>
                <CreateShipmentForm poId={id} lines={shippableLines} />
              </div>
            )}
          </Card>

          {/* Wareneingänge */}
          <Card
            title="Wareneingänge"
            actions={
              editable && po.status !== "DRAFT" ? (
                <LinkButton href={`/goods-receipts/new?po=${id}`} size="sm" variant="primary">
                  Wareneingang buchen
                </LinkButton>
              ) : undefined
            }
          >
            {po.goodsReceipts.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Wareneingänge gebucht.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Datum</Th>
                    <Th align="right">OK</Th>
                    <Th align="right">Beschädigt</Th>
                    <Th align="right">Fehlend</Th>
                  </tr>
                </THead>
                <tbody>
                  {po.goodsReceipts.map((r) => {
                    const ok = r.items.reduce((a, i) => a + i.qtyReceived, 0);
                    const dmg = r.items.reduce((a, i) => a + i.qtyDamaged, 0);
                    const missing = r.items.reduce((a, i) => a + i.qtyMissing, 0);
                    return (
                      <Tr key={r.id}>
                        <Td>
                          <Link href={`/goods-receipts/${r.id}`} className="font-medium hover:text-accent">
                            {r.receiptNumber}
                          </Link>
                        </Td>
                        <Td>{formatDate(r.receivedAt)}</Td>
                        <Td align="right" className="text-ok font-medium">
                          {formatNumber(ok)}
                        </Td>
                        <Td align="right" className={dmg > 0 ? "text-danger font-medium" : undefined}>
                          {formatNumber(dmg)}
                        </Td>
                        <Td align="right" className={missing > 0 ? "text-warn font-medium" : undefined}>
                          {formatNumber(missing)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Rechnungen */}
          <Card
            title="Rechnungen"
            actions={
              !isCancelled ? (
                <LinkButton href={`/invoices/new?po=${id}`} size="sm">
                  Rechnung erfassen
                </LinkButton>
              ) : undefined
            }
          >
            {po.invoices.length === 0 ? (
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
                  {po.invoices.map((inv) => (
                    <Tr key={inv.id} muted={inv.status === "CANCELLED"}>
                      <Td>
                        <Link href={`/invoices/${inv.id}`} className="font-medium hover:text-accent">
                          {inv.invoiceNumber}
                        </Link>
                        {inv.externalNumber && (
                          <span className="block text-xs text-ink-tertiary">{inv.externalNumber}</span>
                        )}
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

          {/* Nebenkosten */}
          <Card title="Nebenkosten (Versand, Zoll, Gebühren)">
            {po.costs.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Nebenkosten erfasst – sie fließen in die Landed Costs der Chargen ein.
              </p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Typ</Th>
                    <Th>Beschreibung</Th>
                    <Th>Datum</Th>
                    <Th align="right">Betrag (EUR)</Th>
                    <Th>Verteilung</Th>
                  </tr>
                </THead>
                <tbody>
                  {po.costs.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Badge>{label(c.type)}</Badge>
                      </Td>
                      <Td className="text-ink-secondary">{c.description ?? "–"}</Td>
                      <Td>{formatDate(c.incurredAt)}</Td>
                      <Td align="right" className="font-medium">
                        {formatEur(c.amountEurCents)}
                      </Td>
                      <Td>{label(c.allocationMethod)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {!isCancelled && <AddCostForm poId={id} />}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* Kopfdaten */}
          <Card title="Kopfdaten">
            <DL>
              <DT>Lieferant</DT>
              <DD>
                <Link href={`/suppliers/${po.supplierId}`} className="font-medium hover:text-accent">
                  {po.supplier.name}
                </Link>
              </DD>
              <DT>Lieferanten-Bestellnr.</DT>
              <DD>{po.supplierOrderNumber ?? "–"}</DD>
              <DT>Währung</DT>
              <DD>{po.currency}</DD>
              <DT>Wechselkurs</DT>
              <DD className="tnum">{po.fxRate}</DD>
              <DT>Bestellt am</DT>
              <DD>{formatDate(po.orderedAt)}</DD>
              <DT>Erwartet</DT>
              <DD>{formatDate(po.expectedAt)}</DD>
              <DT>Angelegt</DT>
              <DD>{formatDate(po.createdAt)}</DD>
              {po.cancelledAt && (
                <>
                  <DT>Storniert am</DT>
                  <DD>{formatDate(po.cancelledAt)}</DD>
                </>
              )}
            </DL>
            {editable && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-secondary hover:text-ink">
                  Kopfdaten bearbeiten
                </summary>
                <div className="mt-3">
                  <PoForm
                    action={updatePoHeaderAction}
                    suppliers={suppliers}
                    po={{
                      id: po.id,
                      supplierId: po.supplierId,
                      supplierOrderNumber: po.supplierOrderNumber,
                      orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
                    }}
                  />
                </div>
              </details>
            )}
          </Card>

          {!isCancelled && (
            <StatusOverrideForm poId={id} currentStatus={po.status} overridden={po.statusOverridden} />
          )}

          <NotesPanel entityType="PURCHASE_ORDER" entityId={id} />
          <HistoryPanel entityType="PURCHASE_ORDER" entityId={id} />
        </div>
      </div>
    </div>
  );
}
