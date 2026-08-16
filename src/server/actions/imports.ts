"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, writeEvent } from "../audit";
import { nextNumber } from "../numbering";
import { createImportBatch } from "../services/importing";
import { learnSupplierMapping } from "../services/matching";
import { IMPORT_KINDS } from "@/lib/constants";
import { runAction, str, optStr, optNum } from "./helpers";
import type { ActionState } from "@/components/form";
import type { Prisma } from "@prisma/client";

export async function uploadImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Bitte eine Datei auswählen.");
    }
    if (file.size > 10 * 1024 * 1024) throw new AppError("Die Datei ist zu groß (max. 10 MB).");
    const kind = str(formData, "kind");
    if (!IMPORT_KINDS.includes(kind as (typeof IMPORT_KINDS)[number])) {
      throw new AppError("Bitte die Art des Imports wählen.");
    }
    const name = file.name.toLowerCase();
    let source: "CSV" | "XLSX";
    if (name.endsWith(".csv") || name.endsWith(".txt")) source = "CSV";
    else if (name.endsWith(".xlsx") || name.endsWith(".xls")) source = "XLSX";
    else {
      throw new AppError(
        "Dieses Format wird noch nicht unterstützt. Bitte CSV- oder Excel-Export verwenden – " +
          "PDF-/OCR-Import ist als nächste Ausbaustufe vorgesehen."
      );
    }
    const supplierId = optStr(formData, "supplierId");
    const batch = await createImportBatch({
      source,
      kind,
      filename: file.name,
      content: Buffer.from(await file.arrayBuffer()),
      supplierId,
      userId: user.id,
    });
    // Lieferant des Batches merken (für Entwurfs-PO und Mapping-Lernen im Review)
    if (supplierId) {
      await db.setting.upsert({
        where: { key: `importSupplier:${batch.id}` },
        create: { key: `importSupplier:${batch.id}`, value: JSON.stringify(supplierId) },
        update: { value: JSON.stringify(supplierId) },
      });
    }
    await writeAudit({
      userId: user.id,
      entityType: "IMPORT_BATCH",
      entityId: batch.id,
      action: "IMPORT",
      comment: `Datei ${file.name} importiert (${batch.summary})`,
    });
    return { redirect: `/imports/${batch.id}` };
  });
}

/** Produktzuordnung eines Import-Items manuell setzen (System lernt Mapping). */
export async function setItemProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const itemId = str(formData, "itemId");
    const productId = optStr(formData, "productId");
    const item = await db.importItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true } });
    if (item.status !== "PENDING" && item.status !== "EDITED") {
      throw new AppError("Diese Position wurde bereits abgeschlossen.");
    }
    await db.importItem.update({
      where: { id: itemId },
      data: { matchedProductId: productId, status: "EDITED", confidence: productId ? 100 : item.confidence },
    });
    // Lernen: Lieferanten-Bezeichnung → Produkt
    const parsed = item.parsed ? (JSON.parse(item.parsed) as Record<string, unknown>) : {};
    const supplierName = typeof parsed.productName === "string" ? parsed.productName : null;
    const batchSupplierId = str(formData, "supplierId") || null;
    if (productId && supplierName && batchSupplierId) {
      await learnSupplierMapping({
        supplierId: batchSupplierId,
        productId,
        supplierName,
        supplierSku: typeof parsed.sku === "string" ? parsed.sku : null,
      });
    }
    await writeAudit({
      userId: user.id,
      entityType: "IMPORT_ITEM",
      entityId: itemId,
      action: "CORRECTION",
      changes: [{ field: "matchedProductId", old: item.matchedProductId, new: productId }],
      comment: "Produktzuordnung manuell gesetzt",
    });
  });
}

async function acceptSingleItem(
  tx: Prisma.TransactionClient,
  params: {
    itemId: string;
    productId: string;
    qty: number;
    unitPriceCents: number;
    userId: string;
  }
) {
  const item = await tx.importItem.findUniqueOrThrow({
    where: { id: params.itemId },
    include: { batch: true },
  });
  if (item.status === "ACCEPTED" || item.status === "DISCARDED") {
    throw new AppError("Diese Position wurde bereits abgeschlossen.");
  }
  const batch = item.batch;
  const product = await tx.product.findUniqueOrThrow({ where: { id: params.productId } });

  let resultRefType: string;
  let resultRefId: string;

  if (batch.kind === "SUPPLIER_INVOICE" || batch.kind === "PURCHASE_ORDER") {
    // Ein Entwurfs-PO je Batch: erkennbar über supplierOrderNumber = IMPORT-<batchId>
    const batchSupplierId = await resolveBatchSupplier(tx, batch.id);
    if (!batchSupplierId) {
      throw new AppError("Bitte beim Upload einen Lieferanten wählen, damit eine Entwurfs-Bestellung angelegt werden kann.");
    }
    let po = await tx.purchaseOrder.findFirst({
      where: { supplierOrderNumber: `IMPORT-${batch.id}` },
    });
    if (!po) {
      po = await tx.purchaseOrder.create({
        data: {
          orderNumber: await nextNumber("PO", tx),
          supplierId: batchSupplierId,
          supplierOrderNumber: `IMPORT-${batch.id}`,
          status: "DRAFT",
        },
      });
      await writeEvent(
        {
          type: "PURCHASE_ORDER_CREATED",
          entityType: "PURCHASE_ORDER",
          entityId: po.id,
          summary: `Entwurfs-Bestellung ${po.orderNumber} aus Import ${batch.filename ?? ""} erstellt`,
          userId: params.userId,
        },
        tx
      );
    }
    const position = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: po.id } });
    await tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId: po.id,
        productId: product.id,
        position,
        enteredQty: params.qty,
        enteredUnitId: product.baseUnitId,
        unitFactor: 1,
        qtyOrdered: params.qty,
        unitPriceCents: params.unitPriceCents,
        lineTotalCents: params.qty * params.unitPriceCents,
      },
    });
    resultRefType = "PURCHASE_ORDER";
    resultRefId = po.id;

    // Mapping lernen
    const parsed = item.parsed ? (JSON.parse(item.parsed) as Record<string, unknown>) : {};
    if (typeof parsed.productName === "string") {
      await tx.supplierProductMapping.upsert({
        where: {
          supplierId_supplierName: { supplierId: batchSupplierId, supplierName: parsed.productName.trim() },
        },
        create: {
          supplierId: batchSupplierId,
          productId: product.id,
          supplierName: parsed.productName.trim(),
          supplierSku: typeof parsed.sku === "string" ? parsed.sku.trim() : null,
          lastPriceCents: params.unitPriceCents,
        },
        update: { productId: product.id, lastPriceCents: params.unitPriceCents },
      });
    }
  } else if (batch.kind === "PRODUCTS") {
    // Produktimport: das Item WURDE bereits einem Produkt zugeordnet → nichts anlegen
    resultRefType = "PRODUCT";
    resultRefId = product.id;
  } else {
    throw new AppError(
      "Dieser Import-Typ wird über die Übernahme-Funktion nicht unterstützt. " +
        "Bestandsänderungen bitte als Bestandskorrektur am Produkt buchen."
    );
  }

  await tx.importItem.update({
    where: { id: item.id },
    data: { status: "ACCEPTED", resultRefType, resultRefId },
  });
  await writeAudit(
    {
      userId: params.userId,
      entityType: "IMPORT_ITEM",
      entityId: item.id,
      action: "IMPORT",
      comment: `Übernommen: ${params.qty} × ${product.name} zu ${(params.unitPriceCents / 100).toFixed(2).replace(".", ",")} €`,
    },
    tx
  );

  // Batch abschließen, wenn keine offenen Positionen mehr
  const pending = await tx.importItem.count({
    where: { batchId: batch.id, status: { in: ["PENDING", "EDITED"] } },
  });
  if (pending === 0) {
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMPLETED", processedAt: new Date() },
    });
  }
  return { resultRefType, resultRefId };
}

/** Lieferant eines Batches: aus Upload-Auswahl (im Batch-Summary nicht gespeichert) → über Formular. */
async function resolveBatchSupplier(tx: Prisma.TransactionClient, batchId: string): Promise<string | null> {
  // Der Lieferant wird beim Accept aus dem Formular übergeben und hier zwischengespeichert:
  const setting = await tx.setting.findUnique({ where: { key: `importSupplier:${batchId}` } });
  return setting ? (JSON.parse(setting.value) as string) : null;
}

export async function acceptItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const itemId = str(formData, "itemId");
    const productId = optStr(formData, "productId");
    if (!productId) throw new AppError("Bitte zuerst ein Produkt zuordnen.");
    const qty = Math.round(optNum(formData, "qty") ?? 0);
    if (qty <= 0) throw new AppError("Bitte eine gültige Menge angeben.");
    const unitPriceCents = optNum(formData, "unitPriceCents") ?? 0;
    if (unitPriceCents < 0) throw new AppError("Ungültiger Preis.");
    const supplierId = optStr(formData, "supplierId");

    await db.$transaction(async (tx) => {
      if (supplierId) {
        const item = await tx.importItem.findUniqueOrThrow({ where: { id: itemId } });
        await tx.setting.upsert({
          where: { key: `importSupplier:${item.batchId}` },
          create: { key: `importSupplier:${item.batchId}`, value: JSON.stringify(supplierId) },
          update: { value: JSON.stringify(supplierId) },
        });
      }
      await acceptSingleItem(tx, { itemId, productId, qty, unitPriceCents, userId: user.id });
    });
  });
}

export async function acceptAllConfidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const batchId = str(formData, "batchId");
    const supplierId = optStr(formData, "supplierId");
    const items = await db.importItem.findMany({
      where: { batchId, status: { in: ["PENDING", "EDITED"] }, confidence: { gte: 90 }, matchedProductId: { not: null } },
    });
    if (items.length === 0) {
      throw new AppError("Keine Positionen mit ausreichender Sicherheit (≥ 90 %) und Produktzuordnung vorhanden.");
    }
    let accepted = 0;
    for (const item of items) {
      const parsed = item.parsed ? (JSON.parse(item.parsed) as Record<string, unknown>) : {};
      const qty = typeof parsed.qtyParsed === "number" ? parsed.qtyParsed : null;
      const price =
        typeof parsed.unitPriceCentsParsed === "number"
          ? parsed.unitPriceCentsParsed
          : typeof parsed.totalPriceCentsParsed === "number" && qty
            ? Math.round(parsed.totalPriceCentsParsed / qty)
            : null;
      if (!qty || price === null) continue;
      await db.$transaction(async (tx) => {
        if (supplierId) {
          await tx.setting.upsert({
            where: { key: `importSupplier:${batchId}` },
            create: { key: `importSupplier:${batchId}`, value: JSON.stringify(supplierId) },
            update: { value: JSON.stringify(supplierId) },
          });
        }
        await acceptSingleItem(tx, {
          itemId: item.id,
          productId: item.matchedProductId!,
          qty,
          unitPriceCents: price,
          userId: user.id,
        });
      });
      accepted++;
    }
    if (accepted === 0) {
      throw new AppError("Keine Position konnte automatisch übernommen werden (Menge oder Preis fehlt). Bitte manuell prüfen.");
    }
  });
}

export async function discardItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const itemId = str(formData, "itemId");
    const item = await db.importItem.findUniqueOrThrow({ where: { id: itemId } });
    if (item.status === "ACCEPTED") throw new AppError("Bereits übernommene Positionen können nicht verworfen werden.");
    await db.importItem.update({ where: { id: itemId }, data: { status: "DISCARDED" } });
    const pending = await db.importItem.count({
      where: { batchId: item.batchId, status: { in: ["PENDING", "EDITED"] } },
    });
    if (pending === 0) {
      await db.importBatch.update({
        where: { id: item.batchId },
        data: { status: "COMPLETED", processedAt: new Date() },
      });
    }
    await writeAudit({
      userId: user.id,
      entityType: "IMPORT_ITEM",
      entityId: itemId,
      action: "UPDATE",
      comment: "Position verworfen",
    });
  });
}

export async function discardBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const batchId = str(formData, "batchId");
    await db.importItem.updateMany({
      where: { batchId, status: { in: ["PENDING", "EDITED"] } },
      data: { status: "DISCARDED" },
    });
    await db.importBatch.update({
      where: { id: batchId },
      data: { status: "DISCARDED", processedAt: new Date() },
    });
    await writeAudit({
      userId: user.id,
      entityType: "IMPORT_BATCH",
      entityId: batchId,
      action: "UPDATE",
      comment: "Batch verworfen",
    });
    return { redirect: "/imports" };
  });
}
