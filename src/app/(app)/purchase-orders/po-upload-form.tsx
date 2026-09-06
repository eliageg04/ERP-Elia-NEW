"use client";

import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import { uploadPoPdfAction } from "@/server/actions/purchase-orders";

/**
 * Bezahlte Lieferantenrechnung (PDF) hochladen – die KI legt die
 * Bestellung mit Lieferant, Ordernummer, Datum und Positionen direkt an.
 */
export function PoUploadForm({
  suppliers,
  aiEnabled,
}: {
  suppliers: Array<{ id: string; name: string }>;
  aiEnabled: boolean;
}) {
  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-canvas/60">
        Rechnung hochladen (PDF) – Bestellung automatisch anlegen
      </summary>
      <div className="border-t border-border px-4 py-4">
        <ActionForm action={uploadPoPdfAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Rechnungs-PDF" required>
            <input
              type="file"
              name="file"
              accept=".pdf"
              required
              className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-1 file:text-sm"
            />
          </Field>
          <Field label="Lieferant" hint="Leer lassen = die KI erkennt ihn aus der Rechnung">
            <Select name="supplierId" defaultValue="">
              <option value="">– automatisch erkennen –</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <SubmitButton>Hochladen & Bestellung anlegen</SubmitButton>
          </div>
          <p className="text-xs text-ink-tertiary sm:col-span-2 lg:col-span-3">
            {aiEnabled
              ? "Die KI liest Ordernummer, Rechnungsdatum und alle Positionen aus (ca. 15–30 Sekunden). Unbekannte Produkte werden automatisch angelegt, doppelte Ordernummern werden abgefangen."
              : "Hinweis: Für die PDF-Erkennung wird ein KI-Schlüssel benötigt (Einstellungen → Integrationen)."}
          </p>
        </ActionForm>
      </div>
    </details>
  );
}
