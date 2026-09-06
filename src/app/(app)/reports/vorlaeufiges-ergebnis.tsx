"use client";

import { ActionForm, Field, Input, MoneyInput, SubmitButton } from "@/components/form";
import { saveVorlaeufigesErgebnisAction } from "@/server/actions/settings";

/**
 * Bearbeitungsformular für das vorläufige Jahresergebnis (Lexware-GuV).
 * Wird unter der Ergebnis-Karte auf der Reports-Seite eingeblendet.
 */
export function VorlaeufigesErgebnisForm({
  umsatzCents,
  wareneinkaufCents,
  betriebsergebnisCents,
  stand,
}: {
  umsatzCents: number | null;
  wareneinkaufCents: number | null;
  betriebsergebnisCents: number | null;
  stand: string | null;
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-ink-secondary hover:text-ink">
        Zahlen aktualisieren (neue GuV aus Lexware)
      </summary>
      <ActionForm
        action={saveVorlaeufigesErgebnisAction}
        className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Field label="Umsatzerlöse" required hint="GuV: Umsatzerlöse gesamt">
          <MoneyInput name="umsatzCents" defaultCents={umsatzCents} required />
        </Field>
        <Field label="Wareneinkauf" required hint="GuV: Wareneingang + EU-Erwerb">
          <MoneyInput name="wareneinkaufCents" defaultCents={wareneinkaufCents} required />
        </Field>
        <Field label="Betriebsergebnis lt. Lexware" hint="Optional, mit allen Kosten">
          <MoneyInput name="betriebsergebnisCents" defaultCents={betriebsergebnisCents} />
        </Field>
        <Field label="Stand (GuV-Datum)">
          <Input type="date" name="stand" defaultValue={stand ?? ""} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <SubmitButton size="sm">Speichern</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
