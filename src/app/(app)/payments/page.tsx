import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, Badge, EmptyState } from "@/components/ui";
import { formatEur, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { PaymentForm } from "./payment-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zahlungen" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>;
}) {
  const params = await searchParams;

  const [payments, openInvoices] = await Promise.all([
    db.payment.findMany({
      where: params.direction ? { direction: params.direction } : {},
      include: {
        invoice: { include: { supplier: true, customer: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 200,
    }),
    db.invoice.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      include: { supplier: true, customer: true, payments: true },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  const totalIn = payments.filter((p) => p.direction === "INCOMING").reduce((a, p) => a + p.amountEurCents, 0);
  const totalOut = payments.filter((p) => p.direction === "OUTGOING").reduce((a, p) => a + p.amountEurCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Zahlungen"
        subtitle={`Eingehend ${formatEur(totalIn)} · Ausgehend ${formatEur(totalOut)} (angezeigter Zeitraum)`}
      />

      <PaymentForm
        openInvoices={openInvoices.map((inv) => {
          const open = inv.totalEurCents - inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
          const party = inv.supplier?.name ?? inv.customer?.name ?? "";
          return { id: inv.id, label: `${inv.invoiceNumber} · ${party} · offen ${formatEur(open)}` };
        })}
      />

      <form method="get" className="flex items-center gap-2">
        <select name="direction" defaultValue={params.direction ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Richtungen</option>
          <option value="INCOMING">Eingehend</option>
          <option value="OUTGOING">Ausgehend</option>
        </select>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {payments.length === 0 ? (
        <EmptyState title="Keine Zahlungen gefunden" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Datum</Th>
              <Th>Richtung</Th>
              <Th align="right">Betrag</Th>
              <Th>Rechnung</Th>
              <Th>Lieferant / Kunde</Th>
              <Th>Methode</Th>
              <Th>Referenz</Th>
            </tr>
          </THead>
          <tbody>
            {payments.map((p) => (
              <Tr key={p.id}>
                <Td>{formatDate(p.paidAt)}</Td>
                <Td>
                  <Badge tone={p.direction === "INCOMING" ? "green" : "neutral"}>{label(p.direction)}</Badge>
                </Td>
                <Td align="right" className="font-medium">
                  {formatEur(p.amountEurCents)}
                  {p.currency !== "EUR" && (
                    <span className="block text-xs text-ink-tertiary">{formatMoney(p.amountCents, p.currency)}</span>
                  )}
                </Td>
                <Td>
                  {p.invoice ? (
                    <Link href={`/invoices/${p.invoiceId}`} className="hover:text-accent">
                      {p.invoice.invoiceNumber}
                    </Link>
                  ) : "–"}
                </Td>
                <Td>
                  {p.invoice?.supplier ? (
                    <Link href={`/suppliers/${p.invoice.supplierId}`} className="hover:text-accent">{p.invoice.supplier.name}</Link>
                  ) : p.invoice?.customer ? (
                    <Link href={`/customers/${p.invoice.customerId}`} className="hover:text-accent">{p.invoice.customer.name}</Link>
                  ) : "–"}
                </Td>
                <Td>{p.method ?? "–"}</Td>
                <Td className="text-ink-secondary">{p.reference ?? p.note ?? "–"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
