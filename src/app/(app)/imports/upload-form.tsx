"use client";

import { Card } from "@/components/ui";
import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import { uploadImportAction } from "@/server/actions/imports";

type SupplierOption = { id: string; label: string };

export function UploadForm({
  suppliers,
  lexwareEnabled,
  aiEnabled,
}: {
  suppliers: SupplierOption[];
  lexwareEnabled: boolean;
  aiEnabled: boolean;
}) {
  return (
    <Card title="Rechnung / Datei importieren">
      <ActionForm action={uploadImportAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Datei (PDF / CSV / XLSX)" required className="lg:col-span-2">
          <input
            type="file"
            name="file"
            accept=".pdf,.csv,.xlsx,.xls,.txt"
            required
            className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-1 file:text-sm"
          />
        </Field>
        <Field label="Art des Imports" required>
          <Select name="kind" defaultValue="SUPPLIER_INVOICE">
            <option value="SUPPLIER_INVOICE">Lieferantenrechnung</option>
            <option value="PURCHASE_ORDER">Bestellung</option>
            <option value="PRODUCTS">Produkte (Neuanlage)</option>
            <option value="CUSTOMERS">Kunden (Alt-Daten)</option>
            <option value="SUPPLIERS">Lieferanten (Alt-Daten)</option>
            <option value="OPENING_STOCK">Anfangsbestand (Menge + EK)</option>
          </Select>
        </Field>
        <Field label="Lieferant (empfohlen)" hint="Aktiviert gelernte Mappings & Entwurfs-Bestellung">
          <Select name="supplierId" defaultValue="">
            <option value="">– keiner –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </Field>
        {lexwareEnabled && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
            <input type="checkbox" name="sendToLexware" defaultChecked />
            PDF-Beleg zusätzlich an Lexware übergeben (für die Buchhaltung)
          </label>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <SubmitButton>Hochladen & analysieren</SubmitButton>
          <p className="mt-2 text-xs text-ink-tertiary">
            {aiEnabled
              ? "PDF-Rechnungen werden per KI ausgelesen (Positionen, Mengen, Preise) – die Analyse dauert ca. 15–30 Sekunden. "
              : "Für PDF-Rechnungen wird ein KI-Schlüssel benötigt (Einstellungen → Integrationen). "}
            CSV/XLSX: Spalten wie „Artikelnummer“, „Bezeichnung“, „Menge“, „Einzelpreis“ werden automatisch
            erkannt. Produkte werden über EAN → SKU → gelernte Mappings → Namensähnlichkeit zugeordnet.
            Für die Alt-Datenübernahme: „Kunden“/„Lieferanten“ erwarten Spalten wie Name, Firma, E-Mail,
            Straße, PLZ, Ort · „Anfangsbestand“ erwartet Bezeichnung, Menge und Einkaufspreis je Einheit
            (gewichteter Durchschnitt) und bucht den Bestand direkt ein.
          </p>
        </div>
      </ActionForm>
    </Card>
  );
}
