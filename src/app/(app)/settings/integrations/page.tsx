import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Card, Badge } from "@/components/ui";
import { UpsIntegrationForm } from "./integration-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrationen" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/settings");

  const ups = await db.integrationConfig.findUnique({ where: { provider: "UPS" } });
  const hasCredentials = Boolean(ups?.config && JSON.parse(ups.config)?.clientId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Integrationen" backHref="/settings" backLabel="Einstellungen" />

      <Card
        title={
          <span className="flex items-center gap-2">
            UPS Tracking
            {!ups?.enabled ? (
              <Badge>Aus</Badge>
            ) : ups.mode === "LIVE" ? (
              <Badge tone="green">Live</Badge>
            ) : (
              <Badge tone="blue">Mock-Modus</Badge>
            )}
          </span>
        }
      >
        <p className="mb-4 text-sm text-ink-secondary">
          Ruft Tracking-Ereignisse zu Sendungen mit UPS-Trackingnummer ab (Button „Tracking
          aktualisieren“ auf der Sendungsseite). Im Mock-Modus werden deterministische
          Test-Events erzeugt – ideal zum Ausprobieren ohne API-Zugang. Für den Live-Modus
          werden Client-ID/Secret aus dem UPS Developer Portal benötigt (OAuth2, Track API v1).
        </p>
        <UpsIntegrationForm enabled={ups?.enabled ?? false} mode={ups?.mode ?? "MOCK"} hasCredentials={hasCredentials} />
      </Card>

      <Card title="Lexware">
        <p className="text-sm text-ink-secondary">
          Lexware bietet kein öffentliches API. Der zuverlässige Weg ist der{" "}
          <span className="font-medium">CSV-Export aus Lexware</span> (Belege/Artikel), der unter{" "}
          <Link href="/imports" className="font-medium text-accent hover:underline">System → Import</Link>{" "}
          hochgeladen wird. Spalten wie „Artikelnummer“, „Bezeichnung“, „Menge“ und „Einzelpreis“
          werden automatisch erkannt; Produkte werden über EAN, SKU, gelernte Mappings und
          Namensähnlichkeit zugeordnet – mit Prüfung in der Import-Inbox.
        </p>
      </Card>

      <Card title="Weitere Carrier (DHL, DPD, GLS, FedEx)">
        <p className="text-sm text-ink-secondary">
          Die Carrier-Abstraktion ist vorbereitet: Jeder Carrier implementiert dasselbe
          Tracking-Interface und wird zentral registriert. Bis zur Anbindung funktioniert für
          alle Carrier das <span className="font-medium">manuelle Tracking</span> (Trackingnummer,
          Versanddienstleister und Ereignisse von Hand erfassen) – die Sendungsübersicht bleibt
          dadurch vollständig.
        </p>
      </Card>
    </div>
  );
}
