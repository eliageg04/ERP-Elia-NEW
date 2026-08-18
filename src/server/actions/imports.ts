"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, writeEvent } from "../audit";
import { nextNumber } from "../numbering";
import { createImportBatch, sha256 } from "../services/importing";
import { learnSupplierMapping, matchProduct, similarity } from "../services/matching";
import { extractInvoiceFromPdf } from "../services/pdf-extract";
import { uploadVoucherToLexware, getLexwareConfig } from "../services/lexware";
import { postInbound } from "../services/inventory";
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

    // PDF-Rechnung: KI-Erkennung + optional Weitergabe an Lexware
    if (name.endsWith(".pdf")) {
      if (file.size > 4 * 1024 * 1024) {
        throw new AppError("PDF zu groß (max. 4 MB auf Vercel). Bitte die Rechnung verkleinern.");
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const batchId = await importPdfInvoice({
        buffer,
        filename: file.name,
        supplierId: optStr(formData, "supplierId"),
        sendToLexware: formData.get("sendToLexware") === "on",
        userId: user.id,
      });
      return { redirect: `/imports/${batchId}` };
    }

    let source: "CSV" | "XLSX";
    if (name.endsWith(".csv") || name.endsWith(".txt")) source = "CSV";
    else if (name.endsWith(".xlsx") || name.endsWith(".xls")) source = "XLSX";
    else {
      throw new AppError("Dieses Format wird nicht unterstützt. Bitte PDF, CSV oder Excel hochladen.");
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

/** PDF-Rechnung: KI-Extraktion → Inbox-Positionen; optional Beleg an Lexware weitergeben. */
async function importPdfInvoice(params: {
  buffer: Buffer;
  filename: string;
  supplierId: string | null;
  sendToLexware: boolean;
  userId: string;
}): Promise<string> {
  const hash = sha256(params.buffer);
  const existing = await db.importBatch.findFirst({
    where: { contentHash: hash, status: { not: "DISCARDED" } },
  });
  if (existing) {
    throw new AppError(
      `Diese PDF wurde bereits importiert (${existing.createdAt.toLocaleDateString("de-DE")}). Duplikat verhindert.`
    );
  }

  const invoice = await extractInvoiceFromPdf(params.buffer);

  // Lieferant: explizite Auswahl > Namenserkennung aus der Rechnung
  let supplierId = params.supplierId;
  let supplierNote = "";
  if (!supplierId && invoice.supplierName) {
    const suppliers = await db.supplier.findMany({ where: { active: true } });
    let best: (typeof suppliers)[number] | null = null;
    let bestScore = 0;
    for (const s of suppliers) {
      const score = similarity(invoice.supplierName, s.name);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best && bestScore >= 0.55) {
      supplierId = best.id;
      supplierNote = `Lieferant erkannt: ${best.name}`;
    } else {
      supplierNote = `Lieferant „${invoice.supplierName}" nicht im System – bitte anlegen oder beim Übernehmen wählen`;
    }
  }

  // Duplikat auf Belegebene: gleiche Rechnungsnummer bereits importiert?
  if (invoice.invoiceNumber) {
    const dupe = await db.importItem.findFirst({
      where: {
        parsed: { contains: `"invoiceNumber":"${invoice.invoiceNumber}"` },
        status: { not: "DISCARDED" },
      },
    });
    if (dupe) {
      throw new AppError(
        `Eine Rechnung mit der Nummer ${invoice.invoiceNumber} wurde bereits importiert. Duplikat verhindert.`
      );
    }
  }

  const currency = (invoice.currency ?? "EUR").toUpperCase();
  const toCents = (v: number | null) => (v === null ? null : Math.round(v * 100));

  // Optional: Beleg an Lexware weitergeben (nicht blockierend)
  let lexwareInfo = "";
  if (params.sendToLexware) {
    if (await getLexwareConfig()) {
      const result = await uploadVoucherToLexware(params.buffer, params.filename);
      lexwareInfo = result.ok ? " · an Lexware übergeben" : ` · Lexware: ${result.error}`;
    } else {
      lexwareInfo = " · Lexware nicht konfiguriert";
    }
  }

  const batch = await db.importBatch.create({
    data: {
      source: "PDF",
      kind: "SUPPLIER_INVOICE",
      filename: params.filename,
      contentHash: hash,
      status: "REVIEW",
      summary:
        [
          invoice.supplierName ?? "Lieferant unbekannt",
          invoice.invoiceNumber ? `RE ${invoice.invoiceNumber}` : null,
          invoice.invoiceDate,
          invoice.totalGross !== null ? `${invoice.totalGross.toFixed(2).replace(".", ",")} ${currency}` : null,
          `${invoice.items.length} Positionen (KI-Erkennung)`,
        ]
          .filter(Boolean)
          .join(" · ") + lexwareInfo,
      createdById: params.userId,
    },
  });

  for (let i = 0; i < invoice.items.length; i++) {
    const item = invoice.items[i];
    const qty = Math.round(item.quantity);
    const unitPriceCents =
      toCents(item.unitPrice) ??
      (item.totalPrice !== null && qty > 0 ? Math.round((item.totalPrice * 100) / qty) : null);
    const match = await matchProduct({ name: item.description, sku: item.sku, supplierId });
    let confidence = match.productId ? match.confidence : Math.min(match.confidence, 40);
    if (qty <= 0) confidence = Math.min(confidence, 50);
    if (unitPriceCents === null) confidence = Math.min(confidence, 60);

    await db.importItem.create({
      data: {
        batchId: batch.id,
        rowIndex: i,
        raw: JSON.stringify({
          Artikel: item.description,
          "Art-Nr": item.sku ?? "–",
          Menge: `${item.quantity}${item.unit ? " " + item.unit : ""}`,
          Einzelpreis: item.unitPrice !== null ? item.unitPrice.toFixed(2).replace(".", ",") + " " + currency : "–",
        }),
        parsed: JSON.stringify({
          productName: item.description,
          sku: item.sku,
          qty: String(item.quantity),
          unit: item.unit,
          qtyParsed: qty > 0 ? qty : null,
          unitPriceCentsParsed: unitPriceCents,
          totalPriceCentsParsed: toCents(item.totalPrice),
          invoiceNumber: invoice.invoiceNumber,
          currency,
          matchMethod: match.method + (supplierNote ? ` · ${supplierNote}` : ""),
          candidates: match.candidates,
        }),
        confidence,
        status: "PENDING",
        matchedProductId: match.productId,
        note: currency !== "EUR" ? `Achtung: Rechnungswährung ${currency}` : null,
      },
    });
  }

  if (supplierId) {
    await db.setting.upsert({
      where: { key: `importSupplier:${batch.id}` },
      create: { key: `importSupplier:${batch.id}`, value: JSON.stringify(supplierId) },
      update: { value: JSON.stringify(supplierId) },
    });
  }
  await writeAudit({
    userId: params.userId,
    entityType: "IMPORT_BATCH",
    entityId: batch.id,
    action: "IMPORT",
    comment: `PDF ${params.filename} per KI ausgelesen (${invoice.items.length} Positionen)${lexwareInfo}`,
  });
  await writeEvent({
    type: "PDF_INVOICE_IMPORTED",
    entityType: "IMPORT_BATCH",
    entityId: batch.id,
    summary: `Rechnung ${invoice.invoiceNumber ?? params.filename} per KI ausgelesen (${invoice.items.length} Positionen)`,
    userId: params.userId,
  });
  return batch.id;
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

/** Produkt aus Import-Daten finden oder neu anlegen (Basiseinheit: Stück). */
async function ensureProduct(
  tx: Prisma.TransactionClient,
  parsed: Record<string, unknown>,
  productId: string | null
) {
  if (productId) {
    return tx.product.findUniqueOrThrow({ where: { id: productId } });
  }
  const name = typeof parsed.productName === "string" ? parsed.productName.trim() : "";
  if (!name) throw new AppError("Kein Produktname vorhanden – bitte ein Produkt zuordnen.");
  // Duplikatschutz: exakt gleicher Name → vorhandenes Produkt verwenden
  const existing = await tx.product.findFirst({ where: { name } });
  if (existing) return existing;
  const pieceUnit = await tx.unit.findFirst({ where: { code: "PIECE" } });
  if (!pieceUnit) throw new AppError("Systemeinheit „Stück“ fehlt – bitte Einstellungen → Einheiten prüfen.");
  return tx.product.create({
    data: {
      sku: await nextNumber("PRD", tx),
      name,
      ean: typeof parsed.ean === "string" && parsed.ean ? parsed.ean : null,
      setName: typeof parsed.setName === "string" && parsed.setName ? parsed.setName : null,
      baseUnitId: pieceUnit.id,
    },
  });
}

async function acceptSingleItem(
  tx: Prisma.TransactionClient,
  params: {
    itemId: string;
    productId: string | null;
    qty: number | null;
    unitPriceCents: number | null;
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
  const parsedData = item.parsed ? (JSON.parse(item.parsed) as Record<string, unknown>) : {};
  const rawData = item.raw ? (JSON.parse(item.raw) as Record<string, string>) : {};
  const field = (key: string): string | null => {
    const v = parsedData[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const contactName = field("productName") ?? field("company") ?? (Object.values(rawData)[0]?.trim() || null);

  let resultRefType: string;
  let resultRefId: string;
  let auditComment: string;

  if (batch.kind === "CUSTOMERS") {
    if (!contactName) throw new AppError("Kein Kundenname in dieser Zeile erkennbar.");
    const existing = await tx.customer.findFirst({ where: { name: contactName } });
    const customer =
      existing ??
      (await tx.customer.create({
        data: {
          code: await nextNumber("KND", tx),
          name: contactName,
          company: field("company"),
          email: field("email"),
          phone: field("phone"),
          billingStreet: field("street"),
          billingZip: field("zip"),
          billingCity: field("city"),
          shippingStreet: field("street"),
          shippingZip: field("zip"),
          shippingCity: field("city"),
        },
      }));
    resultRefType = "CUSTOMER";
    resultRefId = customer.id;
    auditComment = existing
      ? `Kunde „${contactName}“ existierte bereits – verknüpft`
      : `Kunde „${contactName}“ angelegt`;
  } else if (batch.kind === "SUPPLIERS") {
    if (!contactName) throw new AppError("Kein Lieferantenname in dieser Zeile erkennbar.");
    const existing = await tx.supplier.findFirst({ where: { name: contactName } });
    const supplier =
      existing ??
      (await tx.supplier.create({
        data: {
          code: await nextNumber("SUP", tx),
          name: contactName,
          email: field("email"),
          phone: field("phone"),
          street: field("street"),
          zip: field("zip"),
          city: field("city"),
        },
      }));
    resultRefType = "SUPPLIER";
    resultRefId = supplier.id;
    auditComment = existing
      ? `Lieferant „${contactName}“ existierte bereits – verknüpft`
      : `Lieferant „${contactName}“ angelegt`;
  } else if (batch.kind === "OPENING_STOCK") {
    const qty = params.qty ?? 0;
    if (qty <= 0) throw new AppError("Bitte die Bestandsmenge angeben.");
    if (params.unitPriceCents === null) {
      throw new AppError("Bitte den Einkaufspreis (gewichteter Durchschnitt) angeben – er bestimmt den Lagerwert.");
    }
    const product = await ensureProduct(tx, parsedData, params.productId);
    await postInbound(tx, {
      productId: product.id,
      qty,
      type: "CORRECTION",
      unitCostEurCents: params.unitPriceCents,
      refType: "IMPORT",
      refId: batch.id,
      note: "Anfangsbestand (Alt-Datenübernahme)",
      userId: params.userId,
    });
    resultRefType = "PRODUCT";
    resultRefId = product.id;
    auditComment = `Anfangsbestand: ${qty} × ${product.name} zu ${(params.unitPriceCents / 100).toFixed(2).replace(".", ",")} € eingebucht`;
  } else if (batch.kind === "PRODUCTS") {
    const product = await ensureProduct(tx, parsedData, params.productId);
    resultRefType = "PRODUCT";
    resultRefId = product.id;
    auditComment = params.productId
      ? `Produkt „${product.name}“ verknüpft`
      : `Produkt „${product.name}“ angelegt`;
  } else if (batch.kind === "SUPPLIER_INVOICE" || batch.kind === "PURCHASE_ORDER") {
    if (!params.productId) throw new AppError("Bitte zuerst ein Produkt zuordnen.");
    const qty = params.qty ?? 0;
    if (qty <= 0) throw new AppError("Bitte eine gültige Menge angeben.");
    const unitPriceCents = params.unitPriceCents ?? 0;
    if (unitPriceCents < 0) throw new AppError("Ungültiger Preis.");
    const product = await tx.product.findUniqueOrThrow({ where: { id: params.productId } });
    const { refType, refId, comment } = await acceptIntoDraftPo(tx, {
      batch,
      item,
      product,
      qty,
      unitPriceCents,
      userId: params.userId,
    });
    resultRefType = refType;
    resultRefId = refId;
    auditComment = comment;
  } else {
    throw new AppError(
      "Dieser Import-Typ wird über die Übernahme-Funktion nicht unterstützt. " +
        "Bestandsänderungen bitte als Anfangsbestand importieren oder als Bestandskorrektur am Produkt buchen."
    );
  }

  await tx.importItem.update({
    where: { id: item.id },
    data: { status: "ACCEPTED", resultRefType, resultRefId },
  });
  await writeAudit(
    { userId: params.userId, entityType: "IMPORT_ITEM", entityId: item.id, action: "IMPORT", comment: auditComment },
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

/** Rechnungs-/Bestellzeile in die Entwurfs-Bestellung des Batches übernehmen. */
async function acceptIntoDraftPo(
  tx: Prisma.TransactionClient,
  params: {
    batch: { id: string; filename: string | null; kind: string };
    item: { parsed: string | null };
    product: { id: string; name: string; baseUnitId: string };
    qty: number;
    unitPriceCents: number;
    userId: string;
  }
) {
  const { batch, item, product } = params;
  // Ein Entwurfs-PO je Batch: erkennbar über supplierOrderNumber = IMPORT-<batchId>
  const batchSupplierId = await resolveBatchSupplier(tx, batch.id);
  if (!batchSupplierId) {
    throw new AppError(
      "Bitte beim Upload einen Lieferanten wählen, damit eine Entwurfs-Bestellung angelegt werden kann."
    );
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

  // Mapping lernen: Lieferanten-Bezeichnung → Produkt
  const parsed = item.parsed ? (JSON.parse(item.parsed) as Record<string, unknown>) : {};
  if (typeof parsed.productName === "string" && parsed.productName.trim()) {
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

  return {
    refType: "PURCHASE_ORDER",
    refId: po.id,
    comment: `Übernommen: ${params.qty} × ${product.name} zu ${(params.unitPriceCents / 100).toFixed(2).replace(".", ",")} € (${po.orderNumber})`,
  };
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
    const qtyRaw = optNum(formData, "qty");
    const qty = qtyRaw !== null ? Math.round(qtyRaw) : null;
    const unitPriceCents = optNum(formData, "unitPriceCents");
    if (unitPriceCents !== null && unitPriceCents < 0) throw new AppError("Ungültiger Preis.");
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
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    // Bei Alt-Datenübernahmen (Kunden/Lieferanten/Produkte/Anfangsbestand) ist
    // Neuanlage ohne Produktzuordnung der Normalfall – sonst Zuordnung Pflicht.
    const contactKind = batch.kind === "CUSTOMERS" || batch.kind === "SUPPLIERS";
    const allowsNewProducts = contactKind || batch.kind === "PRODUCTS" || batch.kind === "OPENING_STOCK";
    const items = await db.importItem.findMany({
      where: {
        batchId,
        status: { in: ["PENDING", "EDITED"] },
        confidence: { gte: 90 },
        ...(allowsNewProducts ? {} : { matchedProductId: { not: null } }),
      },
      orderBy: { rowIndex: "asc" },
    });
    if (items.length === 0) {
      throw new AppError(
        allowsNewProducts
          ? "Keine Positionen mit ausreichender Sicherheit (≥ 90 %) vorhanden – bitte einzeln prüfen."
          : "Keine Positionen mit ausreichender Sicherheit (≥ 90 %) und Produktzuordnung vorhanden."
      );
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
      // Kunden/Lieferanten/Produkte brauchen weder Menge noch Preis –
      // Rechnungen/Bestellungen und Anfangsbestand schon.
      if (!contactKind && batch.kind !== "PRODUCTS" && (!qty || price === null)) continue;
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
          productId: item.matchedProductId,
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
