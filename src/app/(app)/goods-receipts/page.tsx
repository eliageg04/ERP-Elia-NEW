import Link from "next/link";
import { db } from "@/server/db";
import { getPoLineStats } from "@/server/services/purchasing";
import {
  PageHeader,
  Card,
  Table,
  THead,
  Th,
  Td,
  Tr,
  StatusBadge,
  LinkButton,
  EmptyState,
} from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wareneingang" };

/** PO-Status, bei denen noch Ware erwartet wird. */
const EXPECTED_PO_STATUSES = [
  "ORDERED",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
];

export default async function GoodsReceiptsPage() {
  const expectedPos = await db.purchaseOrder.findMany({
    where: { status: { in: EXPECTED_PO_STATUSES } },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { orderedAt: "asc" },
  });
  // Nach erwartetem Lieferdatum sortieren (ohne Datum ans Ende)
  expectedPos.sort(
    (a, b) =>
      (a.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.expectedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
  );

  const totalsByPo = new Map<
    string,
    { ordered: number; shipped: number; arrived: number; open: number }
  >();
  for (const po of expectedPos) {
    const stats = await getPoLineStats(po.id);
    totalsByPo.set(po.id, {
      ordered: stats.reduce((a, s) => a + s.ordered, 0),
      shipped: stats.reduce((a, s) => a + s.shipped, 0),
      arrived: stats.reduce((a, s) => a + s.arrived, 0),
      open: stats.reduce((a, s) => a + s.open, 0),
    });
  }

  const receipts = await db.goodsReceipt.findMany({
    include: {
      purchaseOrder: { select: { id: true, orderNumber: true } },
      receivedBy: { select: { name: true } },
      items: { select: { qtyReceived: true, qtyDamaged: true, qtyMissing: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 25,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wareneingang"
        subtitle="Erwartete Lieferungen prüfen und angekommene Ware einbuchen"
        actions={
          <LinkButton href="/goods-receipts/new" variant="primary">
            Wareneingang buchen
          </LinkButton>
        }
      />

      <Card title="Erwartete Lieferungen">
        {expectedPos.length === 0 ? (
          <p className="text-sm text-ink-tertiary">
            Aktuell werden keine Lieferungen erwartet – alle Bestellungen sind angekommen oder abgeschlossen.
          </p>
        ) : (
          <Table className="border-0">
            <THead>
              <tr>
                <Th>Bestellung</Th>
                <Th>Lieferant</Th>
                <Th>Status</Th>
                <Th>Erwartet am</Th>
                <Th align="right">Bestellt</Th>
                <Th align="right">Versendet</Th>
                <Th align="right">Angekommen</Th>
                <Th align="right">Offen</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {expectedPos.map((po) => {
                const t = totalsByPo.get(po.id) ?? { ordered: 0, shipped: 0, arrived: 0, open: 0 };
                return (
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
                    <Td align="right">{formatNumber(t.ordered)}</Td>
                    <Td align="right">{formatNumber(t.shipped)}</Td>
                    <Td align="right">{formatNumber(t.arrived)}</Td>
                    <Td align="right" className="font-medium">
                      {formatNumber(t.open)}
                    </Td>
                    <Td align="right">
                      <LinkButton href={`/goods-receipts/new?po=${po.id}`} variant="primary" size="sm">
                        Wareneingang buchen
                      </LinkButton>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Letzte Wareneingänge">
        {receipts.length === 0 ? (
          <EmptyState
            title="Noch keine Wareneingänge gebucht"
            hint="Sobald Ware ankommt, hier oder direkt aus der Bestellung den Eingang buchen."
            action={
              <LinkButton href="/goods-receipts/new" variant="primary">
                Wareneingang buchen
              </LinkButton>
            }
          />
        ) : (
          <Table className="border-0">
            <THead>
              <tr>
                <Th>Nummer</Th>
                <Th>Bestellung</Th>
                <Th>Datum</Th>
                <Th>Erfasst von</Th>
                <Th align="right">Eingelagert</Th>
                <Th align="right">Beschädigt</Th>
                <Th align="right">Fehlend</Th>
                <Th align="right">Pakete</Th>
              </tr>
            </THead>
            <tbody>
              {receipts.map((r) => {
                const ok = r.items.reduce((a, i) => a + i.qtyReceived, 0);
                const damaged = r.items.reduce((a, i) => a + i.qtyDamaged, 0);
                const missing = r.items.reduce((a, i) => a + i.qtyMissing, 0);
                return (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-medium">{r.receiptNumber}</span>
                    </Td>
                    <Td>
                      <Link
                        href={`/purchase-orders/${r.purchaseOrderId}`}
                        className="hover:text-accent"
                      >
                        {r.purchaseOrder.orderNumber}
                      </Link>
                    </Td>
                    <Td>{formatDate(r.receivedAt)}</Td>
                    <Td>{r.receivedBy?.name ?? "–"}</Td>
                    <Td align="right" className="font-medium text-ok">
                      {formatNumber(ok)}
                    </Td>
                    <Td align="right" className={damaged > 0 ? "font-medium text-danger" : ""}>
                      {damaged > 0 ? formatNumber(damaged) : "–"}
                    </Td>
                    <Td align="right" className={missing > 0 ? "font-medium text-danger" : ""}>
                      {missing > 0 ? formatNumber(missing) : "–"}
                    </Td>
                    <Td align="right">{r.packageCount !== null ? formatNumber(r.packageCount) : "–"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
