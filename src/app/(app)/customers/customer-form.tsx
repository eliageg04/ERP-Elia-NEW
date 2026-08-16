"use client";

import { ActionForm, Field, Input, SubmitButton, type FormAction } from "@/components/form";

type CustomerData = {
  id?: string;
  code?: string;
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  billingStreet?: string | null;
  billingZip?: string | null;
  billingCity?: string | null;
  billingCountry?: string | null;
  shippingStreet?: string | null;
  shippingZip?: string | null;
  shippingCity?: string | null;
  shippingCountry?: string | null;
};

export function CustomerForm({
  action,
  customer,
}: {
  action: FormAction;
  customer?: CustomerData;
}) {
  const isEdit = Boolean(customer?.id);
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {customer?.id && <input type="hidden" name="id" value={customer.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input name="name" defaultValue={customer?.name} required placeholder="z.B. Max Mustermann" />
        </Field>
        <Field label="Firma">
          <Input name="company" defaultValue={customer?.company ?? ""} placeholder="z.B. Kartenladen GmbH" />
        </Field>
        <Field label="Code" hint={isEdit ? undefined : "Leer lassen für automatische Vergabe (KND-XXXX)"}>
          <Input name="code" defaultValue={customer?.code ?? ""} />
        </Field>
        <Field label="E-Mail">
          <Input type="email" name="email" defaultValue={customer?.email ?? ""} placeholder="kunde@beispiel.de" />
        </Field>
        <Field label="Telefon">
          <Input name="phone" defaultValue={customer?.phone ?? ""} inputMode="tel" />
        </Field>
      </div>

      <h3 className="mt-2 text-sm font-medium text-ink-secondary">Rechnungsadresse</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Straße und Hausnummer" className="sm:col-span-2">
          <Input name="billingStreet" defaultValue={customer?.billingStreet ?? ""} />
        </Field>
        <div className="grid grid-cols-[100px_1fr] gap-4">
          <Field label="PLZ">
            <Input name="billingZip" defaultValue={customer?.billingZip ?? ""} inputMode="numeric" />
          </Field>
          <Field label="Ort">
            <Input name="billingCity" defaultValue={customer?.billingCity ?? ""} />
          </Field>
        </div>
        <Field label="Land" hint="Ländercode, z.B. DE, AT, CH">
          <Input name="billingCountry" defaultValue={customer?.billingCountry ?? "DE"} maxLength={2} />
        </Field>
      </div>

      <h3 className="mt-2 text-sm font-medium text-ink-secondary">Lieferadresse</h3>
      <p className="-mt-3 text-xs text-ink-tertiary">Leer lassen, wenn identisch mit der Rechnungsadresse.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Straße und Hausnummer" className="sm:col-span-2">
          <Input name="shippingStreet" defaultValue={customer?.shippingStreet ?? ""} />
        </Field>
        <div className="grid grid-cols-[100px_1fr] gap-4">
          <Field label="PLZ">
            <Input name="shippingZip" defaultValue={customer?.shippingZip ?? ""} inputMode="numeric" />
          </Field>
          <Field label="Ort">
            <Input name="shippingCity" defaultValue={customer?.shippingCity ?? ""} />
          </Field>
        </div>
        <Field label="Land" hint="Ländercode, z.B. DE, AT, CH">
          <Input name="shippingCountry" defaultValue={customer?.shippingCountry ?? "DE"} maxLength={2} />
        </Field>
      </div>

      <div>
        <SubmitButton>{isEdit ? "Änderungen speichern" : "Kunde anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
