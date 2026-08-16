"use client";

import { Card } from "@/components/ui";
import { ActionForm, Field, Select, SubmitButton } from "@/components/form";
import { uploadImportAction } from "@/server/actions/imports";

type SupplierOption = { id: string; label: string };

export function UploadForm({ suppliers }: { suppliers: SupplierOption[] }) {
  return (
    <Card title="Datei importieren">
      <ActionForm action={uploadImportAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Datei (CSV / XLSX)" required className="lg:col-span-2">
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls,.txt"
            required
            className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-1 file:text-sm"
          />
        </Field>
        <Field label="Art des Imports" required>
          <Select name="kind" defaultValue="SUPPLIER_INVOICE">
            <option value="SUPPLIER_INVOICE">Lieferantenrechnung</option>
            <option value="PURCHASE_ORDER">Bestellung</option>
            <option value="PRODUCTS">Produkte</option>
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
        <div className="sm:col-span-2 lg:col-span-4">
          <SubmitButton>Hochladen & analysieren</SubmitButton>
          <p className="mt-2 text-xs text-ink-tertiary">
            Lexware: einfach den CSV-Export aus Lexware hochladen – Spalten wie „Artikelnummer“,
            „Bezeichnung“, „Menge“, „Einzelpreis“ werden automatisch erkannt. Produkte werden über
            EAN → SKU → gelernte Lieferanten-Mappings → Namensähnlichkeit zugeordnet.
          </p>
        </div>
      </ActionForm>
    </Card>
  );
}
