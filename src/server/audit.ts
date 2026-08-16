import { db } from "./db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Change = { field: string; old: unknown; new: unknown };

/** Feldänderungen protokollieren (Audit-Log). */
export async function writeAudit(
  params: {
    userId?: string | null;
    entityType: string;
    entityId: string;
    action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE" | "IMPORT" | "CORRECTION";
    changes?: Change[];
    comment?: string;
  },
  tx?: Tx
) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      userId: params.userId ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changes: params.changes ? JSON.stringify(params.changes) : null,
      comment: params.comment ?? null,
    },
  });
}

/** Geschäftsereignis (Warenfluss-Historie) protokollieren. */
export async function writeEvent(
  params: {
    type: string;
    entityType: string;
    entityId: string;
    summary: string;
    meta?: Record<string, unknown>;
    userId?: string | null;
  },
  tx?: Tx
) {
  const client = tx ?? db;
  await client.activityEvent.create({
    data: {
      type: params.type,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
      meta: params.meta ? JSON.stringify(params.meta) : null,
      userId: params.userId ?? null,
    },
  });
}

/** Diff zweier Objekte für das Audit-Log (nur geänderte Felder). */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields?: (keyof T)[]
): Change[] {
  const keys = fields ?? (Object.keys(after) as (keyof T)[]);
  const changes: Change[] = [];
  for (const key of keys) {
    if (!(key in after)) continue;
    const oldVal = before[key];
    const newVal = after[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
    if (JSON.stringify(norm(oldVal)) !== JSON.stringify(norm(newVal))) {
      changes.push({ field: String(key), old: norm(oldVal), new: norm(newVal) });
    }
  }
  return changes;
}
