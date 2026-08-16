import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getCustomerStats } from "@/server/services/stats";
import {
  PageHeader, Card, StatCard, DL, DT, DD, Table, THead, Th, Td, Tr,
  LinkButton, Badge, StatusBadge, EmptyState,
} from "@/components/ui";
import { NotesPanel } from "@/components/notes";
import { HistoryPanel } from "@/components/history";
import { formatEur } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

function formatAddress(
  street: string | null,
  zip: string | null,
  city: string | null,
  country: string | null
): string | null {
  // Land nur berücksichtigen, wenn überhaupt eine Adresse erfasst ist (country hat Default "DE")
  if (!street && !zip && !city) return null;
  const parts = [street, [zip, city].filter(Boolean).join(" "), country].filter(
    (p) => p && p.length > 0
  );
  return parts.join(", ");
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  const [stats, orders] = await Promise.all([
    getCustomerStats(id),
    db.customerOrder.findMany({
      where: { customerId: id },
      include: { lines: { select: { lineTotalCents: true } } },
      orderBy: { orderedAt: "desc" },
      take: 50,
    }),
  ]);

  // Meistgekaufte Produkte: Produktnamen zu den IDs aus der Statistik nachladen
  const topProductIds = stats.topProducts.map(([productId]) => productId);
  const topProductRecords = await db.product.findMany({
    where: { id: { in: topProductIds } },
    select: { id: true, name: true, sku: true },
  });
  const productById = new Map(topProductRecords.map((p) => [p.id, p]));

  const billingAddress = formatAddress(
    customer.billingStreet, customer.billingZip, customer.billingCity, customer.billingCountry
  );
  const shippingAddress = formatAddress(
    customer.shippingStreet, customer.shippingZip, customer.shippingCity, customer.shippingCountry
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name}
        backHref="/customers"
        backLabel="Kunden"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{customer.code}</span>
            {customer.company && <span>· {customer.company}</span>}
            {!customer.active && <Badge tone="red">Archiviert</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/customer-orders/new?customerId=${id}`} variant="primary">
              Neue Bestellung
            </LinkButton>
            <LinkButton href={`/customers/${id}/edit`}>Bearbeiten</LinkButton>
          </>
        }
      />

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Gesamtumsatz" value={formatEur(stats.revenueCents)} />
        <StatCard
          label="Bestellungen"
          value={formatNumber(stats.orderCount)}
          hint={stats.lastOrderAt ? `zuletzt ${formatDate(stats.lastOrderAt)}` : undefined}
        />
        <StatCard
          label="Offene Bestellungen"
          value={formatNumber(stats.openOrders)}
          tone={stats.openOrders > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Offene Zahlungen"
          value={formatEur(stats.openPaymentsCents)}
          tone={stats.openPaymentsCents > 0 ? "warn" : "default"}
        />
        <StatCard label="Ø Bestellwert" value={formatEur(stats.avgOrderValueCents)} />
        <StatCard
          label="Gewinn"
          value={formatEur(stats.profitCents)}
          hint="realisiert (versendete Ware)"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          {/* Bestellungen */}
          <Card title="Bestellungen">
            {orders.length === 0 ? (
              <EmptyState
                title="Noch keine Bestellungen"
                hint="Lege die erste Bestellung für diesen Kunden an."
                action={
                  <LinkButton href={`/customer-orders/new?customerId=${id}`} variant="primary">
                    Neue Bestellung
                  </LinkButton>
                }
              />
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Nummer</Th>
                    <Th>Datum</Th>
                    <Th>Status</Th>
                    <Th align="right">Wert</Th>
                  </tr>
                </THead>
                <tbody>
                  {orders.map((o) => {
                    const totalCents = o.lines.reduce((a, l) => a + l.lineTotalCents, 0);
                    return (
                      <Tr key={o.id} muted={o.status === "CANCELLED"}>
                        <Td>
                          <Link href={`/customer-orders/${o.id}`} className="font-medium hover:text-accent">
                            {o.orderNumber}
                          </Link>
                        </Td>
                        <Td>{formatDate(o.orderedAt)}</Td>
                        <Td><StatusBadge status={o.status} /></Td>
                        <Td align="right" className="font-medium">
                          {formatEur(totalCents)}
                          {o.shippingFeeCents > 0 && (
                            <span className="block text-xs font-normal text-ink-tertiary">
                              + {formatEur(o.shippingFeeCents)} Versand
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

          {/* Meistgekaufte Produkte */}
          <Card title="Meistgekaufte Produkte">
            {stats.topProducts.length === 0 ? (
              <p className="text-sm text-ink-tertiary">Noch keine Käufe erfasst.</p>
            ) : (
              <Table className="border-0">
                <THead>
                  <tr>
                    <Th>Produkt</Th>
                    <Th align="right">Gekaufte Menge</Th>
                  </tr>
                </THead>
                <tbody>
                  {stats.topProducts.map(([productId, qty]) => {
                    const product = productById.get(productId);
                    return (
                      <Tr key={productId}>
                        <Td>
                          {product ? (
                            <>
                              <Link href={`/products/${productId}`} className="font-medium hover:text-accent">
                                {product.name}
                              </Link>
                              <span className="block font-mono text-xs text-ink-tertiary">{product.sku}</span>
                            </>
                          ) : (
                            <span className="text-ink-tertiary">Unbekanntes Produkt</span>
                          )}
                        </Td>
                        <Td align="right" className="font-medium">{formatNumber(qty)}</Td>
                      </Tr>
                    );
                  })}
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
              <DD className="font-mono text-xs">{customer.code}</DD>
              <DT>Firma</DT>
              <DD>{customer.company ?? "–"}</DD>
              <DT>E-Mail</DT>
              <DD>
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="hover:text-accent">{customer.email}</a>
                ) : (
                  "–"
                )}
              </DD>
              <DT>Telefon</DT>
              <DD>{customer.phone ?? "–"}</DD>
              <DT>Angelegt am</DT>
              <DD>{formatDate(customer.createdAt)}</DD>
            </DL>
          </Card>

          {/* Adressen */}
          <Card title="Adressen">
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                  Rechnungsadresse
                </div>
                <p className="mt-0.5">{billingAddress ?? "–"}</p>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">
                  Lieferadresse
                </div>
                <p className="mt-0.5">
                  {shippingAddress ?? (
                    <span className="text-ink-tertiary">wie Rechnungsadresse</span>
                  )}
                </p>
              </div>
            </div>
          </Card>

          <NotesPanel entityType="CUSTOMER" entityId={id} />
          <HistoryPanel entityType="CUSTOMER" entityId={id} />
        </div>
      </div>
    </div>
  );
}
