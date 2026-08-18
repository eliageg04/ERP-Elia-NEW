import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db } from "../db";
import { AppError } from "../errors";

// ============================================================
// KI-Rechnungserkennung: liest eine Rechnungs-PDF mit Claude
// aus und liefert strukturierte Positionsdaten (Lieferant,
// Rechnungsnummer, Artikel, Mengen, Preise). Erfordert einen
// Anthropic-API-Schlüssel (Einstellungen → Integrationen oder
// Umgebungsvariable ANTHROPIC_API_KEY).
// ============================================================

const InvoiceSchema = z.object({
  supplierName: z.string().nullable().describe("Name des Lieferanten/Rechnungsstellers"),
  invoiceNumber: z.string().nullable().describe("Rechnungsnummer"),
  invoiceDate: z.string().nullable().describe("Rechnungsdatum im Format JJJJ-MM-TT"),
  currency: z.string().nullable().describe("Währung als ISO-Code, z.B. EUR, USD, GBP"),
  items: z
    .array(
      z.object({
        description: z.string().describe("Artikelbezeichnung wie auf der Rechnung"),
        sku: z.string().nullable().describe("Artikelnummer des Lieferanten, falls angegeben"),
        quantity: z.number().describe("Menge"),
        unit: z.string().nullable().describe("Einheit wie angegeben, z.B. Stück, Display, Case"),
        unitPrice: z.number().nullable().describe("Einzelpreis (netto bevorzugt)"),
        totalPrice: z.number().nullable().describe("Zeilensumme"),
      })
    )
    .describe("Alle Artikelpositionen der Rechnung (keine Versand-/Gebührenzeilen)"),
  shippingCost: z.number().nullable().describe("Versandkosten, falls ausgewiesen"),
  taxAmount: z.number().nullable().describe("Steuerbetrag gesamt (MwSt/USt)"),
  totalGross: z.number().nullable().describe("Rechnungsbetrag brutto gesamt"),
});

export type ExtractedInvoice = z.infer<typeof InvoiceSchema>;

/** API-Schlüssel: Integrations-Einstellung hat Vorrang, sonst Umgebungsvariable. */
export async function getAiApiKey(): Promise<string | null> {
  const cfg = await db.integrationConfig.findUnique({ where: { provider: "AI" } });
  if (cfg?.enabled && cfg.config) {
    try {
      const parsed = JSON.parse(cfg.config) as { apiKey?: string };
      if (parsed.apiKey) return parsed.apiKey;
    } catch {
      // ignorieren, Fallback auf Env
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export async function extractInvoiceFromPdf(pdf: Buffer): Promise<ExtractedInvoice> {
  const apiKey = await getAiApiKey();
  if (!apiKey) {
    throw new AppError(
      "Für die PDF-Rechnungserkennung wird ein Anthropic-API-Schlüssel benötigt. " +
        "Bitte unter Einstellungen → Integrationen → KI-Rechnungserkennung hinterlegen " +
        "(console.anthropic.com) – oder die Rechnung als CSV/XLSX hochladen."
    );
  }
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });

  let response;
  try {
    response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(InvoiceSchema) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdf.toString("base64"),
              },
            },
            {
              type: "text",
              text:
                "Extrahiere die Daten dieser Lieferantenrechnung. " +
                "Übernimm Artikelbezeichnungen exakt wie gedruckt. " +
                "Versand-, Zoll- und Gebührenzeilen gehören NICHT in items, " +
                "sondern in shippingCost bzw. bleiben unberücksichtigt. " +
                "Beträge als Dezimalzahlen in der Rechnungswährung. " +
                "Nicht erkennbare Felder auf null setzen – nichts erfinden.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AppError("KI-Rechnungserkennung: Der Anthropic-API-Schlüssel ist ungültig.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError("KI-Rechnungserkennung: Anfragelimit erreicht – bitte kurz warten und erneut versuchen.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new AppError(`KI-Rechnungserkennung fehlgeschlagen (${err.status ?? "API-Fehler"}).`);
    }
    throw new AppError("KI-Rechnungserkennung: Zeitüberschreitung oder Netzwerkfehler – bitte erneut versuchen.");
  }

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new AppError(
      "Die PDF konnte nicht ausgelesen werden (unleserlich oder kein Rechnungsformat). " +
        "Bitte Positionen manuell erfassen oder als CSV hochladen."
    );
  }
  return response.parsed_output;
}
