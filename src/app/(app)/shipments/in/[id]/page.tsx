import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import {
  PageHeader, Card, DL, DT, DD, Table, THead, Th, Td, Tr, StatusBadge, Badge,
} from "@/components/ui";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import {
  TrackingRefreshPanel,
  ManualTrackingEventForm,
  ShipmentMetaForm,
  InboundStatusForm,
} from "../../tracking-panels";

export const dynamic = "force-dynamic";

export default async function InboundShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shipment = await db.inboundShipment.findUnique({
    where: { id },
    include: {
      purchaseOrder: { include: { supplier: true } },
      items: { include: { poLine: { include: { product: true } } } },
      trackingEvents: { orderBy: { occurredAt: "desc" } },
      goodsReceipts: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!shipment) notFound();

  const upsConfig = await db.integrationConfig.findUnique({ where: { provider: "UPS" } });
  const upsLive = Boolean(upsConfig?.enabled && upsConfig.mode === "LIVE");
  const totalQty = shipment.items.reduce((a, i) => a + i.qty, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Eingehende Sendung ${shipment.shipmentNumber}`}
        backHref="/shipments?dir=in"
        backLabel="Versand"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={shipment.status} />
            <span>
              Bestellung{" "}
              <Link href={`/purchase-orders/${shipment.purchaseOrderId}`} className="font-medium hover:text-accent">
                {shipment.purchaseOrder.orderNumber}
              </Link>
            </span>
            <span>
              ·{" "}
              <Link href={`/suppliers/${shipment.purchaseOrder.supplierId}`} className="hover:text-accent">
                {shipment.purchaseOrder.supplier.name}
              </Link>
            </span>
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Metadaten */}
          <Card title="Sendungsdaten">
            <DL>
              <DT>Status</DT>
              <DD><StatusBadge status={shipment.status} /></DD>
              <DT>Bestellung</DT>
              <DD>
                <Link href={`/purchase-orders/${shipment.purchaseOrderId}`} className="font-medium hover:text-accent">
                  {shipment.purchaseOrder.orderNumber}
                </Link>
              </DD>
              <DT>Lieferant</DT>
              <DD>
                <Link href={`/suppliers/${shipment.purchaseOrder.supplierId}`} className="hover:text-accent">
                  {shipment.purchaseOrder.supplier.name}
                </Link>
              </DD>
              <DT>Carrier</DT>
              <DD>{shipment.carrier ?? "–"}</DD>
              <DT>Trackingnummer</DT>
              <DD className="font-mono text-xs">{shipment.trackingNumber ?? "–"}</DD>
              <DT>Pakete</DT>
              <DD className="tnum">{shipment.packageCount !== null ? formatNumber(shipment.packageCount) : "–"}</DD>
              <DT>Versendet am</DT>
              <DD>{formatDate(shipment.shippedAt)}</DD>
              <DT>Voraussichtliche Ankunft</DT>
              <DD>{formatDate(shipment.estimatedArrival)}</DD>
              <DT>Angekommen am</DT>
              <DD>{formatDate(shipment.arrivedAt)}</DD>
              <DT>Angelegt am</DT>
              <DD>{formatDateTime(shipment.createdAt)}</DD>
            </DL>
          </Card>

          {/* Positionen */}
          <Card title={`Positionen (${formatNumber(totalQty)} Einheiten)`}>
            {shipment.items.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Keine Positionen erfasst.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Produkt</Th>
                    <Th align="right">Menge</Th>
                  </tr>
                </THead>
                <tbody>
                  {shipment.items.map((item) => (
                    <Tr key={item.id}>
                      <Td>
                        <Link href={`/products/${item.poLine.productId}`} className="font-medium hover:text-accent">
                          {item.poLine.product.name}
                        </Link>
                        <span className="block font-mono text-xs text-ink-tertiary">
                          {item.poLine.product.sku}
                        </span>
                      </Td>
                      <Td align="right">{formatNumber(item.qty)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Tracking-Timeline */}
          <Card title="Tracking-Verlauf">
            {shipment.trackingEvents.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Tracking-Ereignisse – automatisch abrufen oder manuell erfassen.
              </p>
            ) : (
              <ol className="flex flex-col">
                {shipment.trackingEvents.map((e) => (
                  <li key={e.id} className="relative border-l border-border pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" />
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={e.status} />
                      {e.location && <span className="text-xs text-ink-secondary">{e.location}</span>}
                    </div>
                    {e.description && <p className="mt-1 text-sm">{e.description}</p>}
                    <p className="mt-0.5 text-xs text-ink-tertiary">
                      {formatDateTime(e.occurredAt)} · Quelle: {e.source}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {/* Wareneingänge zu dieser Sendung */}
          <Card title="Wareneingänge zu dieser Sendung">
            {shipment.goodsReceipts.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch kein Wareneingang gebucht – erst die Buchung setzt die Sendung auf „Angekommen“.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {shipment.goodsReceipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-canvas/50 px-3 py-1.5">
                    <Link href="/goods-receipts" className="font-medium hover:text-accent">
                      {r.receiptNumber}
                    </Link>
                    <span className="text-xs text-ink-tertiary">{formatDate(r.receivedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <TrackingRefreshPanel
            shipmentType="INBOUND"
            shipmentId={id}
            canRefresh={Boolean(shipment.trackingNumber && shipment.carrier)}
            mockMode={!upsLive}
          />
          <ManualTrackingEventForm shipmentType="INBOUND" shipmentId={id} />
          <InboundStatusForm shipmentId={id} currentStatus={shipment.status} />
          <ShipmentMetaForm
            shipmentType="INBOUND"
            shipmentId={id}
            carrier={shipment.carrier}
            trackingNumber={shipment.trackingNumber}
            packageCount={shipment.packageCount}
          />
          {shipment.status === "PARTIALLY_ARRIVED" && (
            <Card title="Hinweis">
              <p className="text-sm text-ink-secondary">
                <Badge tone="amber">Teilweise angekommen</Badge>{" "}
                Für die restlichen Einheiten bei Ankunft einen weiteren Wareneingang buchen.
              </p>
            </Card>
          )}
          <NotesPanel entityType="SHIPMENT" entityId={id} />
          <HistoryPanel entityType="SHIPMENT" entityId={id} />
        </div>
      </div>
    </div>
  );
}
