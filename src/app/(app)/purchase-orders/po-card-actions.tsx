"use client";

import { ActionForm, ActionButton, Field, Input, Select, SubmitButton } from "@/components/form";
import { addPoTrackingAction, markPoDeliveredAction } from "@/server/actions/purchase-orders";
import { CARRIERS, label } from "@/lib/constants";

/** Tracking erfassen → alle offenen Mengen gelten als versendet. */
export function PoTrackingForm({ poId }: { poId: string }) {
  return (
    <ActionForm action={addPoTrackingAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={poId} />
      <Field label="Versanddienstleister" className="w-36">
        <Select name="carrier" defaultValue="UPS">
          {CARRIERS.map((c) => (
            <option key={c} value={c}>{label(c)}</option>
          ))}
        </Select>
      </Field>
      <Field label="Sendungsnummer" className="min-w-[220px] flex-1">
        <Input name="trackingNumber" placeholder="z.B. 1Z999AA10123456784" />
      </Field>
      <SubmitButton size="md">Tracking hinzufügen → versendet</SubmitButton>
    </ActionForm>
  );
}

/** Zustellung bestätigen → Ware wird automatisch in den Bestand gebucht. */
export function PoDeliveredButton({ poId }: { poId: string }) {
  return (
    <ActionButton
      action={markPoDeliveredAction}
      variant="primary"
      size="md"
      hiddenFields={{ id: poId }}
      confirmMessage="Zustellung bestätigen? Alle offenen Mengen werden in den Bestand eingebucht."
    >
      ✓ Zugestellt – in den Bestand buchen
    </ActionButton>
  );
}
