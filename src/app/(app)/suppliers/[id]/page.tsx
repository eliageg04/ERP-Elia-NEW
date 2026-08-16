import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getSupplierStats } from "@/server/services/stats";
import {
  PageHeader, Card, StatCard, DL, DT, DD, Table, THead, Th, Td, Tr,
  LinkButton, Badge, StatusBadge, EmptyState,
} from "@/components/ui";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur, formatMoney, toEurCents } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      productMappings: {
        include: { product: true, defaultUnit: true },
        orderBy: { supplierName: "asc" },
      },
    },
  });
  if (!supplier) notFound();

  const [stats, orders, openInvoices] = await Promise.all([
    getSupplierStats(id),
    db.purchaseOrder.findMany({
      where: { supplierId: id },
      include: { lines: { select: { lineTotalCents: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.invoice.findMany({
      where: { supplierId: id, type: "SUPPLIER", status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      include: { payments: { select: { amountEurCents: true } } },
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  // Land nur anzeigen, wenn überhaupt eine Adresse erfasst ist (country hat Default "DE")
  const hasAddress = Boolean(supplier.street || supplier.zip || supplier.city);
  const address = hasAddress
    ? [supplier.street, [supplier.zip, supplier.city].filter(Boolean).join(" "), supplier.country]
        .filter((part) => part && part.length > 0)
        .join(", ")
    : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={supplier.name}
        backHref="/suppliers"
        backLabel="Großhändler"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{supplier.code}</span>
            <Badge>{supplier.currency}</Badge>
            {!supplier.active && <Badge tone="red">Archiviert</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/purchase-orders/new?supplierId=${id}`} variant="primary">
              Neue Bestellung
            </LinkButton>
            <LinkButton href={`/suppliers/${id}/edit`}>Bearbeiten</LinkButton>
          </>
        }
      />

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Bestellungen" value={formatNumber(stats.orderCount)} hint="ohne Entwürfe/Stornos" />
        <StatCard label="Einkaufsvolumen" value={formatEur(stats.volumeEurCents)} />
        <StatCard
          label="Offene Lieferungen"
          value={formatNumber(stats.openOrders)}
          hint="noch nicht vollständig angekommen"
          tone={stats.openOrders > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Offene Rechnungen"
          value={formatNumber(stats.openInvoices)}
          tone={stats.openInvoices > 0 ? "warn" : "default"}
        />
        <StatCard label="Produkte" value={formatNumber(stats.productCount)} hint="bereits bestellt" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Bestellungen */}
          <Card title="Bestellungen">
            {orders.length === 0 ? (
              <EmptyState
                title="Noch keine Bestellungen"
                hint="Lege die erste Bestellung bei diesem Großhändler an."
                action={
                  <LinkButton href={`/purchase-orders/new?supplierId=${id}`} variant="primary">
                    Neue Bestellung
                  </LinkButton>
                }
              />
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Status</Th>
                    <Th>Datum</Th>
                    <Th align="right">Wert</Th>
                  </tr>
                </THead>
                <tbody>
                  {orders.map((o) => {
                    const totalCents = o.lines.reduce((a, l) => a + l.lineTotalCents, 0);
                    const totalEurCents = toEurCents(totalCents, o.fxRate);
                    return (
                      <Tr key={o.id} muted={o.status === "CANCELLED"}>
                        <Td>
                          <Link href={`/purchase-orders/${o.id}`} className="font-medium hover:text-accent">
                            {o.orderNumber}
                          </Link>
                          {o.supplierOrderNumber && (
                            <span className="block text-xs text-ink-tertiary">
                              Händler-Nr: {o.supplierOrderNumber}
                            </span>
                          )}
                        </Td>
                        <Td><StatusBadge status={o.status} /></Td>
                        <Td>{formatDate(o.orderedAt ?? o.createdAt)}</Td>
                        <Td align="right" className="font-medium">
                          {formatMoney(totalCents, o.currency)}
                          {o.currency !== "EUR" && (
                            <span className="block text-xs font-normal text-ink-tertiary">
                              ≈ {formatEur(totalEurCents)}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Offene Rechnungen */}
          <Card title="Offene Rechnungen">
            {openInvoices.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Keine offenen Rechnungen.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Rechnung</Th>
                    <Th>Status</Th>
                    <Th>Fällig</Th>
                    <Th align="right">Betrag</Th>
                    <Th align="right">Offen</Th>
                  </tr>
                </THead>
                <tbody>
                  {openInvoices.map((inv) => {
                    const paidEurCents = inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
                    const openEurCents = inv.totalEurCents - paidEurCents;
                    return (
                      <Tr key={inv.id}>
                        <Td>
                          <Link href={`/invoices/${inv.id}`} className="font-medium hover:text-accent">
                            {inv.invoiceNumber}
                          </Link>
                          {inv.externalNumber && (
                            <span className="block text-xs text-ink-tertiary">Extern: {inv.externalNumber}</span>
                          )}
                        </Td>
                        <Td><StatusBadge status={inv.status} /></Td>
                        <Td>{formatDate(inv.dueAt)}</Td>
                        <Td align="right">{formatEur(inv.totalEurCents)}</Td>
                        <Td align="right" className="font-medium">{formatEur(openEurCents)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* Produkt-Mappings */}
          <Card title="Produkt-Bezeichnungen dieses Händlers">
            {supplier.productMappings.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                Noch keine Mappings – sie entstehen automatisch beim Import von Rechnungen/Bestellungen.
              </p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Bezeichnung beim Händler</Th>
                    <Th>Internes Produkt</Th>
                    <Th>Einheit</Th>
                    <Th align="right">Letzter Preis</Th>
                  </tr>
                </THead>
                <tbody>
                  {supplier.productMappings.map((m) => (
                    <Tr key={m.id}>
                      <Td>
                        <span className="text-ink-secondary">„{m.supplierName}“</span>
                        {m.supplierSku && (
                          <span className="block text-xs text-ink-tertiary">Art-Nr: {m.supplierSku}</span>
                        )}
                      </Td>
                      <Td>
                        <Link href={`/products/${m.productId}`} className="font-medium hover:text-accent">
                          {m.product.name}
                        </Link>
                        <span className="block font-mono text-xs text-ink-tertiary">{m.product.sku}</span>
                      </Td>
                      <Td>
                        {m.unitFactor
                          ? `1 ${m.defaultUnit?.name ?? "Einheit"} = ${formatNumber(m.unitFactor)}`
                          : m.defaultUnit?.name ?? "–"}
                      </Td>
                      <Td align="right">{formatEur(m.lastPriceCents)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* Stammdaten */}
          <Card title="Stammdaten">
            <DL>
              <DT>Code</DT>
              <DD className="font-mono text-xs">{supplier.code}</DD>
              <DT>Ansprechpartner</DT>
              <DD>{supplier.contactName ?? "–"}</DD>
              <DT>E-Mail</DT>
              <DD>
                {supplier.email ? (
                  <a href={`mailto:${supplier.email}`} className="hover:text-accent">{supplier.email}</a>
                ) : (
                  "–"
                )}
              </DD>
              <DT>Telefon</DT>
              <DD>{supplier.phone ?? "–"}</DD>
              <DT>Webseite</DT>
              <DD>
                {supplier.website ? (
                  <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                    {supplier.website}
                  </a>
                ) : (
                  "–"
                )}
              </DD>
              <DT>Adresse</DT>
              <DD>{address || "–"}</DD>
              <DT>Währung</DT>
              <DD>{supplier.currency}</DD>
              <DT>Zahlungsbedingungen</DT>
              <DD>{supplier.paymentTerms ?? "–"}</DD>
              <DT>Unsere Kundennummer</DT>
              <DD>{supplier.customerNumber ?? "–"}</DD>
              <DT>Angelegt am</DT>
              <DD>{formatDate(supplier.createdAt)}</DD>
            </DL>
          </Card>

          <NotesPanel entityType="SUPPLIER" entityId={id} />
          <HistoryPanel entityType="SUPPLIER" entityId={id} />
        </div>
      </div>
    </div>
  );
}
