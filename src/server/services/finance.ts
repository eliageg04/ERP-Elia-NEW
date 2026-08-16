import { db } from "../db";
import { AppError } from "../errors";
import { writeAudit, writeEvent } from "../audit";
import { nextNumber } from "../numbering";
import { toEurCents } from "@/lib/money";
import { recomputeLandedCosts } from "./purchasing";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Rechnungsstatus aus Zahlungen ableiten. */
export async function recomputeInvoiceStatus(tx: Tx, invoiceId: string, userId?: string | null) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (invoice.status === "CANCELLED") return;
  const paidEur = invoice.payments.reduce((a, p) => a + p.amountEurCents, 0);
  let next = "OPEN";
  if (paidEur >= invoice.totalEurCents && invoice.totalEurCents > 0) next = "PAID";
  else if (paidEur > 0) next = "PARTIALLY_PAID";
  if (next !== invoice.status) {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
    await writeAudit(
      {
        userId,
        entityType: "INVOICE",
        entityId: invoiceId,
        action: "STATUS_CHANGE",
        changes: [{ field: "status", old: invoice.status, new: next }],
        comment: "Automatisch aus Zahlungen abgeleitet",
      },
      tx
    );
  }
}

export async function createInvoice(params: {
  type: "SUPPLIER" | "CUSTOMER";
  supplierId?: string | null;
  customerId?: string | null;
  purchaseOrderId?: string | null;
  customerOrderId?: string | null;
  externalNumber?: string | null;
  issuedAt?: Date;
  dueAt?: Date | null;
  currency?: string;
  fxRate?: number;
  netCents?: number;
  taxCents?: number;
  totalCents: number;
  lines?: Array<{
    productId?: string | null;
    poLineId?: string | null;
    description: string;
    qty?: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  userId?: string | null;
}) {
  if (params.type === "SUPPLIER" && !params.supplierId)
    throw new AppError("Für eine Eingangsrechnung muss ein Lieferant angegeben werden.");
  if (params.type === "CUSTOMER" && !params.customerId)
    throw new AppError("Für eine Ausgangsrechnung muss ein Kunde angegeben werden.");
  if (params.totalCents <= 0) throw new AppError("Der Rechnungsbetrag muss größer als 0 sein.");

  // Duplikaterkennung: gleiche externe Nummer beim gleichen Lieferanten
  if (params.externalNumber && params.supplierId) {
    const dupe = await db.invoice.findFirst({
      where: {
        externalNumber: params.externalNumber,
        supplierId: params.supplierId,
        status: { not: "CANCELLED" },
      },
    });
    if (dupe) {
      throw new AppError(
        `Rechnung ${params.externalNumber} dieses Lieferanten existiert bereits (${dupe.invoiceNumber}).`
      );
    }
  }

  return db.$transaction(async (tx) => {
    const fxRate = params.fxRate ?? 1.0;
    const invoiceNumber = await nextNumber("RE", tx);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        externalNumber: params.externalNumber ?? null,
        type: params.type,
        supplierId: params.supplierId ?? null,
        customerId: params.customerId ?? null,
        purchaseOrderId: params.purchaseOrderId ?? null,
        customerOrderId: params.customerOrderId ?? null,
        issuedAt: params.issuedAt ?? new Date(),
        dueAt: params.dueAt ?? null,
        currency: params.currency ?? "EUR",
        fxRate,
        netCents: params.netCents ?? 0,
        taxCents: params.taxCents ?? 0,
        totalCents: params.totalCents,
        totalEurCents: toEurCents(params.totalCents, fxRate),
        lines: params.lines
          ? {
              create: params.lines.map((l) => ({
                productId: l.productId ?? null,
                poLineId: l.poLineId ?? null,
                description: l.description,
                qty: l.qty ?? 1,
                unitPriceCents: l.unitPriceCents,
                totalCents: l.totalCents,
              })),
            }
          : undefined,
      },
    });
    await writeEvent(
      {
        type: "INVOICE_CREATED",
        entityType: "INVOICE",
        entityId: invoice.id,
        summary: `Rechnung ${invoiceNumber} erfasst`,
        userId: params.userId,
      },
      tx
    );
    return invoice;
  });
}

export async function recordPayment(params: {
  invoiceId?: string | null;
  direction: "OUTGOING" | "INCOMING";
  amountCents: number;
  currency?: string;
  fxRate?: number;
  paidAt?: Date;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  userId?: string | null;
}) {
  if (params.amountCents <= 0) throw new AppError("Der Zahlungsbetrag muss größer als 0 sein.");
  return db.$transaction(async (tx) => {
    const fxRate = params.fxRate ?? 1.0;
    const payment = await tx.payment.create({
      data: {
        invoiceId: params.invoiceId ?? null,
        direction: params.direction,
        amountCents: params.amountCents,
        currency: params.currency ?? "EUR",
        fxRate,
        amountEurCents: toEurCents(params.amountCents, fxRate),
        paidAt: params.paidAt ?? new Date(),
        method: params.method ?? null,
        reference: params.reference ?? null,
        note: params.note ?? null,
      },
    });
    if (params.invoiceId) {
      await recomputeInvoiceStatus(tx, params.invoiceId, params.userId);
      const invoice = await tx.invoice.findUnique({ where: { id: params.invoiceId } });
      await writeEvent(
        {
          type: "PAYMENT_RECEIVED",
          entityType: "INVOICE",
          entityId: params.invoiceId,
          summary: `Zahlung über ${(payment.amountEurCents / 100).toFixed(2)} € zu ${invoice?.invoiceNumber ?? "Rechnung"}`,
          userId: params.userId,
        },
        tx
      );
    }
    return payment;
  });
}

/** Nebenkosten erfassen und – falls einer Bestellung zugeordnet – Landed Costs aktualisieren. */
export async function addCost(params: {
  type: string;
  description?: string | null;
  amountCents: number;
  currency?: string;
  fxRate?: number;
  allocationMethod?: string;
  purchaseOrderId?: string | null;
  customerOrderId?: string | null;
  invoiceId?: string | null;
  incurredAt?: Date;
  userId?: string | null;
}) {
  if (params.amountCents <= 0) throw new AppError("Der Betrag muss größer als 0 sein.");
  return db.$transaction(async (tx) => {
    const fxRate = params.fxRate ?? 1.0;
    const cost = await tx.cost.create({
      data: {
        type: params.type,
        description: params.description ?? null,
        amountCents: params.amountCents,
        currency: params.currency ?? "EUR",
        fxRate,
        amountEurCents: toEurCents(params.amountCents, fxRate),
        allocationMethod: params.allocationMethod ?? "BY_VALUE",
        purchaseOrderId: params.purchaseOrderId ?? null,
        customerOrderId: params.customerOrderId ?? null,
        invoiceId: params.invoiceId ?? null,
        incurredAt: params.incurredAt ?? new Date(),
      },
    });
    if (params.purchaseOrderId) {
      await recomputeLandedCosts(tx, params.purchaseOrderId);
      await writeEvent(
        {
          type: "COST_ADDED",
          entityType: "PURCHASE_ORDER",
          entityId: params.purchaseOrderId,
          summary: `Nebenkosten erfasst: ${(cost.amountEurCents / 100).toFixed(2)} € (${params.type}) – Einstandspreise aktualisiert`,
          userId: params.userId,
        },
        tx
      );
    }
    return cost;
  });
}
