"use client";

import { ActionForm, Field, Input, Select, SubmitButton, type FormAction } from "@/components/form";
import { CURRENCIES } from "@/lib/constants";

type SupplierData = {
  id?: string;
  code?: string;
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  currency?: string;
  paymentTerms?: string | null;
  customerNumber?: string | null;
};

export function SupplierForm({
  action,
  supplier,
}: {
  action: FormAction;
  supplier?: SupplierData;
}) {
  const isEdit = Boolean(supplier?.id);
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {supplier?.id && <input type="hidden" name="id" value={supplier.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input name="name" defaultValue={supplier?.name} required placeholder="z.B. TCG Distribution GmbH" />
        </Field>
        <Field label="Code" hint={isEdit ? undefined : "Leer lassen für automatische Vergabe (SUP-XXXX)"}>
          <Input name="code" defaultValue={supplier?.code ?? ""} />
        </Field>
        <Field label="Ansprechpartner">
          <Input name="contactName" defaultValue={supplier?.contactName ?? ""} placeholder="z.B. Max Mustermann" />
        </Field>
        <Field label="E-Mail">
          <Input type="email" name="email" defaultValue={supplier?.email ?? ""} placeholder="bestellung@haendler.de" />
        </Field>
        <Field label="Telefon">
          <Input name="phone" defaultValue={supplier?.phone ?? ""} inputMode="tel" />
        </Field>
        <Field label="Webseite" className="sm:col-span-2">
          <Input name="website" defaultValue={supplier?.website ?? ""} placeholder="https://…" />
        </Field>
      </div>

      <h3 className="mt-2 text-sm font-medium text-ink-secondary">Adresse</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Straße und Hausnummer" className="sm:col-span-2">
          <Input name="street" defaultValue={supplier?.street ?? ""} />
        </Field>
        <div className="grid grid-cols-[100px_1fr] gap-4">
          <Field label="PLZ">
            <Input name="zip" defaultValue={supplier?.zip ?? ""} inputMode="numeric" />
          </Field>
          <Field label="Ort">
            <Input name="city" defaultValue={supplier?.city ?? ""} />
          </Field>
        </div>
        <Field label="Land" hint="Ländercode, z.B. DE, US, GB">
          <Input name="country" defaultValue={supplier?.country ?? "DE"} maxLength={2} />
        </Field>
      </div>

      <h3 className="mt-2 text-sm font-medium text-ink-secondary">Konditionen</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Standardwährung" hint="Währung der Bestellungen bei diesem Händler">
          <Select name="currency" defaultValue={supplier?.currency ?? "EUR"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Zahlungsbedingungen">
          <Input name="paymentTerms" defaultValue={supplier?.paymentTerms ?? ""} placeholder='z.B. "Vorkasse", "30 Tage netto"' />
        </Field>
        <Field label="Unsere Kundennummer" hint="Kundennummer bei diesem Großhändler">
          <Input name="customerNumber" defaultValue={supplier?.customerNumber ?? ""} />
        </Field>
      </div>

      <div>
        <SubmitButton>{isEdit ? "Änderungen speichern" : "Großhändler anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
