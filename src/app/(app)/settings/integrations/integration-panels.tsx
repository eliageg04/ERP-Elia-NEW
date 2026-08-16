"use client";

import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/form";
import { updateIntegrationAction } from "@/server/actions/settings";

export function UpsIntegrationForm({
  enabled,
  mode,
  hasCredentials,
}: {
  enabled: boolean;
  mode: string;
  hasCredentials: boolean;
}) {
  return (
    <ActionForm action={updateIntegrationAction} className="flex flex-col gap-3">
      <input type="hidden" name="provider" value="UPS" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Tracking-Abfrage aktivieren
      </label>
      <Field label="Modus" hint="Mock: deterministische Test-Events ohne echte API. Live: offizielles UPS Track API (OAuth2).">
        <Select name="mode" defaultValue={mode}>
          <option value="MOCK">Mock (Testmodus)</option>
          <option value="LIVE">Live (echte UPS-API)</option>
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client-ID" hint={hasCredentials ? "Gespeichert – nur ausfüllen zum Ändern" : "Aus dem UPS Developer Portal"}>
          <Input name="clientId" placeholder={hasCredentials ? "••••••••" : ""} autoComplete="off" />
        </Field>
        <Field label="Client-Secret" hint={hasCredentials ? "Gespeichert – nur ausfüllen zum Ändern" : ""}>
          <Input type="password" name="clientSecret" placeholder={hasCredentials ? "••••••••" : ""} autoComplete="off" />
        </Field>
      </div>
      <p className="text-xs text-ink-tertiary">
        Credentials werden nur serverseitig gespeichert und niemals im Frontend angezeigt.
      </p>
      <div>
        <SubmitButton size="sm">Speichern</SubmitButton>
      </div>
    </ActionForm>
  );
}
