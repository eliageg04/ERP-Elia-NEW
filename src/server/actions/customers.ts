"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, diffChanges } from "../audit";
import { nextNumber } from "../numbering";
import { runAction, str, optStr } from "./helpers";
import type { ActionState } from "@/components/form";

/** Gemeinsame Formularfelder (ohne Name/Code) auslesen. */
function customerFields(formData: FormData) {
  return {
    company: optStr(formData, "company"),
    email: optStr(formData, "email"),
    phone: optStr(formData, "phone"),
    billingStreet: optStr(formData, "billingStreet"),
    billingZip: optStr(formData, "billingZip"),
    billingCity: optStr(formData, "billingCity"),
    billingCountry: optStr(formData, "billingCountry") ?? "DE",
    shippingStreet: optStr(formData, "shippingStreet"),
    shippingZip: optStr(formData, "shippingZip"),
    shippingCity: optStr(formData, "shippingCity"),
    shippingCountry: optStr(formData, "shippingCountry") ?? "DE",
  };
}

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const name = str(formData, "name");
    if (!name) throw new AppError("Bitte einen Kundennamen angeben.");

    const code = optStr(formData, "code") ?? (await nextNumber("KND"));
    const customer = await db.customer.create({
      data: { code, name, ...customerFields(formData) },
    });
    await writeAudit({
      userId: user.id,
      entityType: "CUSTOMER",
      entityId: customer.id,
      action: "CREATE",
      comment: `Kunde ${customer.name} (${customer.code}) angelegt`,
    });
    return { redirect: `/customers/${customer.id}` };
  });
}

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const before = await db.customer.findUniqueOrThrow({ where: { id } });
    const data = {
      name: str(formData, "name") || before.name,
      code: str(formData, "code") || before.code,
      ...customerFields(formData),
    };
    const changes = diffChanges(before as unknown as Record<string, unknown>, data);
    await db.customer.update({ where: { id }, data });
    if (changes.length > 0) {
      await writeAudit({ userId: user.id, entityType: "CUSTOMER", entityId: id, action: "UPDATE", changes });
    }
    return { redirect: `/customers/${id}` };
  });
}

/** Archivieren/Reaktivieren (Soft-Delete über active-Flag). */
export async function archiveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const customer = await db.customer.findUniqueOrThrow({ where: { id } });
    if (customer.active) {
      const openOrders = await db.customerOrder.count({
        where: { customerId: id, status: { notIn: ["DELIVERED", "COMPLETED", "CANCELLED"] } },
      });
      if (openOrders > 0) {
        throw new AppError(
          `Der Kunde hat noch ${openOrders} offene Bestellung(en) und kann nicht archiviert werden. ` +
            `Bitte die Bestellungen zuerst abschließen oder stornieren.`
        );
      }
    }
    await db.customer.update({ where: { id }, data: { active: !customer.active } });
    await writeAudit({
      userId: user.id,
      entityType: "CUSTOMER",
      entityId: id,
      action: "UPDATE",
      changes: [{ field: "active", old: customer.active, new: !customer.active }],
      comment: customer.active ? "Kunde archiviert" : "Kunde reaktiviert",
    });
  });
}
