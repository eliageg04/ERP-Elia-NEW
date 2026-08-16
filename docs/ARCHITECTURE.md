# Architektur

## Überblick

```
Browser (RSC + minimale Client-Komponenten)
   │
   ├─ Server Components (Seiten)  ──┐
   ├─ Server Actions (Mutationen) ──┤──▶  Service-Layer (Geschäftslogik)
   └─ REST-API /api/v1/*          ──┘         │
                                              ▼
                                     Prisma ORM ▶ SQLite (WAL)
```

- **Alle Geschäftsregeln liegen im Service-Layer** (`src/server/services/`).
  UI (Server Actions/Seiten) und REST-API sind dünne Schichten darüber –
  das Frontend greift nie direkt „unkontrolliert“ auf die Datenbank zu.
- **Serverseitige Berechtigungsprüfung** in jeder Action (`requireRole`),
  Session-Validierung in jedem Request (`requireUser`), Middleware nur als
  schneller Redirect.

## Datenfluss Einkauf → Verkauf (Kernkette)

```
PurchaseOrder ──▶ PurchaseOrderLine (Menge × Einheit × Faktor, Preis, Währung+Kurs)
      │                 │
      │        InboundShipment(+Items)  ─ Tracking ─ TrackingEvents
      │                 │
      │        GoodsReceipt(+Items: OK/beschädigt/fehlend)
      │                 │
      │                 ▼
      │        InventoryTransaction (+qty)  +  PurchaseLot (Menge, EK, Landed Cost)
      │                                             │ FIFO
CustomerOrder ─▶ CustomerOrderLine ─ Allocation ────┤
      │                 │                           ▼
      │        CustomerShipment(+Items) ──▶ InventoryTransaction (−qty)
      │                 │                    + LotConsumption (eingefrorene COGS)
      │                 ▼
Invoice ─ Payment                    Marge = Umsatz − Σ COGS
```

## Bestandslogik (wichtigste Invarianten)

1. `onHand(product) = Σ InventoryTransaction.qty` – der Bestand ist **immer**
   die Ledger-Summe, nie ein gespeichertes Feld.
2. Jede **positive** Bewegung erzeugt eine `PurchaseLot`-Charge (Menge, EK, Landed Cost).
   Jede **negative** Bewegung verbraucht Chargen per FIFO und protokolliert den
   Verbrauch in `LotConsumption` → `Σ lots.qtyRemaining == onHand`.
3. **Reservierungen** (`Allocation`, Status ACTIVE) verändern den physischen
   Bestand nicht: `available = onHand − Σ aktive Reservierungen`.
   Beim Versand wechseln Reservierungen auf SHIPPED und der Bestand wird ausgebucht.
4. Harte Integritätsregeln in den Services (in Transaktionen):
   - versendet ≤ bestellt und angekommen ≤ bestellt je Bestellzeile,
   - Reservierung ≤ verfügbar, Versand ≤ reserviert,
   - kein negativer Bestand (außer explizite Admin-Korrektur).
5. **Statusableitung**: PO-/CO-Status werden aus den Mengen abgeleitet
   (`derivePoStatus`/`deriveCoStatus`). Manuelle Overrides sind möglich
   (`statusOverridden` + Begründung) und werden als Warnung angezeigt.

## Kosten & Währungen

- Alle Beträge: **Integer-Cents**. Fremdwährungsbeträge tragen `currency` +
  `fxRate` (EUR pro Einheit, **eingefroren** bei Buchung) + `…EurCents`.
- **Landed Cost:** Nebenkosten (`Cost`: Versand/Zoll/Gebühren) werden per
  Largest-Remainder-Verfahren (`apportionCents`) ohne Rundungsverlust auf die
  Bestellzeilen verteilt – standardmäßig nach Warenwert, alternativ nach Menge.
  Chargen speichern `unitCostEurCents` (Ware) und `landedUnitCostEurCents`
  (inkl. Nebenkosten). Nachträgliche Kosten aktualisieren die Chargen;
  bereits verbrauchte Mengen behalten ihre eingefrorenen COGS.
- **Marge vs. Aufschlag** sind zentral definiert (`margin`, `markup` in
  `src/lib/money.ts`) und werden nie verwechselt.

## Historie & Nachvollziehbarkeit

- `AuditLog`: Feldänderungen (wer, wann, Feld, alt → neu, Kommentar).
- `ActivityEvent`: Geschäftsereignisse (PURCHASE_ORDER_CREATED, SHIPMENT_SENT,
  GOODS_RECEIVED, INVENTORY_ALLOCATED, CUSTOMER_ORDER_SHIPPED, PAYMENT_RECEIVED …).
- `Note`: chronologische Notizen an jeder wichtigen Entität.
- Beide Ströme werden auf Detailseiten als gemeinsame Timeline angezeigt
  (`HistoryPanel`).

## Import-Pipeline

```
Datei (CSV/XLSX, auch Lexware-Export)
  → Hash-Duplikatprüfung (SHA-256)
  → Parsen + Spalten-Aliase (deutsch/englisch/Lexware)
  → Produktmatching: EAN → SKU → gelerntes Lieferanten-Mapping
      → normalisierte Namensähnlichkeit (Trigramme)
  → ImportBatch/ImportItems mit Confidence (0–100) in der Inbox
  → manuelle Prüfung (Übernehmen/Bearbeiten/Verwerfen)
  → Übernahme erzeugt Entwurfs-Bestellung/Produkte + lernt Mappings
```

Duplikate zusätzlich auf Belegebene: externe Rechnungsnummer je Lieferant ist
einmalig (nicht stornierte Rechnungen).

## Carrier-Abstraktion

`CarrierAdapter`-Interface (`fetchTracking`) mit UPS-Live-Adapter
(offizielles Track API v1, OAuth2) und deterministischem Mock-Adapter.
Konfiguration pro Provider in `IntegrationConfig` (MOCK/LIVE, Credentials nur
serverseitig). Neue Carrier werden in `getCarrierAdapter` registriert.
Wichtig: Eine „zugestellt“-Meldung des Carriers bucht **nie** automatisch
Bestand ein – der Wareneingang bleibt eine menschliche Bestätigung.

## Sicherheit

- Sessions: 32-Byte-Token, SHA-256-gehasht in DB, HTTP-only/SameSite-Cookies, 14 Tage.
- Passwörter: bcrypt (Cost 10). Rollen: ADMIN > STAFF > READONLY,
  serverseitig geprüft (`requireRole`) – nie nur im UI versteckt.
- Secrets (`SESSION_SECRET`, Carrier-Credentials) nur serverseitig; keine API-Keys im Frontend.
- Eingaben: Zod-Validierung + Prisma-Parameterisierung (kein SQL-Injection-Risiko).

## Performance

- Listen paginiert/limitiert, Aggregationen über `groupBy` statt N+1 wo möglich,
  Indizes auf allen FK-/Status-/Datums-Spalten und Belegnummern.
- SQLite im WAL-Modus trägt diese Firma problemlos; bei Wachstum:
  Provider in `schema.prisma` auf PostgreSQL stellen, `db push`, fertig
  (keine SQLite-spezifischen Queries im Code).

## Erweiterbarkeit

- Neue Module: Ordner unter `src/app/(app)/` + Actions-Datei + ggf. Service.
- Neue Carrier/Integrationen: Adapter-Interface implementieren + registrieren.
- Feinere Berechtigungen: `requireRole` ist die einzige Stelle, die erweitert werden muss.
- Hintergrund-Jobs (Tracking-Refresh, Warnungen) sind als aufrufbare Service-
  Funktionen gebaut – per Cron (`npm run …`/API-Call) oder späterem Queue-System auslösbar.
