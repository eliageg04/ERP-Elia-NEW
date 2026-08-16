import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, StatusBadge, EmptyState, LinkButton } from "@/components/ui";
import { formatDate } from "@/lib/format";
import {
  CARRIERS,
  CUSTOMER_SHIPMENT_STATUSES,
  INBOUND_SHIPMENT_STATUSES,
  label,
} from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "Versand" };

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ dir?: string; status?: string; carrier?: string }>;
}) {
  const params = await searchParams;
  const dir: "in" | "out" = params.dir === "in" ? "in" : "out";
  const status = params.status?.trim() || "";
  const carrier = params.carrier?.trim() || "";

  const where = {
    ...(status ? { status } : {}),
    ...(carrier ? { carrier } : {}),
  };

  const outbound =
    dir === "out"
      ? await db.customerShipment.findMany({
          where,
          include: { order: { include: { customer: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];
  const inbound =
    dir === "in"
      ? await db.inboundShipment.findMany({
          where,
          include: { purchaseOrder: { include: { supplier: true } } },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];

  const count = dir === "out" ? outbound.length : inbound.length;
  const statusOptions = dir === "in" ? INBOUND_SHIPMENT_STATUSES : CUSTOMER_SHIPMENT_STATUSES;

  return (
    <div>
      <PageHeader
        title="Versand"
        subtitle={`${count} ${dir === "out" ? "ausgehende" : "eingehende"} Sendungen`}
      />

      {/* Richtung umschalten */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/shipments?dir=out" variant={dir === "out" ? "primary" : "secondary"} size="sm">
          Ausgehend (Kunden)
        </LinkButton>
        <LinkButton href="/shipments?dir=in" variant={dir === "in" ? "primary" : "secondary"} size="sm">
          Eingehend (Lieferanten)
        </LinkButton>
      </div>

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="dir" value={dir} />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Status</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select
          name="carrier"
          defaultValue={carrier}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Carrier</option>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
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

      {dir === "out" ? (
        outbound.length === 0 ? (
          <EmptyState
            title="Keine ausgehenden Sendungen gefunden"
            hint="Sendungen entstehen beim Versand aus einer Kundenbestellung."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Nummer</Th>
                <Th>Bestellung</Th>
                <Th>Kunde</Th>
                <Th>Status</Th>
                <Th>Carrier</Th>
                <Th>Tracking</Th>
                <Th>Versendet am</Th>
                <Th>Zugestellt am</Th>
              </tr>
            </THead>
            <tbody>
              {outbound.map((s) => (
                <Tr key={s.id} muted={s.status === "CANCELLED"}>
                  <Td>
                    <Link href={`/shipments/out/${s.id}`} className="font-medium hover:text-accent">
                      {s.shipmentNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customer-orders/${s.customerOrderId}`} className="hover:text-accent">
                      {s.order.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/customers/${s.order.customerId}`} className="hover:text-accent">
                      {s.order.customer.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={s.status} />
                  </Td>
                  <Td>{s.carrier ?? "–"}</Td>
                  <Td className="font-mono text-xs">{s.trackingNumber ?? "–"}</Td>
                  <Td>{formatDate(s.shippedAt)}</Td>
                  <Td>{formatDate(s.deliveredAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )
      ) : inbound.length === 0 ? (
        <EmptyState
          title="Keine eingehenden Sendungen gefunden"
          hint="Eingehende Sendungen werden auf der Bestellung (PO) gemeldet."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Nummer</Th>
              <Th>Bestellung</Th>
              <Th>Lieferant</Th>
              <Th>Status</Th>
              <Th>Carrier</Th>
              <Th>Tracking</Th>
              <Th>Versendet am</Th>
              <Th>ETA</Th>
            </tr>
          </THead>
          <tbody>
            {inbound.map((s) => (
              <Tr key={s.id} muted={s.status === "CANCELLED"}>
                <Td>
                  <Link href={`/shipments/in/${s.id}`} className="font-medium hover:text-accent">
                    {s.shipmentNumber}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/purchase-orders/${s.purchaseOrderId}`} className="hover:text-accent">
                    {s.purchaseOrder.orderNumber}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/suppliers/${s.purchaseOrder.supplierId}`} className="hover:text-accent">
                    {s.purchaseOrder.supplier.name}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={s.status} />
                </Td>
                <Td>{s.carrier ?? "–"}</Td>
                <Td className="font-mono text-xs">{s.trackingNumber ?? "–"}</Td>
                <Td>{formatDate(s.shippedAt)}</Td>
                <Td>{formatDate(s.estimatedArrival)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
