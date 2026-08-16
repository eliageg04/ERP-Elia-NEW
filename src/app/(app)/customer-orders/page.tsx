import Link from "next/link";
import { db } from "@/server/db";
import { getCoLineStats } from "@/server/services/sales";
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
import { formatEur } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { label, CO_STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kundenbestellungen" };

export default async function CustomerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; customerId?: string; filter?: string }>;
}) {
  const params = await searchParams;
  const ready = params.filter === "ready";

  const customers = await db.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const orders = await db.customerOrder.findMany({
    where: {
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.status
        ? { status: params.status }
        : ready
          ? { status: { not: "CANCELLED" } }
          : {}),
    },
    include: { customer: true, lines: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Reservierungs-/Versandfortschritt je Bestellung
  const totalsByOrder = new Map<
    string,
    { qty: number; allocated: number; shipped: number; ready: boolean }
  >();
  for (const o of orders) {
    const stats = await getCoLineStats(o.id);
    totalsByOrder.set(o.id, {
      qty: stats.reduce((a, s) => a + s.qty, 0),
      allocated: stats.reduce((a, s) => a + s.allocated, 0),
      shipped: stats.reduce((a, s) => a + s.shipped, 0),
      // Versandbereit: alle Zeilen vollständig zugeordnet + mindestens eine aktive Reservierung
      ready:
        stats.length > 0 && stats.every((s) => s.open === 0) && stats.some((s) => s.allocated > 0),
    });
  }
  const visible = ready ? orders.filter((o) => totalsByOrder.get(o.id)?.ready) : orders;

  return (
    <div>
      <PageHeader
        title="Kundenbestellungen"
        subtitle={`${visible.length} Bestellungen`}
        actions={
          <LinkButton href="/customer-orders/new" variant="primary">
            Neue Bestellung
          </LinkButton>
        }
      />

      {/* Ansicht: alle vs. versandbereit */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/customer-orders" className={buttonClass(!ready ? "primary" : "secondary", "sm")}>
          Alle
        </Link>
        <Link
          href="/customer-orders?filter=ready"
          className={buttonClass(ready ? "primary" : "secondary", "sm")}
        >
          Versandbereit
        </Link>
      </div>

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {ready && <input type="hidden" name="filter" value="ready" />}
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Status</option>
          {CO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          name="customerId"
          defaultValue={params.customerId ?? ""}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Kunden</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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

      {visible.length === 0 ? (
        <EmptyState
          title={ready ? "Keine versandbereiten Bestellungen" : "Keine Bestellungen gefunden"}
          hint={
            ready
              ? "Versandbereit sind Bestellungen, deren Positionen vollständig reserviert sind."
              : "Filter anpassen oder eine neue Bestellung anlegen."
          }
          action={
            <LinkButton href="/customer-orders/new" variant="primary">
              Neue Bestellung
            </LinkButton>
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Nummer</Th>
              <Th>Kunde</Th>
              <Th>Datum</Th>
              <Th>Status</Th>
              <Th align="right">Einheiten</Th>
              <Th align="right">Warenwert</Th>
              <Th>Reserviert</Th>
              <Th>Versendet</Th>
            </tr>
          </THead>
          <tbody>
            {visible.map((o) => {
              const totals = totalsByOrder.get(o.id) ?? {
                qty: 0,
                allocated: 0,
                shipped: 0,
                ready: false,
              };
              const valueCents =
                o.lines.reduce((a, l) => a + l.lineTotalCents, 0) + o.shippingFeeCents;
              return (
                <Tr key={o.id} muted={o.status === "CANCELLED"}>
                  <Td>
                    <Link href={`/customer-orders/${o.id}`} className="font-medium hover:text-accent">
                      {o.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${o.customerId}`} className="hover:text-accent">
                      {o.customer.name}
                    </Link>
                  </Td>
                  <Td>{formatDate(o.orderedAt)}</Td>
                  <Td>
                    <StatusBadge status={o.status} />
                  </Td>
                  <Td align="right">{formatNumber(totals.qty)}</Td>
                  <Td align="right" className="font-medium">
                    {formatEur(valueCents)}
                  </Td>
                  <Td>
                    <QtyProgress
                      value={totals.allocated + totals.shipped}
                      total={totals.qty}
                      toneWhenPartial="blue"
                    />
                  </Td>
                  <Td>
                    <QtyProgress value={totals.shipped} total={totals.qty} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
