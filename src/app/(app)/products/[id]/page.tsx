import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getStock, getCurrentAvgCost, getInboundInTransitMap } from "@/server/services/inventory";
import { getPurchasePriceStats, getSalesStats } from "@/server/services/stats";
import {
  PageHeader, Card, StatCard, DL, DT, DD, Table, THead, Th, Td, Tr,
  LinkButton, Badge, StatusBadge, EmptyState,
} from "@/components/ui";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur, formatPercent, margin, markup } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { label } from "@/lib/constants";
import { ConversionEditor, StockCorrectionForm } from "./panels";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: {
      baseUnit: true,
      conversions: { include: { unit: true } },
      supplierMappings: { include: { supplier: true, defaultUnit: true } },
    },
  });
  if (!product) notFound();

  const [stock, avgCost, priceStatsMap, salesStatsMap, inTransitMap, units] = await Promise.all([
    getStock(id),
    getCurrentAvgCost(id),
    getPurchasePriceStats([id]),
    getSalesStats([id]),
    getInboundInTransitMap(),
    db.unit.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const priceStats = priceStatsMap.get(id);
  const salesStats = salesStatsMap.get(id);
  const inTransit = inTransitMap.get(id) ?? 0;

  // Einkaufshistorie
  const poLines = await db.purchaseOrderLine.findMany({
    where: { productId: id, purchaseOrder: { status: { not: "CANCELLED" } } },
    include: { purchaseOrder: { include: { supplier: true } }, enteredUnit: true },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
    take: 25,
  });
  // Verkaufshistorie
  const coLines = await db.customerOrderLine.findMany({
    where: { productId: id, order: { status: { not: "CANCELLED" } } },
    include: { order: { include: { customer: true } } },
    orderBy: { order: { orderedAt: "desc" } },
    take: 25,
  });
  // Lagerbewegungen
  const transactions = await db.inventoryTransaction.findMany({
    where: { productId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  // Chargen (woher stammt der Bestand?)
  const lots = await db.purchaseLot.findMany({
    where: { productId: id, qtyRemaining: { gt: 0 } },
    include: { poLine: { include: { purchaseOrder: { include: { supplier: true } } } } },
    orderBy: { receivedAt: "asc" },
  });

  const cost = avgCost ?? priceStats?.weightedAvgCents ?? null;
  const listPrice = product.listPriceCents;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={product.name}
        backHref="/products"
        backLabel="Produkte"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{product.sku}</span>
            {product.setName && <span>· {product.setName}</span>}
            {product.language && <Badge>{product.language}</Badge>}
            {product.productType && <Badge>{product.productType}</Badge>}
            {!product.active && <Badge tone="red">Archiviert</Badge>}
          </span>
        }
        actions={<LinkButton href={`/products/${id}/edit`}>Bearbeiten</LinkButton>}
      />

      {/* Bestands-Kacheln – die wichtigsten Zahlen zuerst (Mobile Use Case) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Bestand" value={formatNumber(stock.onHand)} hint={product.baseUnit.name} />
        <StatCard label="Reserviert" value={formatNumber(stock.reserved)} />
        <StatCard label="Frei verfügbar" value={formatNumber(stock.available)} />
        <StatCard label="Unterwegs" value={formatNumber(inTransit)} hint="vom Großhändler" />
        <StatCard label="Ø Einkauf (Bestand)" value={formatEur(avgCost)} hint="Landed Cost" />
        <StatCard label="Verkauft" value={formatNumber(salesStats?.soldQty ?? 0)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Einkaufspreise */}
          <Card title="Einkaufspreise">
            {priceStats ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-ink-tertiary">Gewichteter Ø</div>
                  <div className="tnum text-base font-semibold">{formatEur(priceStats.weightedAvgCents)}</div>
                  <div className="text-xs text-ink-tertiary">
                    {formatEur(priceStats.totalCostCents)} / {formatNumber(priceStats.totalQty)} Stk.
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-tertiary">Letzter Einkauf</div>
                  <div className="tnum text-base font-semibold">{formatEur(priceStats.lastCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-tertiary">Niedrigster</div>
                  <div className="tnum text-base font-semibold">{formatEur(priceStats.lowestCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-tertiary">Höchster</div>
                  <div className="tnum text-base font-semibold">{formatEur(priceStats.highestCents)}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-tertiary">Noch keine Einkäufe erfasst.</p>
            )}
          </Card>

          {/* Kalkulation: Marge vs. Aufschlag sauber getrennt */}
          <Card title="Kalkulation">
            {cost !== null ? (
              <DL>
                <DT>Einstandskosten (Ø)</DT>
                <DD className="tnum">{formatEur(cost)}</DD>
                <DT>Ziel-Verkaufspreis</DT>
                <DD className="tnum">{formatEur(listPrice)}</DD>
                {listPrice != null && (
                  <>
                    <DT>Bruttogewinn</DT>
                    <DD className="tnum font-medium">{formatEur(listPrice - cost)}</DD>
                    <DT>Marge (Gewinn ÷ VK)</DT>
                    <DD className="tnum font-medium">{formatPercent(margin(listPrice, cost))}</DD>
                    <DT>Aufschlag (Gewinn ÷ EK)</DT>
                    <DD className="tnum">{formatPercent(markup(listPrice, cost))}</DD>
                  </>
                )}
                {salesStats && salesStats.revenueCents > 0 && (
                  <>
                    <DT>Umsatz (versendet)</DT>
                    <DD className="tnum">{formatEur(salesStats.revenueCents)}</DD>
                    <DT>Gewinn (realisiert)</DT>
                    <DD className="tnum font-medium">{formatEur(salesStats.profitCents)}</DD>
                    <DT>Ist-Marge</DT>
                    <DD className="tnum">{formatPercent(salesStats.marginPct)}</DD>
                  </>
                )}
              </DL>
            ) : (
              <p className="text-sm text-ink-tertiary">
                Noch kein Einkaufspreis bekannt – Kalkulation nicht möglich.
              </p>
            )}
          </Card>

          {/* Einkaufshistorie */}
          <Card title="Einkaufshistorie">
            {poLines.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Bestellungen.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Bestellung</Th>
                    <Th>Großhändler</Th>
                    <Th>Datum</Th>
                    <Th align="right">Menge</Th>
                    <Th align="right">EK/Basiseinheit</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {poLines.map((l) => {
                    const unitEur =
                      l.qtyOrdered > 0
                        ? Math.round((l.lineTotalCents * l.purchaseOrder.fxRate) / l.qtyOrdered)
                        : null;
                    return (
                      <Tr key={l.id}>
                        <Td>
                          <Link href={`/purchase-orders/${l.purchaseOrderId}`} className="font-medium hover:text-accent">
                            {l.purchaseOrder.orderNumber}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={`/suppliers/${l.purchaseOrder.supplierId}`} className="hover:text-accent">
                            {l.purchaseOrder.supplier.name}
                          </Link>
                        </Td>
                        <Td>{formatDate(l.purchaseOrder.orderedAt ?? l.purchaseOrder.createdAt)}</Td>
                        <Td align="right">
                          {formatNumber(l.qtyOrdered)}
                          {l.unitFactor > 1 && (
                            <span className="block text-xs text-ink-tertiary">
                              {l.enteredQty} × {l.enteredUnit.name}
                            </span>
                          )}
                        </Td>
                        <Td align="right">{formatEur(unitEur)}</Td>
                        <Td><StatusBadge status={l.purchaseOrder.status} /></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Verkaufshistorie */}
          <Card title="Verkaufshistorie">
            {coLines.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Verkäufe.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Bestellung</Th>
                    <Th>Kunde</Th>
                    <Th>Datum</Th>
                    <Th align="right">Menge</Th>
                    <Th align="right">VK/Einheit</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {coLines.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <Link href={`/customer-orders/${l.customerOrderId}`} className="font-medium hover:text-accent">
                          {l.order.orderNumber}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/customers/${l.order.customerId}`} className="hover:text-accent">
                          {l.order.customer.name}
                        </Link>
                      </Td>
                      <Td>{formatDate(l.order.orderedAt)}</Td>
                      <Td align="right">{formatNumber(l.qty)}</Td>
                      <Td align="right">{formatEur(l.unitPriceCents)}</Td>
                      <Td><StatusBadge status={l.order.status} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Bestand nach Chargen: Von welchem Einkauf stammt der heutige Bestand? */}
          <Card title="Aktueller Bestand nach Chargen (FIFO)">
            {lots.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Kein Bestand vorhanden.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Eingang</Th>
                    <Th>Herkunft</Th>
                    <Th align="right">Restmenge</Th>
                    <Th align="right">EK/Einheit</Th>
                    <Th align="right">Landed Cost</Th>
                  </tr>
                </THead>
                <tbody>
                  {lots.map((lot) => (
                    <Tr key={lot.id}>
                      <Td>{formatDate(lot.receivedAt)}</Td>
                      <Td>
                        {lot.poLine ? (
                          <Link href={`/purchase-orders/${lot.poLine.purchaseOrderId}`} className="hover:text-accent">
                            {lot.poLine.purchaseOrder.orderNumber} · {lot.poLine.purchaseOrder.supplier.name}
                          </Link>
                        ) : (
                          <span className="text-ink-tertiary">Manuelle Korrektur</span>
                        )}
                      </Td>
                      <Td align="right">{formatNumber(lot.qtyRemaining)}</Td>
                      <Td align="right">{formatEur(lot.unitCostEurCents)}</Td>
                      <Td align="right" className="font-medium">{formatEur(lot.landedUnitCostEurCents)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Lagerbewegungen */}
          <Card title="Letzte Lagerbewegungen">
            {transactions.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Bewegungen.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Datum</Th>
                    <Th>Typ</Th>
                    <Th align="right">Menge</Th>
                    <Th>Notiz</Th>
                  </tr>
                </THead>
                <tbody>
                  {transactions.map((t) => (
                    <Tr key={t.id}>
                      <Td>{formatDate(t.createdAt)}</Td>
                      <Td><Badge tone={t.qty > 0 ? "green" : "neutral"}>{label(t.type)}</Badge></Td>
                      <Td align="right" className={t.qty > 0 ? "text-ok font-medium" : "font-medium"}>
                        {t.qty > 0 ? `+${formatNumber(t.qty)}` : formatNumber(t.qty)}
                      </Td>
                      <Td className="max-w-[300px] truncate text-ink-secondary">{t.note ?? "–"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* Stammdaten */}
          <Card title="Stammdaten">
            <DL>
              <DT>SKU</DT>
              <DD className="font-mono text-xs">{product.sku}</DD>
              <DT>EAN</DT>
              <DD>{product.ean ?? "–"}</DD>
              <DT>Hersteller</DT>
              <DD>{product.manufacturer ?? "–"}</DD>
              <DT>Edition</DT>
              <DD>{product.edition ?? "–"}</DD>
              <DT>Basiseinheit</DT>
              <DD>{product.baseUnit.name}</DD>
            </DL>
          </Card>

          {/* Einheiten-Umrechnungen */}
          <ConversionEditor
            productId={id}
            baseUnitName={product.baseUnit.name}
            conversions={product.conversions.map((c) => ({
              id: c.id,
              unitId: c.unitId,
              unitName: c.unit.name,
              factor: c.factor,
            }))}
            units={units
              .filter((u) => u.id !== product.baseUnitId)
              .map((u) => ({ id: u.id, name: u.name }))}
          />

          {/* Lieferanten-Mappings */}
          <Card title="Lieferanten-Bezeichnungen">
            {product.supplierMappings.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Mappings – entstehen automatisch beim Import oder in den Einstellungen.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {product.supplierMappings.map((m) => (
                  <li key={m.id} className="rounded-md border border-border bg-canvas/50 px-3 py-2">
                    <Link href={`/suppliers/${m.supplierId}`} className="font-medium hover:text-accent">
                      {m.supplier.name}
                    </Link>
                    <span className="block text-xs text-ink-secondary">„{m.supplierName}“</span>
                    {m.supplierSku && <span className="block text-xs text-ink-tertiary">Art-Nr: {m.supplierSku}</span>}
                    {m.unitFactor && (
                      <span className="block text-xs text-ink-tertiary">
                        1 {m.defaultUnit?.name ?? "Einheit"} = {m.unitFactor} {product.baseUnit.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Bestandskorrektur */}
          <StockCorrectionForm productId={id} baseUnitName={product.baseUnit.name} />

          <NotesPanel entityType="PRODUCT" entityId={id} />
          <HistoryPanel entityType="PRODUCT" entityId={id} />
        </div>
      </div>
    </div>
  );
}
