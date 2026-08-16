import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PageHeader, Card, DL, DT, DD, Table, THead, Th, Td, Tr, StatusBadge, Badge } from "@/components/ui";
import { ActionButton } from "@/components/form";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { cancelInvoiceAction } from "@/server/actions/finance";
import { PaymentPanel } from "./panels";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      customer: true,
      purchaseOrder: true,
      customerOrder: true,
      lines: { include: { product: true } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!invoice) notFound();

  const paidEur = invoice.payments.reduce((a, p) => a + p.amountEurCents, 0);
  const openEur = invoice.status === "CANCELLED" ? 0 : invoice.totalEurCents - paidEur;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {invoice.invoiceNumber}
            <StatusBadge status={invoice.status} />
            <Badge tone={invoice.type === "SUPPLIER" ? "neutral" : "blue"}>{label(invoice.type)}</Badge>
          </span>
        }
        subtitle={invoice.externalNumber ? `Externe Nummer: ${invoice.externalNumber}` : undefined}
        backHref="/invoices"
        backLabel="Rechnungen"
        actions={
          invoice.status !== "CANCELLED" && invoice.payments.length === 0 ? (
            <ActionButton
              action={cancelInvoiceAction}
              variant="danger"
              hiddenFields={{ id }}
              confirmMessage="Rechnung wirklich stornieren?"
            >
              Stornieren
            </ActionButton>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card title="Details">
            <DL>
              <DT>{invoice.type === "SUPPLIER" ? "Lieferant" : "Kunde"}</DT>
              <DD>
                {invoice.supplier ? (
                  <Link href={`/suppliers/${invoice.supplierId}`} className="hover:text-accent">{invoice.supplier.name}</Link>
                ) : invoice.customer ? (
                  <Link href={`/customers/${invoice.customerId}`} className="hover:text-accent">{invoice.customer.name}</Link>
                ) : "–"}
              </DD>
              <DT>Verknüpfte Bestellung</DT>
              <DD>
                {invoice.purchaseOrder ? (
                  <Link href={`/purchase-orders/${invoice.purchaseOrderId}`} className="hover:text-accent">
                    {invoice.purchaseOrder.orderNumber}
                  </Link>
                ) : invoice.customerOrder ? (
                  <Link href={`/customer-orders/${invoice.customerOrderId}`} className="hover:text-accent">
                    {invoice.customerOrder.orderNumber}
                  </Link>
                ) : "–"}
              </DD>
              <DT>Rechnungsdatum</DT>
              <DD>{formatDate(invoice.issuedAt)}</DD>
              <DT>Fällig am</DT>
              <DD>{formatDate(invoice.dueAt)}</DD>
              <DT>Währung</DT>
              <DD>
                {invoice.currency}
                {invoice.currency !== "EUR" && ` (Kurs ${invoice.fxRate.toLocaleString("de-DE")} EUR)`}
              </DD>
              <DT>Netto</DT>
              <DD className="tnum">{formatMoney(invoice.netCents, invoice.currency)}</DD>
              <DT>Steuer</DT>
              <DD className="tnum">{formatMoney(invoice.taxCents, invoice.currency)}</DD>
              <DT>Brutto</DT>
              <DD className="tnum font-medium">{formatMoney(invoice.totalCents, invoice.currency)}</DD>
              {invoice.currency !== "EUR" && (
                <>
                  <DT>Brutto in EUR</DT>
                  <DD className="tnum font-medium">{formatEur(invoice.totalEurCents)}</DD>
                </>
              )}
              <DT>Bezahlt</DT>
              <DD className="tnum">{formatEur(paidEur)}</DD>
              <DT>Offen</DT>
              <DD className={`tnum font-semibold ${openEur > 0 ? "text-warn" : "text-ok"}`}>{formatEur(openEur)}</DD>
            </DL>
          </Card>

          {invoice.lines.length > 0 && (
            <Card title="Positionen">
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Beschreibung</Th>
                    <Th align="right">Menge</Th>
                    <Th align="right">Einzelpreis</Th>
                    <Th align="right">Gesamt</Th>
                  </tr>
                </THead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <Tr key={line.id}>
                      <Td>
                        {line.product ? (
                          <Link href={`/products/${line.productId}`} className="hover:text-accent">
                            {line.description}
                          </Link>
                        ) : (
                          line.description
                        )}
                      </Td>
                      <Td align="right">{line.qty}</Td>
                      <Td align="right">{formatMoney(line.unitPriceCents, invoice.currency)}</Td>
                      <Td align="right">{formatMoney(line.totalCents, invoice.currency)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          <Card title={`Zahlungen (${invoice.payments.length})`}>
            {invoice.payments.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Zahlungen erfasst.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Datum</Th>
                    <Th align="right">Betrag</Th>
                    <Th>Methode</Th>
                    <Th>Referenz</Th>
                  </tr>
                </THead>
                <tbody>
                  {invoice.payments.map((p) => (
                    <Tr key={p.id}>
                      <Td>{formatDate(p.paidAt)}</Td>
                      <Td align="right" className="font-medium">
                        {formatEur(p.amountEurCents)}
                        {p.currency !== "EUR" && (
                          <span className="block text-xs text-ink-tertiary">
                            {formatMoney(p.amountCents, p.currency)}
                          </span>
                        )}
                      </Td>
                      <Td>{p.method ?? "–"}</Td>
                      <Td className="text-ink-secondary">{p.reference ?? p.note ?? "–"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {openEur > 0 && invoice.status !== "CANCELLED" && (
            <PaymentPanel invoiceId={id} openCents={openEur} currency={invoice.currency} fxRate={invoice.fxRate} />
          )}
          <NotesPanel entityType="INVOICE" entityId={id} />
          <HistoryPanel entityType="INVOICE" entityId={id} />
        </div>
      </div>
    </div>
  );
}
