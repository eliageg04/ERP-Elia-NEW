# API-Dokumentation

Alle Endpunkte liegen unter `/api/v1/` und erfordern eine **angemeldete Session**
(HTTP-only-Cookie `erp_session`, gesetzt über den Login). Ohne gültige Session:
`401 {"error": "Nicht angemeldet"}`. Schreibende Endpunkte erfordern mindestens
die Rolle *Mitarbeiter* (`403` bei *Nur lesen*).

Alle Geldbeträge sind **Integer-Cents**; Felder mit `EurCents` sind mit dem
eingefrorenen Kurs in EUR umgerechnet. Mengen sind Integer in der Basiseinheit
des Produkts.

## Suche

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/search?q=<text>` | Globale Suche über Produkte, Bestellungen, Kunden, Lieferanten, Rechnungen, Trackingnummern |

Antwort: `{ "results": [{ "type", "title", "subtitle", "href" }] }`

## Produkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/products?q=&page=` | Produktliste inkl. Bestand (onHand/reserved/available), 50 pro Seite |
| POST | `/api/v1/products` | Produkt anlegen |

POST-Body (JSON, Zod-validiert):

```json
{
  "name": "Pokémon Scarlet & Violet 151 Booster Display",
  "baseUnitCode": "DISPLAY",
  "sku": "optional – sonst automatisch PRD-XXXX",
  "setName": "Scarlet & Violet 151",
  "language": "EN",
  "ean": "0820650854187",
  "productType": "Booster Display",
  "listPriceCents": 18900
}
```

Fehler: `400` mit `details` (Zod-Fehlerstruktur) bzw. unbekannter Einheiten-Code.

## Lager

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/inventory` | Bestand je Produkt: `onHand`, `reserved`, `available`, `inTransit` |

## Einkauf

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/purchase-orders?status=&page=` | Bestellungen inkl. Zeilen mit `shipped`/`arrived`/`open` je Zeile |

## Verkauf

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/customer-orders?status=&page=` | Kundenbestellungen inkl. Zeilen mit `allocated`/`shipped`/`delivered` |

## Stammdaten

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/customers?q=` | Kundenliste |
| GET | `/api/v1/suppliers?q=` | Lieferantenliste |

## Finanzen

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/invoices?status=&type=` | Rechnungen inkl. `paidEurCents` / `openEurCents` |

## Export (CSV)

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/v1/export?type=<typ>[&from=&to=]` | CSV-Download (Semikolon-getrennt, UTF-8 BOM, deutsche Dezimalformate) |

Gültige `type`-Werte: `products`, `inventory`, `customers`, `suppliers`,
`invoices`, `payments`, `profit-by-product`, `revenue-by-customer`,
`purchases-by-supplier`, `purchases-by-product`.
`from`/`to` (ISO-Datum, z.B. `2026-08-01`) filtern zeitraumbezogene Reports.

## Statuswerte

- Einkaufsbestellung: `DRAFT, ORDERED, CONFIRMED, PARTIALLY_SHIPPED, SHIPPED, PARTIALLY_RECEIVED, RECEIVED, COMPLETED, CANCELLED`
- Kundenbestellung: `DRAFT, CONFIRMED, PARTIALLY_SHIPPED, SHIPPED, PARTIALLY_DELIVERED, DELIVERED, COMPLETED, CANCELLED`
- Rechnung: `OPEN, PARTIALLY_PAID, PAID, CANCELLED`
- Sendung (eingehend): `ANNOUNCED, IN_TRANSIT, DELAYED, PARTIALLY_ARRIVED, ARRIVED, CANCELLED`
- Sendung (Kunde): `PREPARED, SHIPPED, IN_TRANSIT, DELIVERED, CANCELLED`

## Interne Architektur

Die REST-Routen sind bewusst dünne Schichten über dem Service-Layer
(`src/server/services/*`), in dem alle Geschäftsregeln liegen. Die Web-UI nutzt
denselben Service-Layer über Server Actions – Regeln gelten damit überall
identisch (API-first-Prinzip). Neue Endpunkte sollten dem gleichen Muster folgen.
