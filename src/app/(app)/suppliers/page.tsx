import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, LinkButton, EmptyState, Badge } from "@/components/ui";
import { ActionButton } from "@/components/form";
import { deleteAllSuppliersAction } from "@/server/actions/suppliers";
import { formatEur, toEurCents } from "@/lib/money";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Großhändler" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const showArchived = params.archived === "1";

  const suppliers = await db.supplier.findMany({
    where: {
      active: showArchived ? undefined : true,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { contactName: { contains: q } },
              { email: { contains: q } },
              { city: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 300,
  });

  // Bestellanzahl + Einkaufsvolumen (EUR) aller gelisteten Händler in EINER Query (kein N+1).
  // Auch Entwürfe zählen mit: der Betrag erscheint sofort beim Anlegen der Vorbestellung.
  const orders = await db.purchaseOrder.findMany({
    where: {
      supplierId: { in: suppliers.map((s) => s.id) },
      status: { not: "CANCELLED" },
    },
    select: { supplierId: true, fxRate: true, lines: { select: { lineTotalCents: true } } },
  });
  const statsMap = new Map<string, { orderCount: number; volumeEurCents: number }>();
  for (const o of orders) {
    const cur = statsMap.get(o.supplierId) ?? { orderCount: 0, volumeEurCents: 0 };
    cur.orderCount += 1;
    cur.volumeEurCents += o.lines.reduce((a, l) => a + toEurCents(l.lineTotalCents, o.fxRate), 0);
    statsMap.set(o.supplierId, cur);
  }

  return (
    <div>
      <PageHeader
        title="Großhändler"
        subtitle={`${suppliers.length} Großhändler`}
        actions={
          <div className="flex flex-wrap gap-2">
            {suppliers.length > 0 && (
              <ActionButton
                action={deleteAllSuppliersAction}
                variant="danger"
                size="md"
                confirmMessage="Wirklich ALLE Großhändler entfernen? Händler ohne Bestellungen werden gelöscht, Händler mit Bestellungen archiviert."
              >
                Alle löschen
              </ActionButton>
            )}
            <LinkButton href="/suppliers/new" variant="primary">Neuer Großhändler</LinkButton>
          </div>
        }
      />

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, Code, Kontakt, Ort…"
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

      {suppliers.length === 0 ? (
        <EmptyState
          title="Keine Großhändler gefunden"
          hint={q ? "Suchbegriff anpassen oder neuen Großhändler anlegen." : "Lege deinen ersten Großhändler an."}
          action={<LinkButton href="/suppliers/new" variant="primary">Neuer Großhändler</LinkButton>}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Großhändler</Th>
              <Th>Kontakt</Th>
              <Th>Währung</Th>
              <Th align="right">Bestellungen</Th>
              <Th align="right">Einkauf netto</Th>
              <Th align="right">Einkauf brutto</Th>
            </tr>
          </THead>
          <tbody>
            {suppliers.map((s) => {
              const stats = statsMap.get(s.id);
              const totalVolume = (stats?.volumeEurCents ?? 0) + s.legacyVolumeCents;
              return (
                <Tr key={s.id} muted={!s.active}>
                  <Td>
                    <Link href={`/suppliers/${s.id}`} className="font-medium hover:text-accent">
                      {s.name}
                    </Link>
                    <span className="block text-xs text-ink-tertiary">
                      {s.code}
                      {!s.active && " · archiviert"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-ink-secondary">{s.contactName ?? "–"}</span>
                    {s.email && <span className="block text-xs text-ink-tertiary">{s.email}</span>}
                  </Td>
                  <Td><Badge>{s.currency}</Badge></Td>
                  <Td align="right">{stats ? formatNumber(stats.orderCount) : "–"}</Td>
                  <Td align="right" className="font-medium">
                    {totalVolume > 0 ? formatEur(totalVolume) : "–"}
                    {s.legacyVolumeCents > 0 && (
                      <span className="block text-xs font-normal text-ink-tertiary">
                        davon Alt-Daten: {formatEur(s.legacyVolumeCents)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="text-ink-secondary">
                    {/* Brutto: deutsche Lieferanten +19 % USt; EU/Drittland reverse charge = netto */}
                    {totalVolume > 0
                      ? formatEur((s.country ?? "DE") === "DE" ? Math.round(totalVolume * 1.19) : totalVolume)
                      : "–"}
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
