"use client";

import { ActionForm, ActionButton, Field, Input, Select, SubmitButton } from "@/components/form";
import { Card } from "@/components/ui";
import {
  createUserAction,
  setUserRoleAction,
  toggleUserActiveAction,
  resetPasswordAction,
} from "@/server/actions/users";

export function CreateUserForm() {
  return (
    <Card title="Neuen Benutzer anlegen">
      <ActionForm action={createUserAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" required>
          <Input name="name" required />
        </Field>
        <Field label="E-Mail" required>
          <Input type="email" name="email" required />
        </Field>
        <Field label="Passwort" required hint="Mindestens 8 Zeichen">
          <Input type="password" name="password" required minLength={8} />
        </Field>
        <Field label="Rolle" required>
          <Select name="role" defaultValue="STAFF">
            <option value="ADMIN">Admin (Vollzugriff)</option>
            <option value="STAFF">Mitarbeiter (operativ)</option>
            <option value="READONLY">Nur lesen</option>
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <SubmitButton size="sm">Benutzer anlegen</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

export function UserRowActions({
  userId,
  role,
  active,
  isSelf,
}: {
  userId: string;
  role: string;
  active: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ActionForm action={setUserRoleAction} className="flex items-center gap-1">
        <input type="hidden" name="id" value={userId} />
        <Select name="role" defaultValue={role} className="!w-auto text-xs">
          <option value="ADMIN">Admin</option>
          <option value="STAFF">Mitarbeiter</option>
          <option value="READONLY">Nur lesen</option>
        </Select>
        <SubmitButton variant="ghost" size="sm">Rolle speichern</SubmitButton>
      </ActionForm>
      <ActionForm action={resetPasswordAction} className="flex items-center gap-1">
        <input type="hidden" name="id" value={userId} />
        <Input type="password" name="password" placeholder="Neues Passwort" minLength={8} className="!w-36 text-xs" />
        <SubmitButton variant="ghost" size="sm">Setzen</SubmitButton>
      </ActionForm>
      {!isSelf && (
        <ActionButton
          action={toggleUserActiveAction}
          variant={active ? "danger" : "secondary"}
          hiddenFields={{ id: userId }}
          confirmMessage={active ? "Benutzer deaktivieren? Alle Sitzungen werden beendet." : "Benutzer reaktivieren?"}
        >
          {active ? "Deaktivieren" : "Aktivieren"}
        </ActionButton>
      )}
    </div>
  );
}
