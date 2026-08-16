import { db } from "../db";

// ============================================================
// Carrier-Abstraktion: einheitliche Schnittstelle für Tracking.
// UPS besitzt ein offizielles Track-API (OAuth2, api.ups.com) –
// die Live-Anbindung erfordert Client-ID/Secret in den
// Integrationseinstellungen. Ohne Credentials läuft der
// Mock-Modus; manuelles Tracking funktioniert immer.
// Weitere Carrier (DHL, DPD, GLS, FedEx) implementieren dasselbe
// Interface und werden in CARRIER_ADAPTERS registriert.
// ============================================================

export type CarrierTrackingEvent = {
  status: string; // TRACKING_STATUSES aus constants.ts
  description: string;
  location?: string;
  occurredAt: Date;
};

export interface CarrierAdapter {
  carrier: string;
  /** Aktuelle Tracking-Ereignisse für eine Sendungsnummer abrufen. */
  fetchTracking(trackingNumber: string): Promise<CarrierTrackingEvent[]>;
}

/** Mock-Adapter: deterministische Beispiel-Events für Test/Demo. */
class MockUpsAdapter implements CarrierAdapter {
  carrier = "UPS";
  async fetchTracking(trackingNumber: string): Promise<CarrierTrackingEvent[]> {
    // Deterministisch aus der Trackingnummer abgeleitet (kein Zufall)
    const seed = [...trackingNumber].reduce((a, c) => a + c.charCodeAt(0), 0);
    const steps = (seed % 4) + 1;
    const base = Date.now() - steps * 86_400_000;
    const all: CarrierTrackingEvent[] = [
      { status: "LABEL_CREATED", description: "Versandetikett erstellt", occurredAt: new Date(base) },
      { status: "PICKED_UP", description: "Vom Absender abgeholt", location: "Abholstation", occurredAt: new Date(base + 6 * 3_600_000) },
      { status: "IN_TRANSIT", description: "Im Transit", location: "Sortierzentrum Köln", occurredAt: new Date(base + 86_400_000) },
      { status: "OUT_FOR_DELIVERY", description: "In Zustellung", location: "Zustellbasis", occurredAt: new Date(base + 2 * 86_400_000) },
      { status: "DELIVERED", description: "Zugestellt", location: "Empfänger", occurredAt: new Date(base + 2 * 86_400_000 + 4 * 3_600_000) },
    ];
    return all.slice(0, steps + 1);
  }
}

/**
 * UPS-Live-Adapter (Track API v1, OAuth2 Client Credentials).
 * Wird nur genutzt, wenn Integration UPS auf LIVE steht und
 * clientId/clientSecret hinterlegt sind.
 */
class UpsLiveAdapter implements CarrierAdapter {
  carrier = "UPS";
  constructor(private clientId: string, private clientSecret: string) {}

  private async getToken(): Promise<string> {
    const res = await fetch("https://onlinetools.ups.com/security/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`UPS OAuth fehlgeschlagen (${res.status})`);
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  async fetchTracking(trackingNumber: string): Promise<CarrierTrackingEvent[]> {
    const token = await this.getToken();
    const res = await fetch(
      `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
      { headers: { Authorization: `Bearer ${token}`, transId: crypto.randomUUID(), transactionSrc: "elia-erp" } }
    );
    if (!res.ok) throw new Error(`UPS Track API fehlgeschlagen (${res.status})`);
    const data = (await res.json()) as {
      trackResponse?: {
        shipment?: Array<{
          package?: Array<{
            activity?: Array<{
              status?: { description?: string; type?: string };
              location?: { address?: { city?: string; countryCode?: string } };
              date?: string;
              time?: string;
            }>;
          }>;
        }>;
      };
    };
    const activities = data.trackResponse?.shipment?.[0]?.package?.[0]?.activity ?? [];
    const mapType: Record<string, string> = {
      D: "DELIVERED",
      I: "IN_TRANSIT",
      P: "PICKED_UP",
      M: "LABEL_CREATED",
      X: "EXCEPTION",
      O: "OUT_FOR_DELIVERY",
    };
    return activities.map((a) => ({
      status: mapType[a.status?.type ?? ""] ?? "IN_TRANSIT",
      description: a.status?.description ?? "Statusaktualisierung",
      location: a.location?.address?.city,
      occurredAt: parseUpsDate(a.date, a.time),
    }));
  }
}

function parseUpsDate(date?: string, time?: string): Date {
  if (!date) return new Date();
  const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const t = time && time.length >= 6 ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : "12:00:00";
  return new Date(`${d}T${t}`);
}

/** Adapter für einen Carrier auflösen (LIVE wenn konfiguriert, sonst Mock). */
export async function getCarrierAdapter(carrier: string): Promise<CarrierAdapter | null> {
  if (carrier !== "UPS") return null; // weitere Carrier: hier registrieren
  const config = await db.integrationConfig.findUnique({ where: { provider: "UPS" } });
  if (config?.enabled && config.mode === "LIVE" && config.config) {
    try {
      const { clientId, clientSecret } = JSON.parse(config.config) as {
        clientId?: string;
        clientSecret?: string;
      };
      if (clientId && clientSecret) return new UpsLiveAdapter(clientId, clientSecret);
    } catch {
      // fällt auf Mock zurück
    }
  }
  if (config?.enabled) return new MockUpsAdapter();
  return null;
}

/**
 * Tracking einer Sendung aktualisieren (manuell angestoßen oder als Job).
 * Schreibt neue Events und aktualisiert den Sendungsstatus.
 */
export async function refreshTracking(params: {
  shipmentType: "INBOUND" | "CUSTOMER";
  shipmentId: string;
}): Promise<{ added: number } | { error: string }> {
  const shipment =
    params.shipmentType === "INBOUND"
      ? await db.inboundShipment.findUnique({ where: { id: params.shipmentId } })
      : await db.customerShipment.findUnique({ where: { id: params.shipmentId } });
  if (!shipment?.trackingNumber || !shipment.carrier) {
    return { error: "Keine Trackingnummer oder kein Carrier hinterlegt." };
  }
  const adapter = await getCarrierAdapter(shipment.carrier);
  if (!adapter) {
    return { error: `Für ${shipment.carrier} ist keine automatische Abfrage konfiguriert (Integrationen prüfen). Manuelles Tracking bleibt möglich.` };
  }
  let events: CarrierTrackingEvent[];
  try {
    events = await adapter.fetchTracking(shipment.trackingNumber);
  } catch (err) {
    return { error: `Tracking-Abruf fehlgeschlagen: ${err instanceof Error ? err.message : "unbekannt"}` };
  }

  const fk =
    params.shipmentType === "INBOUND"
      ? { inboundShipmentId: shipment.id }
      : { customerShipmentId: shipment.id };
  const existing = await db.trackingEvent.findMany({ where: fk });
  const known = new Set(existing.map((e) => `${e.status}|${e.occurredAt.getTime()}`));
  let added = 0;
  for (const ev of events) {
    if (known.has(`${ev.status}|${ev.occurredAt.getTime()}`)) continue;
    await db.trackingEvent.create({
      data: { ...fk, status: ev.status, description: ev.description, location: ev.location ?? null, occurredAt: ev.occurredAt, source: adapter.carrier },
    });
    added++;
  }

  // Sendungsstatus aus letztem Event ableiten (nur vorwärts, nie zurück)
  const latest = events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (latest) {
    if (params.shipmentType === "INBOUND" && latest.status === "DELIVERED" && shipment.status === "IN_TRANSIT") {
      // Zustellung beim Lager ≠ gebuchter Wareneingang – Status bleibt bis zur WE-Buchung "unterwegs",
      // aber das Event ist sichtbar. Kein automatischer Bestandseingang ohne menschliche Bestätigung.
    } else if (params.shipmentType === "CUSTOMER") {
      if (latest.status === "DELIVERED" && ["SHIPPED", "IN_TRANSIT"].includes(shipment.status)) {
        await db.customerShipment.update({
          where: { id: shipment.id },
          data: { status: "DELIVERED", deliveredAt: latest.occurredAt },
        });
      } else if (latest.status === "IN_TRANSIT" && shipment.status === "SHIPPED") {
        await db.customerShipment.update({ where: { id: shipment.id }, data: { status: "IN_TRANSIT" } });
      }
    }
  }
  return { added };
}
