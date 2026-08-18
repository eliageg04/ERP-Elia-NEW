import { db } from "../db";
import { AppError } from "../errors";
import { writeEvent } from "../audit";
import { similarity } from "./matching";

// ============================================================
// Lexware-Office-Anbindung (offizielle Public API).
// Holt Eingangsrechnungen (Belege) ab und legt sie in der
// Import-Inbox ab – Duplikate werden über die Beleg-ID erkannt.
// Die API liefert Kopfdaten (Lieferant, Nummer, Datum, Betrag);
// Artikelpositionen werden beim Prüfen in der Inbox ergänzt.
// API-Schlüssel: Einstellungen → Integrationen → Lexware.
// ============================================================

const DEFAULT_BASE_URL = "https://api.lexoffice.io/v1";

type LexwareConfig = { apiKey: string; baseUrl: string };

export async function getLexwareConfig(): Promise<LexwareConfig | null> {
  const cfg = await db.integrationConfig.findUnique({ where: { provider: "LEXWARE" } });
  if (!cfg?.enabled || !cfg.config) return null;
  try {
    const parsed = JSON.parse(cfg.config) as { apiKey?: string; baseUrl?: string };
    if (!parsed.apiKey) return null;
    return { apiKey: parsed.apiKey, baseUrl: (parsed.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "") };
  } catch {
    return null;
  }
}

async function lexGet<T>(cfg: LexwareConfig, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.baseUrl + path, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: "application/json" },
    });
  } catch {
    throw new AppError("Lexware ist nicht erreichbar – bitte später erneut versuchen.");
  }
  if (res.status === 401) throw new AppError("Lexware: API-Schlüssel ungültig oder abgelaufen (401). Bitte in den Einstellungen prüfen.");
  if (res.status === 403) throw new AppError("Lexware: Zugriff verweigert (403) – der API-Schlüssel hat nicht die nötigen Berechtigungen.");
  if (res.status === 429) throw new AppError("Lexware: Anfragelimit erreicht – bitte in einer Minute erneut versuchen.");
  if (!res.ok) throw new AppError(`Lexware-API-Fehler (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

/**
 * Beleg-PDF in die Lexware-Belegübersicht hochladen (Richtung ERP → Lexware).
 * Rückgabe: Lexware-Datei-ID oder Fehlertext (nicht werfend – der Upload ins
 * ERP darf nicht daran scheitern, dass Lexware gerade nicht erreichbar ist).
 */
export async function uploadVoucherToLexware(
  pdf: Buffer,
  filename: string
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const cfg = await getLexwareConfig();
  if (!cfg) return { ok: false, error: "Lexware nicht konfiguriert" };
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
    form.append("type", "voucher");
    const res = await fetch(cfg.baseUrl + "/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) return { ok: false, error: `Lexware-Upload fehlgeschlagen (HTTP ${res.status})` };
    const data = (await res.json()) as { id?: string };
    if (!data.id) return { ok: false, error: "Lexware-Upload: keine Datei-ID erhalten" };
    return { ok: true, fileId: data.id };
  } catch {
    return { ok: false, error: "Lexware nicht erreichbar" };
  }
}

type VoucherListEntry = {
  id?: string;
  voucherType?: string;
  voucherStatus?: string;
  voucherNumber?: string;
  voucherDate?: string;
  contactName?: string | null;
  totalAmount?: number;
  currency?: string;
};

/**
 * Neue Eingangsrechnungen aus Lexware in die Import-Inbox holen.
 * Idempotent: bereits importierte Belege werden übersprungen.
 */
export async function syncLexwarePurchaseInvoices(userId?: string | null) {
  const cfg = await getLexwareConfig();
  if (!cfg) {
    throw new AppError(
      "Lexware ist nicht konfiguriert. Bitte unter Einstellungen → Integrationen den API-Schlüssel hinterlegen und aktivieren."
    );
  }

  const list = await lexGet<{ content?: VoucherListEntry[] }>(
    cfg,
    "/voucherlist?voucherType=purchaseinvoice&voucherStatus=open%2Cpaid%2Cpaidoff%2Ctransferred&size=100&page=0&sort=voucherDate%2CDESC"
  );
  const vouchers = Array.isArray(list?.content) ? list.content : [];

  const suppliers = await db.supplier.findMany({ where: { active: true } });
  let imported = 0;
  let skipped = 0;

  for (const v of vouchers) {
    if (!v?.id) continue;
    const hash = `lexware:${v.id}`;
    const existing = await db.importBatch.findFirst({ where: { contentHash: hash } });
    if (existing) {
      skipped++;
      continue;
    }
    if (imported >= 20) break; // Zeitbudget pro Lauf (Serverless); Rest beim nächsten Sync

    // Lieferanten anhand des Namens zuordnen (tolerant)
    const contactName = (v.contactName ?? "").trim();
    let bestSupplier: (typeof suppliers)[number] | null = null;
    let bestScore = 0;
    for (const s of suppliers) {
      const score = similarity(contactName, s.name);
      if (score > bestScore) {
        bestScore = score;
        bestSupplier = s;
      }
    }
    const supplier = contactName && bestScore >= 0.55 ? bestSupplier : null;

    const totalCents = typeof v.totalAmount === "number" ? Math.round(v.totalAmount * 100) : null;
    const dateStr = v.voucherDate ? v.voucherDate.slice(0, 10) : null;

    const batch = await db.importBatch.create({
      data: {
        source: "LEXWARE",
        kind: "SUPPLIER_INVOICE",
        filename: `Lexware ${v.voucherNumber ?? v.id.slice(0, 8)}`,
        contentHash: hash,
        status: "REVIEW",
        summary: [contactName || "Unbekannter Lieferant", dateStr, totalCents !== null ? `${(totalCents / 100).toFixed(2).replace(".", ",")} ${v.currency ?? "EUR"}` : null]
          .filter(Boolean)
          .join(" · "),
        createdById: userId ?? null,
      },
    });
    await db.importItem.create({
      data: {
        batchId: batch.id,
        rowIndex: 0,
        raw: JSON.stringify({
          Lieferant: contactName || "–",
          Rechnungsnummer: v.voucherNumber ?? "–",
          Datum: dateStr ?? "–",
          Gesamtbetrag: totalCents !== null ? (totalCents / 100).toFixed(2).replace(".", ",") + " " + (v.currency ?? "EUR") : "–",
          Status: v.voucherStatus ?? "–",
        }),
        parsed: JSON.stringify({
          supplierName: contactName || null,
          invoiceNumber: v.voucherNumber ?? null,
          date: dateStr,
          totalPriceCentsParsed: totalCents,
          currency: v.currency ?? "EUR",
          matchMethod: supplier ? `Lieferant erkannt: ${supplier.name}` : "Lieferant nicht eindeutig",
          candidates: [],
        }),
        // Kopfdaten vorhanden, Positionen fehlen → immer manuell prüfen
        confidence: supplier ? 60 : 40,
        status: "PENDING",
        note: "Aus Lexware übernommen – Produkt, Menge und Einzelpreis bitte ergänzen.",
      },
    });
    if (supplier) {
      await db.setting.upsert({
        where: { key: `importSupplier:${batch.id}` },
        create: { key: `importSupplier:${batch.id}`, value: JSON.stringify(supplier.id) },
        update: { value: JSON.stringify(supplier.id) },
      });
    }
    await writeEvent({
      type: "LEXWARE_VOUCHER_IMPORTED",
      entityType: "IMPORT_BATCH",
      entityId: batch.id,
      summary: `Lexware-Beleg ${v.voucherNumber ?? v.id} in die Import-Inbox übernommen`,
      userId,
    });
    imported++;
  }

  return { imported, skipped, totalSeen: vouchers.length };
}
