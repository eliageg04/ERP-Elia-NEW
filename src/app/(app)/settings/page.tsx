import Link from "next/link";
import { getCurrentUser } from "@/server/auth";
import { PageHeader, Card } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Einstellungen" };

const SECTIONS = [
  { href: "/settings/company", title: "Unternehmen", desc: "Firmenname, Standardwährung, Zielmarge" },
  { href: "/settings/units", title: "Einheiten", desc: "Stück, Box, Case, Display … und eigene Einheiten" },
  { href: "/settings/users", title: "Benutzer & Rollen", desc: "Admin, Mitarbeiter, Nur-lesen (nur Admin)" },
  { href: "/settings/integrations", title: "Integrationen", desc: "UPS-Tracking, Lexware-Import, weitere Carrier" },
  { href: "/settings/mappings", title: "Produkt-Mappings", desc: "Gelernte Lieferanten-Bezeichnungen und Einheiten-Faktoren" },
  { href: "/audit-log", title: "Audit Log", desc: "Alle Änderungen nachvollziehen (wer, wann, was)" },
];

export default async function SettingsPage() {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Einstellungen" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-canvas">
            <h2 className="text-sm font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{s.desc}</p>
          </Link>
        ))}
      </div>

      <Card title="Datenexport">
        <p className="mb-3 text-sm text-ink-secondary">
          Alle Kerndaten als CSV (Semikolon-getrennt, Excel-kompatibel):
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            ["products", "Produkte"],
            ["inventory", "Bestand"],
            ["customers", "Kunden"],
            ["suppliers", "Großhändler"],
            ["invoices", "Rechnungen"],
            ["payments", "Zahlungen"],
          ].map(([type, label]) => (
            <a
              key={type}
              href={`/api/v1/export?type=${type}`}
              className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
            >
              {label}
            </a>
          ))}
        </div>
      </Card>

      <Card title="Backups">
        <p className="text-sm text-ink-secondary">
          Die gesamte Datenbank ist eine einzelne SQLite-Datei (<code className="rounded bg-canvas px-1">prisma/erp.db</code>).
          Mit <code className="rounded bg-canvas px-1">npm run db:backup</code> wird eine zeitgestempelte Kopie unter{" "}
          <code className="rounded bg-canvas px-1">backups/</code> abgelegt (rotierend, 30 Stände).
          Für automatische Backups einen täglichen Cron-Job einrichten – Details im README.
        </p>
      </Card>

      {user?.role !== "ADMIN" && (
        <p className="text-sm text-ink-tertiary">
          Hinweis: Benutzerverwaltung und Integrationen erfordern Admin-Rechte.
        </p>
      )}
    </div>
  );
}
