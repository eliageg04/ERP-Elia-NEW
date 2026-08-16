"use client";

import { Card } from "@/components/ui";
import { ActionForm, ActionButton, Field, Input, MoneyInput, Select, SubmitButton, Textarea } from "@/components/form";
import {
  upsertConversionAction,
  deleteConversionAction,
  stockCorrectionAction,
} from "@/server/actions/products";

/** Einheiten-Umrechnungen bearbeiten (1 Case = N Basiseinheiten). */
export function ConversionEditor({
  productId,
  baseUnitName,
  conversions,
  units,
}: {
  productId: string;
  baseUnitName: string;
  conversions: Array<{ id: string; unitId: string; unitName: string; factor: number }>;
  units: Array<{ id: string; name: string }>;
}) {
  return (
    <Card title="Einheiten-Umrechnung">
      {conversions.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {conversions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-canvas/50 px-3 py-1.5 text-sm">
              <span>
                1 {c.unitName} = <span className="tnum font-medium">{c.factor}</span> {baseUnitName}
              </span>
              <ActionButton
                action={deleteConversionAction}
                variant="ghost"
                hiddenFields={{ id: c.id }}
                confirmMessage={`Umrechnung für ${c.unitName} wirklich entfernen?`}
              >
                Entfernen
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={upsertConversionAction} resetOnSuccess className="flex items-end gap-2">
        <input type="hidden" name="productId" value={productId} />
        <Field label="Einheit" className="flex-1">
          <Select name="unitId" required>
            <option value="">– wählen –</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={`= x ${baseUnitName}`} className="w-24">
          <Input type="number" name="factor" min={1} required placeholder="12" />
        </Field>
        <SubmitButton size="md" variant="secondary">Speichern</SubmitButton>
      </ActionForm>
    </Card>
  );
}

/** Manuelle Bestandskorrektur mit Pflicht-Begründung (Audit-Log). */
export function StockCorrectionForm({
  productId,
  baseUnitName,
}: {
  productId: string;
  baseUnitName: string;
}) {
  return (
    <Card title="Bestandskorrektur">
      <ActionForm action={stockCorrectionAction} resetOnSuccess className="flex flex-col gap-3">
        <input type="hidden" name="productId" value={productId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Menge (± ${baseUnitName})`} required hint="z.B. -2 oder +10">
            <Input type="number" name="qty" required placeholder="+10" />
          </Field>
          <Field label="Typ">
            <Select name="type" defaultValue="CORRECTION">
              <option value="CORRECTION">Korrektur</option>
              <option value="DAMAGE">Beschädigt (−)</option>
              <option value="LOSS">Verlust (−)</option>
              <option value="RETURN">Retoure (+)</option>
            </Select>
          </Field>
        </div>
        <Field label="Einstandspreis pro Einheit (nur bei Zugang, optional)" hint="Leer = aktueller Durchschnittspreis">
          <MoneyInput name="unitCostCents" />
        </Field>
        <Field label="Begründung" required>
          <Textarea name="reason" required placeholder="z.B. Zählfehler bei Inventur korrigiert" />
        </Field>
        <div>
          <SubmitButton size="sm">Korrektur buchen</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
