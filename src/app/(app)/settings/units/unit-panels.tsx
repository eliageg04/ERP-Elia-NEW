"use client";

import { ActionForm, ActionButton, Field, Input, SubmitButton } from "@/components/form";
import { createUnitAction, deleteUnitAction } from "@/server/actions/settings";

export function CreateUnitForm() {
  return (
    <ActionForm action={createUnitAction} resetOnSuccess className="flex items-end gap-2">
      <Field label="Neue Einheit" className="w-64">
        <Input name="name" required placeholder="z.B. Palette" />
      </Field>
      <SubmitButton>Anlegen</SubmitButton>
    </ActionForm>
  );
}

export function DeleteUnitButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton
      action={deleteUnitAction}
      variant="ghost"
      hiddenFields={{ id }}
      confirmMessage={`Einheit „${name}" wirklich löschen?`}
    >
      Löschen
    </ActionButton>
  );
}
