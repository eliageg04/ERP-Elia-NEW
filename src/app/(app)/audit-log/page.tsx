import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, Badge, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Log" };

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  PRODUCT: (id) => `/products/${id}`,
  PURCHASE_ORDER: (id) => `/purchase-orders/${id}`,
  CUSTOMER_ORDER: (id) => `/customer-orders/${id}`,
  INVOICE: (id) => `/invoices/${id}`,
  CUSTOMER: (id) => `/customers/${id}`,
  SUPPLIER: (id) => `/suppliers/${id}`,
  IMPORT_BATCH: (id) => `/imports/${id}`,
};

const ENTITY_LABELS: Record<string, string> = {
  PRODUCT: "Produkt",
  PURCHASE_ORDER: "Einkauf",
  CUSTOMER_ORDER: "Kundenbestellung",
  INVOICE: "Rechnung",
  CUSTOMER: "Kunde",
  SUPPLIER: "Großhändler",
  IMPORT_BATCH: "Import",
  IMPORT_ITEM: "Import-Position",
  USER: "Benutzer",
  UNIT: "Einheit",
  SETTING: "Einstellung",
  INTEGRATION: "Integration",
  SUPPLIER_MAPPING: "Mapping",
  SHIPMENT: "Sendung",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Angelegt",
  UPDATE: "Geändert",
  DELETE: "Gelöscht",
  STATUS_CHANGE: "Statuswechsel",
  IMPORT: "Import",
  CORRECTION: "Korrektur",
};

type Change = { field: string; old: unknown; new: unknown };

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (field.endsWith("Cents") && typeof value === "number") {
    return (value / 100).toFixed(2).replace(".", ",") + " €";
  }
  return String(value);
}

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; userId?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const where = {
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
  };

  const [logs, total, entityTypes, users] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ select: { entityType: true }, distinct: ["entityType"] }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageLink = (p: number) => {
    const q = new URLSearchParams();
    if (params.entityType) q.set("entityType", params.entityType);
    if (params.userId) q.set("userId", params.userId);
    q.set("page", String(p));
    return `/audit-log?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit Log"
        subtitle={`${total} Einträge · Jede relevante Änderung wird protokolliert (wer, wann, alt → neu).`}
      />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="entityType" defaultValue={params.entityType ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Bereiche</option>
          {entityTypes.map((e) => (
            <option key={e.entityType} value={e.entityType}>
              {ENTITY_LABELS[e.entityType] ?? e.entityType}
            </option>
          ))}
        </select>
        <select name="userId" defaultValue={params.userId ?? ""} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm">
          <option value="">Alle Benutzer</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {logs.length === 0 ? (
        <EmptyState title="Keine Einträge gefunden" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Zeitpunkt</Th>
              <Th>Benutzer</Th>
              <Th>Aktion</Th>
              <Th>Bereich</Th>
              <Th>Änderungen</Th>
              <Th>Kommentar</Th>
            </tr>
          </THead>
          <tbody>
            {logs.map((log) => {
              const changes: Change[] = log.changes ? JSON.parse(log.changes) : [];
              const linkFn = ENTITY_LINKS[log.entityType];
              return (
                <Tr key={log.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(log.createdAt)}</Td>
                  <Td>{log.user?.name ?? "System"}</Td>
                  <Td><Badge>{ACTION_LABELS[log.action] ?? log.action}</Badge></Td>
                  <Td>
                    {linkFn ? (
                      <Link href={linkFn(log.entityId)} className="hover:text-accent">
                        {ENTITY_LABELS[log.entityType] ?? log.entityType}
                      </Link>
                    ) : (
                      ENTITY_LABELS[log.entityType] ?? log.entityType
                    )}
                  </Td>
                  <Td>
                    {changes.length === 0 ? (
                      <span className="text-ink-tertiary">–</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {changes.slice(0, 4).map((c, i) => (
                          <li key={i} className="text-xs">
                            <span className="text-ink-tertiary">{c.field}:</span>{" "}
                            <span className="text-ink-tertiary line-through">{formatValue(c.field, c.old)}</span>{" "}
                            → <span className="font-medium">{formatValue(c.field, c.new)}</span>
                          </li>
                        ))}
                        {changes.length > 4 && (
                          <li className="text-xs text-ink-tertiary">+ {changes.length - 4} weitere</li>
                        )}
                      </ul>
                    )}
                  </Td>
                  <Td className="max-w-[260px] truncate text-ink-secondary" >{log.comment ?? "–"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-tertiary">Seite {page} von {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageLink(page - 1)} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 font-medium hover:bg-canvas">
                ← Zurück
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageLink(page + 1)} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 font-medium hover:bg-canvas">
                Weiter →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
