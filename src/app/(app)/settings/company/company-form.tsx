"use client";

import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/form";
import { saveCompanySettingsAction } from "@/server/actions/settings";

export function CompanyForm({
  defaults,
}: {
  defaults: { companyName: string; defaultCurrency: string; targetMarginPct: number };
}) {
  return (
    <ActionForm action={saveCompanySettingsAction} className="flex max-w-md flex-col gap-4">
      <Field label="Firmenname">
        <Input name="companyName" defaultValue={defaults.companyName} placeholder="z.B. Elia Trading" />
      </Field>
      <Field label="Standardwährung">
        <Select name="defaultCurrency" defaultValue={defaults.defaultCurrency}>
          {["EUR", "USD", "GBP"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Zielmarge (%)" hint="Grundlage für Verkaufspreis-Empfehlungen">
        <Input type="number" name="targetMarginPct" min={0} max={95} defaultValue={defaults.targetMarginPct} />
      </Field>
      <div>
        <SubmitButton>Speichern</SubmitButton>
      </div>
    </ActionForm>
  );
}
