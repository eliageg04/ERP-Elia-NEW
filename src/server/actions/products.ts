"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, diffChanges } from "../audit";
import { nextNumber } from "../numbering";
import { postInbound, postOutbound, getStock } from "../services/inventory";
import { runAction, str, optStr, num, optNum } from "./helpers";
import type { ActionState } from "@/components/form";

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const name = str(formData, "name");
    if (!name) throw new AppError("Bitte einen Produktnamen angeben.");
    const baseUnitId = str(formData, "baseUnitId");
    if (!baseUnitId) throw new AppError("Bitte eine Basiseinheit wählen.");

    const skuInput = optStr(formData, "sku");
    const sku = skuInput ?? (await nextNumber("PRD"));
    const product = await db.product.create({
      data: {
        sku,
        name,
        productType: optStr(formData, "productType"),
        setName: optStr(formData, "setName"),
        language: optStr(formData, "language") ?? "EN",
        edition: optStr(formData, "edition"),
        ean: optStr(formData, "ean"),
        manufacturer: optStr(formData, "manufacturer"),
        baseUnitId,
        listPriceCents: optNum(formData, "listPriceCents"),
      },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PRODUCT",
      entityId: product.id,
      action: "CREATE",
      comment: `Produkt ${product.name} angelegt`,
    });
    return { redirect: `/products/${product.id}` };
  });
}

export async function updateProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const before = await db.product.findUniqueOrThrow({ where: { id } });
    const data = {
      name: str(formData, "name") || before.name,
      sku: str(formData, "sku") || before.sku,
      productType: optStr(formData, "productType"),
      setName: optStr(formData, "setName"),
      language: optStr(formData, "language"),
      edition: optStr(formData, "edition"),
      ean: optStr(formData, "ean"),
      manufacturer: optStr(formData, "manufacturer"),
      listPriceCents: optNum(formData, "listPriceCents"),
    };
    const changes = diffChanges(before as unknown as Record<string, unknown>, data);
    await db.product.update({ where: { id }, data });
    if (changes.length > 0) {
      await writeAudit({ userId: user.id, entityType: "PRODUCT", entityId: id, action: "UPDATE", changes });
    }
    return { redirect: `/products/${id}` };
  });
}

export async function archiveProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const product = await db.product.findUniqueOrThrow({ where: { id } });
    const stock = await getStock(id);
    if (stock.onHand > 0) {
      throw new AppError(
        `Das Produkt hat noch ${stock.onHand} Einheiten Bestand und kann nicht archiviert werden. ` +
          `Bitte zuerst den Bestand korrigieren.`
      );
    }
    await db.product.update({ where: { id }, data: { active: !product.active } });
    await writeAudit({
      userId: user.id,
      entityType: "PRODUCT",
      entityId: id,
      action: "UPDATE",
      changes: [{ field: "active", old: product.active, new: !product.active }],
      comment: product.active ? "Produkt archiviert" : "Produkt reaktiviert",
    });
  });
}

/** Einheiten-Umrechnung anlegen/ändern (z.B. 1 Case = 6 Displays). */
export async function upsertConversionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const productId = str(formData, "productId");
    const unitId = str(formData, "unitId");
    const factor = Math.round(num(formData, "factor"));
    if (factor <= 0) throw new AppError("Der Umrechnungsfaktor muss größer als 0 sein.");
    const existing = await db.unitConversion.findUnique({
      where: { productId_unitId: { productId, unitId } },
    });
    await db.unitConversion.upsert({
      where: { productId_unitId: { productId, unitId } },
      create: { productId, unitId, factor },
      update: { factor },
    });
    await writeAudit({
      userId: user.id,
      entityType: "PRODUCT",
      entityId: productId,
      action: existing ? "CORRECTION" : "CREATE",
      changes: [{ field: "unitFactor", old: existing?.factor ?? null, new: factor }],
      comment: "Einheiten-Umrechnung gespeichert",
    });
  });
}

export async function deleteConversionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const conversion = await db.unitConversion.findUniqueOrThrow({ where: { id }, include: { unit: true } });
    await db.unitConversion.delete({ where: { id } });
    await writeAudit({
      userId: user.id,
      entityType: "PRODUCT",
      entityId: conversion.productId,
      action: "DELETE",
      comment: `Umrechnung für ${conversion.unit.name} entfernt`,
    });
  });
}

/** Manuelle Bestandskorrektur (+/−) mit Pflicht-Begründung. */
export async function stockCorrectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const productId = str(formData, "productId");
    const qty = Math.round(num(formData, "qty"));
    const reason = str(formData, "reason");
    const type = str(formData, "type") || "CORRECTION";
    if (qty === 0) throw new AppError("Die Korrekturmenge darf nicht 0 sein.");
    if (!reason) throw new AppError("Bitte eine Begründung angeben – Korrekturen müssen nachvollziehbar sein.");
    if (!["CORRECTION", "DAMAGE", "LOSS", "RETURN", "ADJUSTMENT"].includes(type)) {
      throw new AppError("Ungültiger Korrekturtyp.");
    }
    const unitCost = optNum(formData, "unitCostCents");

    await db.$transaction(async (tx) => {
      if (qty > 0) {
        await postInbound(tx, {
          productId,
          qty,
          type: type === "RETURN" ? "RETURN" : "CORRECTION",
          unitCostEurCents: unitCost,
          refType: "MANUAL",
          note: reason,
          userId: user.id,
        });
      } else {
        await postOutbound(tx, {
          productId,
          qty: -qty,
          type: type === "DAMAGE" ? "DAMAGE" : type === "LOSS" ? "LOSS" : "CORRECTION",
          refType: "MANUAL",
          note: reason,
          userId: user.id,
        });
      }
      await writeAudit(
        {
          userId: user.id,
          entityType: "PRODUCT",
          entityId: productId,
          action: "CORRECTION",
          changes: [{ field: "qty", old: null, new: qty }],
          comment: reason,
        },
        tx
      );
    });
  });
}
