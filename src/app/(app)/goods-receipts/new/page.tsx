import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "@/components/ui";
import { formatDate, toDateInputValue } from "@/lib/format";
import { ReceiptForm, type ReceiptFormLine, type ReceiptFormShipment } from "../receipt-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wareneingang buchen" };

/** PO-Status, bei denen noch Ware erwartet wird. */
const OPEN_PO_STATUSES = [
  "ORDERED",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
];

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string; shipment?: string }>;
}) {
  const params = await searchParams;
  const poId = params.po?.trim() || "";

  // Ohne Bestellung: einfache Auswahlliste der offenen Bestellungen.
  if (!poId) {
    const pos = await db.purchaseOrder.findMany({
      where: { status: { in: OPEN_PO_STATUSES } },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { orderedAt: "asc" },
    });
    pos.sort(
      (a, b) =>
        (a.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
    );
    return (
      <div>
        <PageHeader
          title="Wareneingang buchen"
          subtitle="Für welche Bestellung ist Ware angekommen?"
          backHref="/goods-receipts"
          backLabel="Wareneingang"
        />
        {pos.length === 0 ? (
          <EmptyState
            title="Keine offenen Bestellungen"
            hint="Es gibt aktuell keine Bestellungen, für die ein Wareneingang gebucht werden kann."
            action={<LinkButton href="/purchase-orders">Zu den Bestellungen</LinkButton>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Bestellung</Th>
                <Th>Lieferant</Th>
                <Th>Status</Th>
                <Th>Erwartet am</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {pos.map((po) => (
                <Tr key={po.id}>
                  <Td>
                    <Link href={`/purchase-orders/${po.id}`} className="font-medium hover:text-accent">
                      {po.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/suppliers/${po.supplierId}`} className="hover:text-accent">
                      {po.supplier.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={po.status} />
                  </Td>
                  <Td>{formatDate(po.expectedAt)}</Td>
                  <Td align="right">
                    <LinkButton href={`/goods-receipts/new?po=${po.id}`} variant="primary" size="sm">
                      Wareneingang buchen
                    </LinkButton>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    );
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: {
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!po) notFound();

  if (po.status === "DRAFT" || po.status === "CANCELLED") {
    return (
      <div>
        <PageHeader title="Wareneingang buchen" backHref="/goods-receipts" backLabel="Wareneingang" />
        <EmptyState
          title={
            po.status === "DRAFT"
              ? "Die Bestellung ist noch ein Entwurf"
              : "Die Bestellung ist storniert"
          }
          hint={
            po.status === "DRAFT"
              ? "Bestellung zuerst als „Bestellt“ markieren, dann kann Ware eingebucht werden."
              : "Für stornierte Bestellungen kann kein Wareneingang gebucht werden."
          }
          action={<LinkButton href={`/purchase-orders/${po.id}`}>Zur Bestellung</LinkButton>}
        />
      </div>
    );
  }

  const [stats, shipments] = await Promise.all([
    getPoLineStats(po.id),
    db.inboundShipment.findMany({
      where: { purchaseOrderId: po.id, status: { not: "CANCELLED" } },
      include: { items: { select: { poLineId: true, qty: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const statsByLine = new Map(stats.map((s) => [s.poLineId, s]));

  const openLines: ReceiptFormLine[] = po.lines
    .map((l) => {
      const s = statsByLine.get(l.id);
      return {
        poLineId: l.id,
        productId: l.productId,
        productName: l.product.name,
        sku: l.product.sku,
        ordered: s?.ordered ?? l.qtyOrdered,
        shipped: s?.shipped ?? 0,
        arrived: s?.arrived ?? 0,
        open: s?.open ?? l.qtyOrdered,
      };
    })
    .filter((l) => l.open > 0);

  const shipmentOptions: ReceiptFormShipment[] = shipments.map((s) => ({
    id: s.id,
    shipmentNumber: s.shipmentNumber,
    status: s.status,
    trackingNumber: s.trackingNumber,
    announcedTotal: s.items.reduce((a, i) => a + i.qty, 0),
    items: s.items.map((i) => ({ poLineId: i.poLineId, qty: i.qty })),
  }));

  const shipmentParam = params.shipment?.trim() || "";
  const defaultShipmentId = shipmentOptions.some((s) => s.id === shipmentParam) ? shipmentParam : "";

  return (
    <div>
      <PageHeader
        title="Wareneingang buchen"
        backHref="/goods-receipts"
        backLabel="Wareneingang"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/purchase-orders/${po.id}`} className="font-medium hover:text-accent">
              {po.orderNumber}
            </Link>
            <span>·</span>
            <Link href={`/suppliers/${po.supplierId}`} className="hover:text-accent">
              {po.supplier.name}
            </Link>
            <StatusBadge status={po.status} />
            {po.expectedAt && <span>· erwartet am {formatDate(po.expectedAt)}</span>}
          </span>
        }
      />

      {openLines.length === 0 ? (
        <EmptyState
          title="Alle Positionen sind vollständig angekommen"
          hint="Für diese Bestellung gibt es keine offenen Mengen mehr."
          action={<LinkButton href={`/purchase-orders/${po.id}`}>Zur Bestellung</LinkButton>}
        />
      ) : (
        <ReceiptForm
          purchaseOrderId={po.id}
          lines={openLines}
          shipments={shipmentOptions}
          defaultShipmentId={defaultShipmentId}
          defaultDate={toDateInputValue(new Date())}
        />
      )}
    </div>
  );
}
