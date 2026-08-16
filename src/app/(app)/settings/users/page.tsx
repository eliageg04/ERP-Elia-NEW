import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Table, THead, Th, Td, Tr, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/constants";
import { CreateUserForm, UserRowActions } from "./user-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Benutzer & Rollen" };

export default async function UsersPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "ADMIN") redirect("/settings");

  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Benutzer & Rollen"
        subtitle="Admin: Vollzugriff · Mitarbeiter: operativer Zugriff · Nur lesen: keine Änderungen. Berechtigungen werden serverseitig geprüft."
        backHref="/settings"
        backLabel="Einstellungen"
      />
      <CreateUserForm />
      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>E-Mail</Th>
            <Th>Rolle</Th>
            <Th>Status</Th>
            <Th>Erstellt</Th>
            <Th align="right">Aktionen</Th>
          </tr>
        </THead>
        <tbody>
          {users.map((u) => (
            <Tr key={u.id} muted={!u.active}>
              <Td className="font-medium">
                {u.name}
                {u.id === currentUser.id && <span className="ml-1 text-xs text-ink-tertiary">(du)</span>}
              </Td>
              <Td>{u.email}</Td>
              <Td><Badge tone={u.role === "ADMIN" ? "violet" : "neutral"}>{label(u.role)}</Badge></Td>
              <Td>{u.active ? <Badge tone="green">Aktiv</Badge> : <Badge tone="red">Deaktiviert</Badge>}</Td>
              <Td>{formatDate(u.createdAt)}</Td>
              <Td>
                <UserRowActions userId={u.id} role={u.role} active={u.active} isSelf={u.id === currentUser.id} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
