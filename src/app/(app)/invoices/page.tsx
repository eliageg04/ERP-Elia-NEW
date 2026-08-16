import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, StatusBadge, Badge, LinkButton, EmptyState, StatCard } from "@/components/ui";
import { formatEur } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rechnungen" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; filter?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();

  const invoices = await db.invoice.findMany({
    where: {
      ...(params.type ? { type: params.type } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.filter === "open" ? { status: { in: ["OPEN", "PARTIALLY_PAID"] } } : {}),
      ...(params.filter === "paid" ? { status: "PAID" } : {}),
      ...(params.filter === "overdue"
        ? { status: { in: ["OPEN", "PARTIALLY_PAID"] }, dueAt: { lt: now } }
        : {}),
    },
    include: {
      supplier: true,
      customer: true,
      purchaseOrder: true,
      customerOrder: true,
      payments: true,
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  const allOpen = await db.invoice.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
    include: { payments: true },
  });
  const openTotal = allOpen.reduce(
    (a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0),
    0
  );
  const overdueTotal = allOpen
    .filter((i) => i.dueAt && i.dueAt < now)
    .reduce((a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0), 0);
  const openSupplier = allOpen
    .filter((i) => i.type === "SUPPLIER")
    .reduce((a, inv) => a + inv.totalEurCents - inv.payments.reduce((x, p) => x + p.amountEurCents, 0), 0);

  return (
    <div>
      <PageHeader
        title="Rechnungen"
        subtitle={`${invoices.length} Rechnungen`}
        actions={<LinkButton href="/invoices/new" variant="primary">Rechnung erfassen</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Offen gesamt" value={formatEur(openTotal)} tone={openTotal > 0 ? "warn" : "default"} />
        <StatCard label="Davon überfällig" value={formatEur(overdueTotal)} tone={overdueTotal > 0 ? "danger" : "default"} href="/invoices?filter=overdue" />
        <StatCard label="Offen an Lieferanten" value={formatEur(openSupplier)} />
        <StatCard label="Offen von Kunden" value={formatEur(openTotal - openSupplier)} />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select name="type" defaultValue={params.type ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Typen</option>
          <option value="SUPPLIER">Eingangsrechnungen</option>
          <option value="CUSTOMER">Ausgangsrechnungen</option>
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Status</option>
          <option value="OPEN">Offen</option>
          <option value="PARTIALLY_PAID">Teilweise bezahlt</option>
          <option value="PAID">Bezahlt</option>
          <option value="CANCELLED">Storniert</option>
        </select>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {invoices.length === 0 ? (
        <EmptyState title="Keine Rechnungen gefunden" action={<LinkButton href="/invoices/new" variant="primary">Rechnung erfassen</LinkButton>} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Nummer</Th>
              <Th>Typ</Th>
              <Th>Lieferant / Kunde</Th>
              <Th>Bestellung</Th>
              <Th>Datum</Th>
              <Th>Fällig</Th>
              <Th align="right">Betrag</Th>
              <Th align="right">Offen</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {invoices.map((inv) => {
              const paid = inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
              const open = inv.status === "CANCELLED" ? 0 : inv.totalEurCents - paid;
              const overdue = inv.dueAt && inv.dueAt < now && open > 0;
              return (
                <Tr key={inv.id} muted={inv.status === "CANCELLED"}>
                  <Td>
                    <Link href={`/invoices/${inv.id}`} className="font-medium hover:text-accent">
                      {inv.invoiceNumber}
                    </Link>
                    {inv.externalNumber && (
                      <span className="block text-xs text-ink-tertiary">{inv.externalNumber}</span>
                    )}
                  </Td>
                  <Td><Badge tone={inv.type === "SUPPLIER" ? "neutral" : "blue"}>{label(inv.type)}</Badge></Td>
                  <Td>
                    {inv.supplier ? (
                      <Link href={`/suppliers/${inv.supplierId}`} className="hover:text-accent">{inv.supplier.name}</Link>
                    ) : inv.customer ? (
                      <Link href={`/customers/${inv.customerId}`} className="hover:text-accent">{inv.customer.name}</Link>
                    ) : "–"}
                  </Td>
                  <Td>
                    {inv.purchaseOrder ? (
                      <Link href={`/purchase-orders/${inv.purchaseOrderId}`} className="hover:text-accent">{inv.purchaseOrder.orderNumber}</Link>
                    ) : inv.customerOrder ? (
                      <Link href={`/customer-orders/${inv.customerOrderId}`} className="hover:text-accent">{inv.customerOrder.orderNumber}</Link>
                    ) : "–"}
                  </Td>
                  <Td>{formatDate(inv.issuedAt)}</Td>
                  <Td className={overdue ? "font-medium text-danger" : ""}>{formatDate(inv.dueAt)}</Td>
                  <Td align="right">{formatEur(inv.totalEurCents)}</Td>
                  <Td align="right" className={open > 0 ? "font-medium" : "text-ink-tertiary"}>
                    {formatEur(open)}
                  </Td>
                  <Td><StatusBadge status={inv.status} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
