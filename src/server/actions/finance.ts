"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit } from "../audit";
import { createInvoice, recordPayment, addCost } from "../services/finance";
import { CURRENCIES, COST_TYPES, COST_ALLOCATION_METHODS } from "@/lib/constants";
import { runAction, str, optStr, optNum, optDate } from "./helpers";
import type { ActionState } from "@/components/form";

export async function createInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const type = str(formData, "type");
    if (type !== "SUPPLIER" && type !== "CUSTOMER") throw new AppError("Ungültiger Rechnungstyp.");
    const currency = str(formData, "currency") || "EUR";
    if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) {
      throw new AppError("Ungültige Währung.");
    }
    const fxRate = currency === "EUR" ? 1.0 : (optNum(formData, "fxRate") ?? 0);
    if (currency !== "EUR" && fxRate <= 0) {
      throw new AppError("Bitte einen gültigen Wechselkurs angeben (EUR pro 1 " + currency + ").");
    }
    const totalCents = optNum(formData, "totalCents");
    if (!totalCents || totalCents <= 0) throw new AppError("Bitte den Bruttobetrag angeben.");

    const invoice = await createInvoice({
      type,
      supplierId: type === "SUPPLIER" ? optStr(formData, "supplierId") : null,
      customerId: type === "CUSTOMER" ? optStr(formData, "customerId") : null,
      purchaseOrderId: optStr(formData, "purchaseOrderId"),
      customerOrderId: optStr(formData, "customerOrderId"),
      externalNumber: optStr(formData, "externalNumber"),
      issuedAt: optDate(formData, "issuedAt") ?? new Date(),
      dueAt: optDate(formData, "dueAt"),
      currency,
      fxRate,
      netCents: optNum(formData, "netCents") ?? 0,
      taxCents: optNum(formData, "taxCents") ?? 0,
      totalCents,
      userId: user.id,
    });
    await writeAudit({
      userId: user.id,
      entityType: "INVOICE",
      entityId: invoice.id,
      action: "CREATE",
      comment: `Rechnung ${invoice.invoiceNumber} erfasst`,
    });
    return { redirect: `/invoices/${invoice.id}` };
  });
}

export async function cancelInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    if (invoice.status === "CANCELLED") throw new AppError("Die Rechnung ist bereits storniert.");
    if (invoice.payments.length > 0) {
      throw new AppError(
        "Die Rechnung hat bereits Zahlungen und kann nicht storniert werden. Bitte zuerst die Zahlungen klären."
      );
    }
    await db.invoice.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit({
      userId: user.id,
      entityType: "INVOICE",
      entityId: id,
      action: "STATUS_CHANGE",
      changes: [{ field: "status", old: invoice.status, new: "CANCELLED" }],
      comment: "Rechnung storniert",
    });
  });
}

export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const invoiceId = optStr(formData, "invoiceId");
    const amountCents = optNum(formData, "amountCents");
    if (!amountCents || amountCents <= 0) throw new AppError("Bitte einen Zahlungsbetrag angeben.");

    let direction = str(formData, "direction");
    if (invoiceId) {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new AppError("Die gewählte Rechnung wurde nicht gefunden.");
      direction = invoice.type === "SUPPLIER" ? "OUTGOING" : "INCOMING";
    }
    if (direction !== "OUTGOING" && direction !== "INCOMING") {
      throw new AppError("Bitte die Zahlungsrichtung wählen.");
    }
    const currency = str(formData, "currency") || "EUR";
    const fxRate = currency === "EUR" ? 1.0 : (optNum(formData, "fxRate") ?? 0);
    if (currency !== "EUR" && fxRate <= 0) throw new AppError("Bitte einen gültigen Wechselkurs angeben.");

    await recordPayment({
      invoiceId,
      direction: direction as "OUTGOING" | "INCOMING",
      amountCents,
      currency,
      fxRate,
      paidAt: optDate(formData, "paidAt") ?? new Date(),
      method: optStr(formData, "method"),
      reference: optStr(formData, "reference"),
      note: optStr(formData, "note"),
      userId: user.id,
    });
  });
}

export async function addCostAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const type = str(formData, "type");
    if (!COST_TYPES.includes(type as (typeof COST_TYPES)[number])) {
      throw new AppError("Ungültiger Kostentyp.");
    }
    const amountCents = optNum(formData, "amountCents");
    if (!amountCents || amountCents <= 0) throw new AppError("Bitte einen Betrag angeben.");
    const currency = str(formData, "currency") || "EUR";
    const fxRate = currency === "EUR" ? 1.0 : (optNum(formData, "fxRate") ?? 0);
    if (currency !== "EUR" && fxRate <= 0) throw new AppError("Bitte einen gültigen Wechselkurs angeben.");
    const allocationMethod = str(formData, "allocationMethod") || "BY_VALUE";
    if (!COST_ALLOCATION_METHODS.includes(allocationMethod as (typeof COST_ALLOCATION_METHODS)[number])) {
      throw new AppError("Ungültige Verteilmethode.");
    }
    await addCost({
      type,
      description: optStr(formData, "description"),
      amountCents,
      currency,
      fxRate,
      allocationMethod,
      purchaseOrderId: optStr(formData, "purchaseOrderId"),
      customerOrderId: optStr(formData, "customerOrderId"),
      incurredAt: optDate(formData, "incurredAt") ?? new Date(),
      userId: user.id,
    });
  });
}
