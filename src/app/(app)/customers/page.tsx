import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, LinkButton, EmptyState } from "@/components/ui";
import { formatEur } from "@/lib/money";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kunden" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const showArchived = params.archived === "1";

  const customers = await db.customer.findMany({
    where: {
      active: showArchived ? undefined : true,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { company: { contains: q } },
              { code: { contains: q } },
              { email: { contains: q } },
              { billingCity: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
  });

  // Umsatz + Bestellanzahl aller gelisteten Kunden in EINER Query (kein N+1).
  const orders = await db.customerOrder.findMany({
    where: {
      customerId: { in: customers.map((c) => c.id) },
      status: { not: "CANCELLED" },
    },
    select: { customerId: true, lines: { select: { lineTotalCents: true } } },
  });
  const statsMap = new Map<string, { orderCount: number; revenueCents: number }>();
  for (const o of orders) {
    const cur = statsMap.get(o.customerId) ?? { orderCount: 0, revenueCents: 0 };
    cur.orderCount += 1;
    cur.revenueCents += o.lines.reduce((a, l) => a + l.lineTotalCents, 0);
    statsMap.set(o.customerId, cur);
  }

  return (
    <div>
      <PageHeader
        title="Kunden"
        subtitle={`${customers.length} Kunden`}
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/customers/map">🌍 Weltkarte</LinkButton>
            <LinkButton href="/customers/new" variant="primary">Neuer Kunde</LinkButton>
          </div>
        }
      />

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, Firma, Code, E-Mail…"
          className="w-64 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
          Archivierte zeigen
        </label>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title="Keine Kunden gefunden"
          hint={q ? "Suchbegriff anpassen oder neuen Kunden anlegen." : "Lege deinen ersten Kunden an."}
          action={<LinkButton href="/customers/new" variant="primary">Neuer Kunde</LinkButton>}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Kunde</Th>
              <Th>Firma</Th>
              <Th>E-Mail</Th>
              <Th align="right">Bestellungen</Th>
              <Th align="right">Umsatz</Th>
              <Th> </Th>
            </tr>
          </THead>
          <tbody>
            {customers.map((c) => {
              const stats = statsMap.get(c.id);
              return (
                <Tr key={c.id} muted={!c.active}>
                  <Td>
                    <Link href={`/customers/${c.id}`} className="font-medium hover:text-accent">
                      {c.name}
                    </Link>
                    <span className="block text-xs text-ink-tertiary">
                      {c.code}
                      {!c.active && " · archiviert"}
                    </span>
                  </Td>
                  <Td><span className="text-ink-secondary">{c.company ?? "–"}</span></Td>
                  <Td><span className="text-ink-secondary">{c.email ?? "–"}</span></Td>
                  <Td align="right">{stats ? formatNumber(stats.orderCount) : "–"}</Td>
                  <Td align="right" className="font-medium">
                    {stats ? formatEur(stats.revenueCents) : "–"}
                  </Td>
                  <Td align="right">
                    <Link
                      href={`/customers/${c.id}/edit`}
                      className="text-xs font-medium text-ink-tertiary hover:text-accent"
                    >
                      Bearbeiten
                    </Link>
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
