"use client";

import { ActionForm, ActionButton, Input, SubmitButton } from "@/components/form";
import { updateMappingFactorAction, deleteMappingAction } from "@/server/actions/settings";

export function MappingRowActions({ id, unitFactor }: { id: string; unitFactor: number | null }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <ActionForm action={updateMappingFactorAction} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <Input
          type="number"
          name="unitFactor"
          min={1}
          defaultValue={unitFactor ?? ""}
          placeholder="Faktor"
          className="!w-20 text-xs"
        />
        <SubmitButton variant="ghost" size="sm">Speichern</SubmitButton>
      </ActionForm>
      <ActionButton
        action={deleteMappingAction}
        variant="ghost"
        hiddenFields={{ id }}
        confirmMessage="Mapping wirklich löschen? Die automatische Erkennung vergisst diese Zuordnung."
      >
        Löschen
      </ActionButton>
    </div>
  );
}
