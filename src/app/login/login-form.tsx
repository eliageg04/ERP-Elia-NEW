"use client";

import { ActionForm, Field, Input, SubmitButton, type FormAction } from "@/components/form";

export function LoginForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <Field label="E-Mail" required>
        <Input type="email" name="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Passwort" required>
        <Input type="password" name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="mt-1 w-full">Anmelden</SubmitButton>
    </ActionForm>
  );
}
