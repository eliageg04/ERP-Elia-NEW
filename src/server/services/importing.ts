import crypto from "node:crypto";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { db } from "../db";
import { AppError } from "../errors";
import { matchProduct } from "./matching";

// ============================================================
// Import-Pipeline: Datei → ImportBatch + ImportItems (Inbox) →
// manuelle Prüfung/Korrektur → Übernahme ins System.
// Duplikaterkennung über SHA-256-Hash des Dateiinhalts sowie
// Rechnungs-/Bestellnummern beim Übernehmen.
// Lexware: kein öffentliches API verfügbar → robuster CSV-Import
// der Lexware-Exportformate (konfigurierbares Spalten-Mapping).
// ============================================================

export type ParsedRow = Record<string, string>;

export function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** CSV-Inhalt in Zeilen-Objekte parsen (Header-Zeile erforderlich). */
export function parseCsv(content: string): ParsedRow[] {
  const result = Papa.parse<ParsedRow>(content.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new AppError("Die CSV-Datei konnte nicht gelesen werden. Bitte Format prüfen.");
  }
  return result.data;
}

/** XLSX-Buffer in Zeilen-Objekte parsen (erstes Arbeitsblatt). */
export function parseXlsx(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new AppError("Die Excel-Datei enthält kein Arbeitsblatt.");
  return XLSX.utils.sheet_to_json<ParsedRow>(sheet, { raw: false, defval: "" });
}

/** Bekannte Spaltennamen (auch Lexware-Exporte) auf ERP-Felder abbilden. */
const COLUMN_ALIASES: Record<string, string[]> = {
  productName: ["produkt", "produktname", "artikel", "artikelbezeichnung", "bezeichnung", "name", "product", "description", "beschreibung"],
  sku: ["sku", "artikelnummer", "artikelnr", "artikel-nr", "art-nr", "artnr", "item number", "itemno"],
  ean: ["ean", "gtin", "barcode"],
  qty: ["menge", "anzahl", "qty", "quantity", "stück", "stueck"],
  unit: ["einheit", "unit", "mengeneinheit", "verpackung"],
  unitPrice: ["einzelpreis", "preis", "unit price", "stückpreis", "stueckpreis", "epreis", "einzelpreis netto", "price"],
  totalPrice: ["gesamtpreis", "gesamt", "total", "summe", "betrag", "gesamtbetrag"],
  invoiceNumber: ["rechnungsnummer", "rechnungsnr", "rechnung", "invoice", "invoice number", "belegnummer", "belegnr"],
  orderNumber: ["bestellnummer", "bestellnr", "auftragsnummer", "order", "order number"],
  supplierName: ["lieferant", "grosshändler", "großhändler", "supplier", "händler"],
  date: ["datum", "date", "rechnungsdatum", "belegdatum", "bestelldatum"],
  currency: ["währung", "waehrung", "currency"],
  tax: ["steuer", "mwst", "ust", "tax", "vat"],
  discount: ["rabatt", "discount", "nachlass"],
};

export function mapColumns(row: ParsedRow): Record<string, string> {
  const mapped: Record<string, string> = {};
  const entries = Object.entries(row);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const [col, value] of entries) {
      if (aliases.includes(col.toLowerCase().trim()) && value !== "") {
        mapped[field] = String(value).trim();
        break;
      }
    }
  }
  return mapped;
}

/** Deutsche und englische Zahlformate tolerant in Cents umwandeln. */
export function parseMoneyToCents(raw: string | undefined | null): number | null {
  if (!raw) return null;
  let s = String(raw).replace(/[€$£\s]/g, "").trim();
  if (!s) return null;
  // "1.234,56" (de) vs "1,234.56" (en) vs "1234.56"
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const value = Number(s);
  if (!isFinite(value)) return null;
  return Math.round(value * 100);
}

export function parseQty(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Import-Batch aus Datei erzeugen: parsen, Produkte matchen,
 * Confidence berechnen, alles in die Inbox legen.
 */
export async function createImportBatch(params: {
  source: "CSV" | "XLSX" | "LEXWARE";
  kind: string;
  filename: string;
  content: Buffer;
  supplierId?: string | null;
  userId?: string | null;
}) {
  const hash = sha256(params.content);
  const existing = await db.importBatch.findFirst({
    where: { contentHash: hash, status: { not: "DISCARDED" } },
  });
  if (existing) {
    throw new AppError(
      `Diese Datei wurde bereits importiert (${existing.createdAt.toLocaleDateString("de-DE")}). Duplikat verhindert.`
    );
  }

  const rows =
    params.source === "XLSX"
      ? parseXlsx(params.content)
      : parseCsv(params.content.toString("utf8"));
  if (rows.length === 0) throw new AppError("Die Datei enthält keine Datenzeilen.");
  if (rows.length > 2000) throw new AppError("Maximal 2.000 Zeilen pro Import.");

  const batch = await db.importBatch.create({
    data: {
      source: params.source,
      kind: params.kind,
      filename: params.filename,
      contentHash: hash,
      status: "REVIEW",
      rawText: params.source === "XLSX" ? null : params.content.toString("utf8").slice(0, 100_000),
      createdById: params.userId ?? null,
      summary: `${rows.length} Zeilen aus ${params.filename}`,
    },
  });

  for (let i = 0; i < rows.length; i++) {
    const mapped = mapColumns(rows[i]);
    const match = await matchProduct({
      name: mapped.productName,
      ean: mapped.ean,
      sku: mapped.sku,
      supplierId: params.supplierId,
    });
    // Gesamt-Confidence: Produktmatch + Vollständigkeit der Pflichtfelder
    const qty = parseQty(mapped.qty);
    const price = parseMoneyToCents(mapped.unitPrice) ?? parseMoneyToCents(mapped.totalPrice);
    let confidence = match.productId ? match.confidence : Math.min(match.confidence, 40);
    if (!qty) confidence = Math.min(confidence, 50);
    if (!price) confidence = Math.min(confidence, 60);

    await db.importItem.create({
      data: {
        batchId: batch.id,
        rowIndex: i,
        raw: JSON.stringify(rows[i]),
        parsed: JSON.stringify({
          ...mapped,
          qtyParsed: qty,
          unitPriceCentsParsed: parseMoneyToCents(mapped.unitPrice),
          totalPriceCentsParsed: parseMoneyToCents(mapped.totalPrice),
          matchMethod: match.method,
          candidates: match.candidates,
        }),
        confidence,
        status: "PENDING",
        matchedProductId: match.productId,
      },
    });
  }
  return batch;
}
