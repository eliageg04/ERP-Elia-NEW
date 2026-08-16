"use client";

import { useState } from "react";
import { ActionForm, Field, Input, Select, SubmitButton, type FormAction } from "@/components/form";
import { CURRENCIES } from "@/lib/constants";
import { toDateInputValue } from "@/lib/format";

type PoHeaderData = {
  id: string;
  supplierId: string;
  supplierOrderNumber: string | null;
  currency: string;
  fxRate: number;
  orderedAt: string | null;
  expectedAt: string | null;
};

/** Kopf-Formular für Vorbestellungen (Anlegen + Bearbeiten). */
export function PoForm({
  action,
  suppliers,
  po,
}: {
  action: FormAction;
  suppliers: Array<{ id: string; name: string; currency: string }>;
  po?: PoHeaderData;
}) {
  const isEdit = Boolean(po);
  const [currency, setCurrency] = useState(po?.currency ?? "EUR");

  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {po && <input type="hidden" name="id" value={po.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lieferant" required className="sm:col-span-2">
          <Select
            name="supplierId"
            required
            defaultValue={po?.supplierId ?? ""}
            onChange={(e) => {
              if (isEdit) return;
              const s = suppliers.find((x) => x.id === e.target.value);
              if (s && (CURRENCIES as readonly string[]).includes(s.currency)) {
                setCurrency(s.currency);
              }
            }}
          >
            <option value="">– wählen –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bestellnummer des Lieferanten" hint="Referenz aus der Bestellbestätigung des Großhändlers">
          <Input
            name="supplierOrderNumber"
            defaultValue={po?.supplierOrderNumber ?? ""}
            placeholder="z.B. ORD-2026-1234"
          />
        </Field>
        <Field label="Währung">
          <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Wechselkurs (EUR je 1 Einheit)"
          hint={
            currency === "EUR"
              ? "Bei EUR immer 1 – der Wert wird ignoriert."
              : `Eingefrorener Kurs: 1 ${currency} = X EUR, z.B. 0,92`
          }
        >
          <Input
            type="number"
            name="fxRate"
            step="0.0001"
            min="0.0001"
            defaultValue={po?.fxRate ?? 1}
          />
        </Field>
        <Field label="Bestellt am" hint="Leer lassen, solange die Bestellung nur ein Entwurf ist">
          <Input type="date" name="orderedAt" defaultValue={toDateInputValue(po?.orderedAt)} />
        </Field>
        <Field label="Erwartete Lieferung">
          <Input type="date" name="expectedAt" defaultValue={toDateInputValue(po?.expectedAt)} />
        </Field>
      </div>
      <div>
        <SubmitButton>{isEdit ? "Kopfdaten speichern" : "Bestellung anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
