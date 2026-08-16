import Link from "next/link";
import { getDashboardData } from "@/server/services/dashboard";
import { computeWarnings } from "@/server/services/warnings";
import { Card, StatCard, Badge } from "@/components/ui";
import { formatEur, formatPercent } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/format";
import { AlertTriangle, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [data, warnings] = await Promise.all([getDashboardData(), computeWarnings()]);

  return (
    <div className="flex flex-col gap-6">
      {/* Was muss ich heute tun? */}
      <Card title="Heute zu erledigen">
        {data.todos.length === 0 ? (
          <p className="text-sm text-ink-tertiary">Nichts Dringendes – alles im grünen Bereich.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.todos.map((todo) => (
              <li key={todo.href + todo.label}>
                <Link
                  href={todo.href}
                  className="flex items-center justify-between gap-2 py-2 text-sm hover:text-accent"
                >
                  <span>
                    <span className="tnum mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent-soft px-1 text-xs font-semibold text-accent">
                      {todo.count}
                    </span>
                    {todo.label}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Warnungen */}
      {warnings.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-warn" />
              Warnungen ({warnings.length})
            </span>
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>
                <Link href={w.href} className="flex items-start gap-2 py-2 text-sm hover:text-accent">
                  <Badge tone={w.severity === "high" ? "red" : w.severity === "medium" ? "amber" : "neutral"}>
                    {w.category}
                  </Badge>
                  <span className="min-w-0 flex-1">{w.message}</span>
                </Link>
              </li>
            ))}
          </ul>
          {warnings.length > 8 && (
            <p className="mt-2 text-xs text-ink-tertiary">+ {warnings.length - 8} weitere Warnungen</p>
          )}
        </Card>
      )}

      {/* Einkauf */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Einkauf</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Offene Bestellungen" value={formatNumber(data.purchase.openPoCount)} href="/purchase-orders" />
          <StatCard label="Bestellte Einheiten" value={formatNumber(data.purchase.orderedUnits)} href="/purchase-orders" />
          <StatCard label="Noch nicht versendet" value={formatNumber(data.purchase.notShippedUnits)} hint="beim Großhändler" />
          <StatCard label="Im Versand" value={formatNumber(data.purchase.inTransitUnits)} hint="Einheiten unterwegs" />
          <StatCard
            label="Teillieferungen"
            value={formatNumber(data.purchase.partiallyReceivedCount)}
            tone={data.purchase.partiallyReceivedCount > 0 ? "warn" : "default"}
            href="/purchase-orders?status=PARTIALLY_RECEIVED"
          />
          <StatCard label="Offener Einkaufswert" value={formatEur(data.purchase.openPurchaseValueCents)} hint="noch nicht eingetroffen" />
        </div>
      </section>

      {/* Lager */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Lager</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Lagerwert" value={formatEur(data.inventory.valueCents)} hint="zu Einstandskosten" href="/inventory" />
          <StatCard label="Gesamtbestand" value={formatNumber(data.inventory.totalOnHand)} href="/inventory" />
          <StatCard label="Reserviert" value={formatNumber(data.inventory.totalReserved)} hint="für Kunden" />
          <StatCard label="Frei verfügbar" value={formatNumber(data.inventory.totalAvailable)} />
        </div>
        {data.inventory.recentReceipts.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-tertiary">
              Kürzlich eingetroffen
            </h3>
            <ul className="flex flex-col gap-1">
              {data.inventory.recentReceipts.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/purchase-orders/${r.poId}`} className="min-w-0 truncate hover:text-accent">
                    {r.productName}
                  </Link>
                  <span className="tnum shrink-0 text-ink-secondary">
                    +{formatNumber(r.qty)} · {formatDate(r.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Kunden */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Kunden</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Offene Bestellungen" value={formatNumber(data.sales.openOrderCount)} href="/customer-orders" />
          <StatCard
            label="Zu versenden"
            value={formatNumber(data.sales.toShipCount)}
            tone={data.sales.toShipCount > 0 ? "warn" : "default"}
            href="/customer-orders?filter=ready"
          />
          <StatCard label="Unterwegs zum Kunden" value={formatNumber(data.sales.inTransitCount)} href="/shipments" />
          <StatCard
            label="Offene Zahlungen"
            value={formatEur(data.sales.openPaymentsCents)}
            tone={data.sales.openPaymentsCents > 0 ? "warn" : "default"}
            href="/invoices?filter=open"
          />
        </div>
      </section>

      {/* Finanzen */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Finanzen (letzte 30 Tage)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            label="Offene Rechnungen"
            value={formatNumber(data.finance.openInvoiceCount)}
            hint={formatEur(data.finance.openInvoiceCents)}
            href="/invoices?filter=open"
          />
          <StatCard label="Bezahlte Rechnungen" value={formatNumber(data.finance.paidInvoiceCount)} href="/invoices?filter=paid" />
          <StatCard label="Einkaufsvolumen" value={formatEur(data.finance.purchaseVolumeCents)} />
          <StatCard label="Verkaufsvolumen" value={formatEur(data.finance.salesVolumeCents)} />
          <StatCard label="Bruttomarge" value={formatPercent(data.finance.grossMarginPct)} hint="auf versendete Ware" href="/reports" />
        </div>
      </section>
    </div>
  );
}
