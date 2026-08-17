# Elia ERP

Ein produktionsfähiges ERP-System für den Sammelkarten-Großhandel:
**Einkauf → Wareneingang → Lager → Verkauf → Versand → Finanzen** mit
vollständiger Nachvollziehbarkeit aller Warenbewegungen und Kosten.

## Schnellstart

```bash
npm install
npm run setup     # .env erzeugen, Datenbank anlegen, Testdaten einspielen
npm run dev       # http://localhost:3000
```

**Login (Testdaten):**

| Rolle | E-Mail | Passwort |
|---|---|---|
| Admin | `admin@elia-erp.de` | `admin1234` |
| Mitarbeiter | `mitarbeiter@elia-erp.de` | `staff1234` |
| Nur lesen | `leser@elia-erp.de` | `read1234` |

> **Wichtig:** Passwörter nach dem ersten Login unter *Einstellungen → Benutzer* ändern.

## Was das System beantwortet

- **Wo ist meine Ware?** – beim Großhändler, versendet, unterwegs, angekommen,
  auf Lager, reserviert, verkauft, beim Kunden – auf Produkt- und Bestellzeilenebene.
- **Was hat sie tatsächlich gekostet?** – Einkaufspreis + Versand + Zoll + Gebühren,
  Fremdwährung mit eingefrorenem Kurs, als *Landed Cost* je Charge.
- **Was kann ich verlangen?** – gewichteter Ø-Einkaufspreis, Marge vs. Aufschlag
  (strikt getrennt), Zielpreis-Kalkulation.
- **Was habe ich wem verkauft?** – Kundenakte mit Umsatz, Gewinn, Produkten, offenen Posten.
- **Was muss ich heute tun?** – Dashboard mit To-dos und aktiven Warnungen
  (Teillieferungen, überfällige Lieferungen, fehlende Zahlungen, Mengenabweichungen …).

## Module

Dashboard · Vorbestellungen/Einkauf (Ansicht nach Großhändler **und** nach Produkt) ·
Großhändler · Produkte · Wareneingang · Lager (Bestand + Bewegungs-Ledger) · Kunden ·
Kundenbestellungen mit Reservierung · Versand & Tracking (UPS-Abstraktion, Mock/Live) ·
Rechnungen · Zahlungen · Kosten (mit Landed-Cost-Verteilung) · Margen & Reports ·
CSV/XLSX-Import mit Inbox & Produktmatching · Einstellungen (Benutzer, Rollen,
Einheiten, Integrationen, Mappings) · Audit-Log · globale Suche.

## Zentrale Konzepte

- **Single Source of Truth:** Bestand ist die Summe des Bewegungs-Ledgers
  (`InventoryTransaction`), nie ein editierbares Feld.
  Verfügbar = Bestand − aktive Reservierungen.
- **FIFO-Chargen:** Jeder Wareneingang erzeugt eine Charge mit Einstandskosten.
  Jeder Abgang verbraucht Chargen per FIFO und friert die Kosten ein (COGS) –
  dadurch ist für jeden Verkauf nachvollziehbar, aus welchem Einkauf die Ware stammt.
- **Mengeneinheiten:** Erfassung in Cases/Displays/…, Umrechnungsfaktoren pro Produkt
  (z. B. 1 Case = 6 Displays), Lieferanten-spezifische Mappings, die das System beim
  Import-Review lernt.
- **Human-in-the-Loop:** Importe landen in einer Inbox mit Confidence-Score;
  alles ist manuell korrigierbar; jede Änderung landet im Audit-Log (alt → neu, wer, wann, warum).
- **Soft-Delete:** Stornieren/Archivieren statt Löschen – Historie bleibt vollständig.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build && npm start` | Produktion |
| `npm run test` | Tests (Geldrechnung, Warenfluss, FIFO, Integrität) |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run db:seed` | Testdaten neu einspielen (löscht Daten!) |
| `npm run db:fresh` | Frischer Start für den echten Betrieb: alles löschen, nur Einheiten + Admin anlegen |
| `npm run db:backup` | SQLite-Backup nach `backups/` (behält 30 Stände) |
| `npm run db:push` | Schema-Änderungen anwenden |

## Tech-Stack & Entscheidungen

| Bereich | Wahl | Begründung |
|---|---|---|
| Frontend + Backend | Next.js 15 (App Router, Server Actions) | Ein Deployment, API-fähig, RSC-Performance |
| Datenbank | SQLite via Prisma | Zero-Ops für Einzelfirma; Schema portabel zu PostgreSQL (Provider-Wechsel) |
| Auth | Eigene Session-Auth (bcrypt, HTTP-only-Cookies, DB-Sessions) | Transparent, ohne externe Abhängigkeit; Rollen Admin/Mitarbeiter/Nur-lesen |
| UI | Tailwind CSS 4 + eigenes Design-System | Ruhig, schnell, mobil-tauglich (Linear/Stripe-Anmutung) |
| Validierung | Zod + Service-Layer-Regeln + DB-Constraints | Integrität serverseitig erzwungen |
| Tests | Vitest (Unit + Integration gegen echte Test-DB) | Bestands-/Margenlogik ist geschäftskritisch |
| Geldbeträge | Integer-Cents, EUR-Werte mit eingefrorenem Kurs | Keine Float-Fehler, historische Kurse unveränderlich |

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
API: [`docs/API.md`](docs/API.md) · Konventionen: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)

## Integrationen

- **UPS-Tracking:** Carrier-Abstraktion mit Mock-Modus (sofort nutzbar) und
  Live-Adapter für das offizielle UPS Track API (OAuth2-Credentials unter
  *Einstellungen → Integrationen* hinterlegen). Weitere Carrier (DHL/DPD/GLS/FedEx)
  sind über dasselbe Interface anschließbar; manuelles Tracking funktioniert immer.
- **Lexware:** Es existiert kein öffentliches Lexware-API – der Import läuft über
  die Lexware-CSV-Exporte (*System → Import*), Spalten werden automatisch erkannt
  und Produkte per EAN/SKU/gelerntem Mapping/Namensähnlichkeit zugeordnet.
- **PDF/OCR:** Architektur in der Import-Pipeline vorgesehen (nächste Ausbaustufe);
  bis dahin CSV/XLSX.

## Backups

`npm run db:backup` kopiert die SQLite-Datei nach `backups/` (rotierend, 30 Stände).
Für automatische Backups einen Cron-Job einrichten. Die gesamte Datenbank ist eine
einzelne Datei (`prisma/erp.db`) – einfach zu sichern und wiederherzustellen.
