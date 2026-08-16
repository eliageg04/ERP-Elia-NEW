import { db } from "@/server/db";
import { formatDateTime } from "@/lib/format";
import { Card } from "./ui";

type Change = { field: string; old: unknown; new: unknown };

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  qty: "Menge",
  qtyOrdered: "Bestellmenge",
  enteredQty: "Erfasste Menge",
  unitFactor: "Einheiten-Umrechnung",
  unitPriceCents: "Einzelpreis",
  discountCents: "Rabatt",
  name: "Name",
  expectedAt: "Erwartete Lieferung",
  orderedAt: "Bestelldatum",
  trackingNumber: "Trackingnummer",
  carrier: "Versanddienstleister",
  listPriceCents: "Verkaufspreis",
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (field.endsWith("Cents") && typeof value === "number") {
    return (value / 100).toFixed(2).replace(".", ",") + " €";
  }
  return String(value);
}

/**
 * Kombinierte Historie: Geschäftsereignisse (Warenfluss) + Audit-Log
 * (Feldänderungen mit alt/neu) chronologisch absteigend.
 */
export async function HistoryPanel({
  entityType,
  entityId,
  limit = 30,
}: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  const [events, audits] = await Promise.all([
    db.activityEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.auditLog.findMany({
      where: { entityType, entityId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const items = [
    ...events.map((e) => ({
      key: `e-${e.id}`,
      at: e.createdAt,
      kind: "event" as const,
      text: e.summary,
      by: null as string | null,
      changes: [] as Change[],
      comment: null as string | null,
    })),
    ...audits.map((a) => ({
      key: `a-${a.id}`,
      at: a.createdAt,
      kind: "audit" as const,
      text:
        a.action === "CREATE"
          ? "Datensatz angelegt"
          : a.action === "DELETE"
            ? "Datensatz gelöscht/storniert"
            : a.action === "CORRECTION"
              ? "Manuelle Korrektur"
              : "Änderung",
      by: a.user?.name ?? null,
      changes: a.changes ? (JSON.parse(a.changes) as Change[]) : [],
      comment: a.comment,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Card title="Historie">
      {items.length === 0 ? (
        <p className="text-sm text-ink-tertiary">Noch keine Einträge.</p>
      ) : (
        <ol className="relative flex flex-col gap-0">
          {items.slice(0, limit).map((item) => (
            <li key={item.key} className="relative border-l border-border pb-4 pl-4 last:pb-0">
              <span
                className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                  item.kind === "event" ? "bg-accent" : "bg-ink-tertiary"
                }`}
              />
              <p className="text-sm">{item.text}</p>
              {item.changes.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {item.changes.map((c, i) => (
                    <li key={i} className="text-xs text-ink-secondary">
                      {FIELD_LABELS[c.field] ?? c.field}:{" "}
                      <span className="text-ink-tertiary line-through">{formatValue(c.field, c.old)}</span>{" "}
                      → <span className="font-medium">{formatValue(c.field, c.new)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.comment && <p className="mt-0.5 text-xs italic text-ink-tertiary">„{item.comment}“</p>}
              <p className="mt-0.5 text-xs text-ink-tertiary">
                {item.by ? `${item.by} · ` : ""}
                {formatDateTime(item.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
