"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, diffChanges } from "../audit";
import { nextNumber } from "../numbering";
import { CURRENCIES } from "@/lib/constants";
import { runAction, str, optStr } from "./helpers";
import type { ActionState } from "@/components/form";

/** Gemeinsame Formularfelder (ohne Name/Code) auslesen und validieren. */
function supplierFields(formData: FormData) {
  const currency = optStr(formData, "currency") ?? "EUR";
  if (!(CURRENCIES as readonly string[]).includes(currency)) {
    throw new AppError("Ungültige Währung gewählt.");
  }
  return {
    contactName: optStr(formData, "contactName"),
    email: optStr(formData, "email"),
    phone: optStr(formData, "phone"),
    website: optStr(formData, "website"),
    street: optStr(formData, "street"),
    zip: optStr(formData, "zip"),
    city: optStr(formData, "city"),
    country: optStr(formData, "country") ?? "DE",
    currency,
    paymentTerms: optStr(formData, "paymentTerms"),
    customerNumber: optStr(formData, "customerNumber"),
  };
}

export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const name = str(formData, "name");
    if (!name) throw new AppError("Bitte einen Namen für den Großhändler angeben.");

    const code = optStr(formData, "code") ?? (await nextNumber("SUP"));
    const supplier = await db.supplier.create({
      data: { code, name, ...supplierFields(formData) },
    });
    await writeAudit({
      userId: user.id,
      entityType: "SUPPLIER",
      entityId: supplier.id,
      action: "CREATE",
      comment: `Großhändler ${supplier.name} (${supplier.code}) angelegt`,
    });
    return { redirect: `/suppliers/${supplier.id}` };
  });
}

export async function updateSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const before = await db.supplier.findUniqueOrThrow({ where: { id } });
    const data = {
      name: str(formData, "name") || before.name,
      code: str(formData, "code") || before.code,
      ...supplierFields(formData),
    };
    const changes = diffChanges(before as unknown as Record<string, unknown>, data);
    await db.supplier.update({ where: { id }, data });
    if (changes.length > 0) {
      await writeAudit({ userId: user.id, entityType: "SUPPLIER", entityId: id, action: "UPDATE", changes });
    }
    return { redirect: `/suppliers/${id}` };
  });
}

/** Archivieren/Reaktivieren (Soft-Delete über active-Flag). */
export async function archiveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const supplier = await db.supplier.findUniqueOrThrow({ where: { id } });
    if (supplier.active) {
      const openOrders = await db.purchaseOrder.count({
        where: { supplierId: id, status: { notIn: ["RECEIVED", "COMPLETED", "CANCELLED"] } },
      });
      if (openOrders > 0) {
        throw new AppError(
          `Der Großhändler hat noch ${openOrders} offene Bestellung(en) und kann nicht archiviert werden. ` +
            `Bitte die Bestellungen zuerst abschließen oder stornieren.`
        );
      }
    }
    await db.supplier.update({ where: { id }, data: { active: !supplier.active } });
    await writeAudit({
      userId: user.id,
      entityType: "SUPPLIER",
      entityId: id,
      action: "UPDATE",
      changes: [{ field: "active", old: supplier.active, new: !supplier.active }],
      comment: supplier.active ? "Großhändler archiviert" : "Großhändler reaktiviert",
    });
  });
}

/**
 * Aufräum-Aktion (nur Admin): löscht ALLE Großhändler ohne Verknüpfungen
 * endgültig; Großhändler mit Bestellungen/Rechnungen/Mappings werden
 * stattdessen archiviert (Datenintegrität bleibt erhalten).
 */
export async function deleteAllSuppliersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireRole("ADMIN");
    void formData;
    const suppliers = await db.supplier.findMany({
      include: {
        _count: { select: { purchaseOrders: true, productMappings: true, invoices: true } },
      },
    });
    if (suppliers.length === 0) throw new AppError("Es sind keine Großhändler vorhanden.");

    let deleted = 0;
    let archived = 0;
    for (const s of suppliers) {
      const linked = s._count.purchaseOrders + s._count.productMappings + s._count.invoices;
      if (linked === 0) {
        await db.supplier.delete({ where: { id: s.id } });
        deleted++;
      } else if (s.active) {
        await db.supplier.update({ where: { id: s.id }, data: { active: false } });
        archived++;
      }
    }
    await writeAudit({
      userId: admin.id,
      entityType: "SUPPLIER",
      entityId: "ALL",
      action: "DELETE",
      comment: `Großhändler-Liste geleert: ${deleted} gelöscht, ${archived} archiviert (mit Verknüpfungen)`,
    });
  });
}
