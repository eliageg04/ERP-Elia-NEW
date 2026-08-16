import Link from "next/link";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { PageHeader, Table, THead, Th, Td, Tr, Badge, LinkButton, EmptyState } from "@/components/ui";
import { INVENTORY_TX_TYPES, label } from "@/lib/constants";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bewegungen" };

const PAGE_SIZE = 50;

// Anzeige-Labels für Referenztypen im Ledger (refType ist Freitext im Schema)
const REF_TYPE_LABELS: Record<string, string> = {
  GOODS_RECEIPT: "Wareneingang",
  CUSTOMER_SHIPMENT: "Kundenversand",
  MANUAL: "Manuell",
  IMPORT: "Import",
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string; q?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const type = (INVENTORY_TX_TYPES as readonly string[]).includes(params.type ?? "") ? params.type! : "";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);

  const where: Prisma.InventoryTransactionWhereInput = {
    ...(type ? { type } : {}),
    ...(q ? { product: { name: { contains: q } } } : {}),
  };

  const [total, transactions] = await Promise.all([
    db.inventoryTransaction.count({ where }),
    db.inventoryTransaction.findMany({
      where,
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Referenzen auflösen: Wareneingang → Bestellung (PO), Kundenversand → Kundenbestellung (CO)
  const receiptIds = [
    ...new Set(
      transactions.filter((t) => t.refType === "GOODS_RECEIPT" && t.refId).map((t) => t.refId!)
    ),
  ];
  const shipmentIds = [
    ...new Set(
      transactions.filter((t) => t.refType === "CUSTOMER_SHIPMENT" && t.refId).map((t) => t.refId!)
    ),
  ];
  const [receipts, shipments] = await Promise.all([
    receiptIds.length
      ? db.goodsReceipt.findMany({
          where: { id: { in: receiptIds } },
          select: {
            id: true,
            receiptNumber: true,
            purchaseOrderId: true,
            purchaseOrder: { select: { orderNumber: true } },
          },
        })
      : Promise.resolve([]),
    shipmentIds.length
      ? db.customerShipment.findMany({
          where: { id: { in: shipmentIds } },
          select: {
            id: true,
            shipmentNumber: true,
            customerOrderId: true,
            order: { select: { orderNumber: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const refLinks = new Map<string, { href: string; text: string }>();
  for (const r of receipts) {
    refLinks.set(`GOODS_RECEIPT:${r.id}`, {
      href: `/purchase-orders/${r.purchaseOrderId}`,
      text: `${r.receiptNumber} · ${r.purchaseOrder.orderNumber}`,
    });
  }
  for (const s of shipments) {
    refLinks.set(`CUSTOMER_SHIPMENT:${s.id}`, {
      href: `/customer-orders/${s.customerOrderId}`,
      text: `${s.shipmentNumber} · ${s.order.orderNumber}`,
    });
  }

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (type) sp.set("type", type);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/inventory/movements?${qs}` : "/inventory/movements";
  };

  return (
    <div>
      <PageHeader
        title="Bewegungen"
        subtitle="Der Bestand ist die Summe aller Bewegungen (Ledger-Prinzip): Jede Zeile ist ein Zugang (+) oder Abgang (−) – es gibt kein separat gepflegtes Bestandsfeld."
        actions={<LinkButton href="/inventory">Zum Bestand</LinkButton>}
      />

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select
          name="type"
          defaultValue={type}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Typen</option>
          {INVENTORY_TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Produktname…"
          className="w-64 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
        >
          Filtern
        </button>
      </form>

      {transactions.length === 0 ? (
        <EmptyState
          title="Keine Bewegungen gefunden"
          hint={
            q || type
              ? "Filter anpassen oder zurücksetzen."
              : "Bewegungen entstehen durch Wareneingänge, Kundenversand und Bestandskorrekturen."
          }
          action={q || type ? <LinkButton href="/inventory/movements">Filter zurücksetzen</LinkButton> : undefined}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Datum / Uhrzeit</Th>
              <Th>Produkt</Th>
              <Th>Typ</Th>
              <Th align="right">Menge</Th>
              <Th>Referenz</Th>
              <Th>Notiz</Th>
            </tr>
          </THead>
          <tbody>
            {transactions.map((t) => {
              const ref = t.refType && t.refId ? refLinks.get(`${t.refType}:${t.refId}`) : undefined;
              return (
                <Tr key={t.id}>
                  <Td className="whitespace-nowrap text-ink-secondary">{formatDateTime(t.createdAt)}</Td>
                  <Td>
                    <Link href={`/products/${t.productId}`} className="font-medium hover:text-accent">
                      {t.product.name}
                    </Link>
                    <span className="block text-xs text-ink-tertiary">{t.product.sku}</span>
                  </Td>
                  <Td>
                    <Badge tone={t.qty > 0 ? "green" : "neutral"}>{label(t.type)}</Badge>
                  </Td>
                  <Td align="right" className={t.qty > 0 ? "text-ok font-medium" : "font-medium"}>
                    {t.qty > 0 ? `+${formatNumber(t.qty)}` : formatNumber(t.qty)}
                  </Td>
                  <Td>
                    {ref ? (
                      <Link href={ref.href} className="hover:text-accent">
                        {ref.text}
                      </Link>
                    ) : t.refType ? (
                      <>
                        <span className="text-ink-secondary">{REF_TYPE_LABELS[t.refType] ?? t.refType}</span>
                        {t.refId && (
                          <span className="block font-mono text-xs text-ink-tertiary">{t.refId}</span>
                        )}
                      </>
                    ) : (
                      "–"
                    )}
                  </Td>
                  <Td className="max-w-[300px] truncate text-ink-secondary">{t.note ?? "–"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* Pagination */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-tertiary">
          Seite {formatNumber(page)} von {formatNumber(totalPages)} · {formatNumber(total)} Bewegungen
        </span>
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <LinkButton href={pageHref(page - 1)} size="sm">
              ← Zurück
            </LinkButton>
          ) : (
            <span className="px-2.5 py-1 text-xs text-ink-tertiary">← Zurück</span>
          )}
          {page < totalPages ? (
            <LinkButton href={pageHref(page + 1)} size="sm">
              Weiter →
            </LinkButton>
          ) : (
            <span className="px-2.5 py-1 text-xs text-ink-tertiary">Weiter →</span>
          )}
        </div>
      </div>
    </div>
  );
}
