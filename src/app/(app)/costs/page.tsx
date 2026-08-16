import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, Badge, EmptyState } from "@/components/ui";
import { formatEur } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { CostForm } from "./cost-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kosten" };

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;

  const [costs, openPos] = await Promise.all([
    db.cost.findMany({
      where: params.type ? { type: params.type } : {},
      include: { purchaseOrder: { include: { supplier: true } }, customerOrder: true },
      orderBy: { incurredAt: "desc" },
      take: 200,
    }),
    db.purchaseOrder.findMany({
      where: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
      include: { supplier: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const total = costs.reduce((a, c) => a + c.amountEurCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kosten"
        subtitle={`${costs.length} Einträge · ${formatEur(total)} (angezeigter Zeitraum)`}
      />

      <CostForm
        purchaseOrders={openPos.map((p) => ({ id: p.id, label: `${p.orderNumber} · ${p.supplier.name}` }))}
      />

      <p className="text-sm text-ink-tertiary">
        Kosten mit verknüpfter Bestellung werden automatisch auf die Einstandspreise (Landed Costs) der
        Chargen verteilt – Standard: nach Warenwert.
      </p>

      <form method="get" className="flex items-center gap-2">
        <select name="type" defaultValue={params.type ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Typen</option>
          <option value="SHIPPING">Versand</option>
          <option value="CUSTOMS">Zoll</option>
          <option value="FEES">Gebühren</option>
          <option value="OTHER">Sonstiges</option>
        </select>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {costs.length === 0 ? (
        <EmptyState title="Keine Kosten erfasst" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Datum</Th>
              <Th>Typ</Th>
              <Th>Beschreibung</Th>
              <Th align="right">Betrag (EUR)</Th>
              <Th>Verteilung</Th>
              <Th>Bestellung</Th>
            </tr>
          </THead>
          <tbody>
            {costs.map((c) => (
              <Tr key={c.id}>
                <Td>{formatDate(c.incurredAt)}</Td>
                <Td><Badge>{label(c.type)}</Badge></Td>
                <Td className="text-ink-secondary">{c.description ?? "–"}</Td>
                <Td align="right" className="font-medium">{formatEur(c.amountEurCents)}</Td>
                <Td className="text-ink-secondary">{label(c.allocationMethod)}</Td>
                <Td>
                  {c.purchaseOrder ? (
                    <Link href={`/purchase-orders/${c.purchaseOrderId}`} className="hover:text-accent">
                      {c.purchaseOrder.orderNumber} · {c.purchaseOrder.supplier.name}
                    </Link>
                  ) : c.customerOrder ? (
                    <Link href={`/customer-orders/${c.customerOrderId}`} className="hover:text-accent">
                      {c.customerOrder.orderNumber}
                    </Link>
                  ) : "–"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
