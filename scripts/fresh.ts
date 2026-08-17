/**
 * Frischer Start für den echten Betrieb: löscht ALLE Daten (auch Demo-Daten)
 * und legt nur die Systemeinheiten, Grundeinstellungen und einen Admin an.
 *
 *   npm run db:fresh
 *   ADMIN_EMAIL=ich@firma.de ADMIN_PASSWORD=geheim123 ADMIN_NAME="Elia" npm run db:fresh
 */
import bcrypt from "bcryptjs";
import { db } from "../src/server/db";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@elia-erp.de";
  const password = process.env.ADMIN_PASSWORD ?? "admin1234";
  const name = process.env.ADMIN_NAME ?? "Admin";
  if (password.length < 8) {
    console.error("ADMIN_PASSWORD muss mindestens 8 Zeichen haben.");
    process.exit(1);
  }

  console.log("Lösche alle Daten…");
  const tables = [
    "lotConsumption", "trackingEvent", "customerShipmentItem", "customerShipment",
    "allocation", "customerOrderLine", "customerOrder",
    "purchaseLot", "inventoryTransaction", "goodsReceiptItem", "goodsReceipt",
    "inboundShipmentItem", "inboundShipment",
    "payment", "invoiceLine", "invoice", "cost",
    "purchaseOrderLine", "purchaseOrder",
    "importItem", "importBatch",
    "supplierProductMapping", "unitConversion", "product",
    "note", "auditLog", "activityEvent",
    "customer", "supplier", "session", "user", "unit",
    "counter", "setting", "integrationConfig", "exchangeRate",
  ] as const;
  for (const t of tables) {
    // @ts-expect-error dynamischer Zugriff auf Model-Delegates
    await db[t].deleteMany({});
  }

  console.log("Lege Systemeinheiten an…");
  await db.unit.createMany({
    data: [
      { code: "PIECE", name: "Stück", isSystem: true, sortOrder: 0 },
      { code: "BOX", name: "Box", isSystem: true, sortOrder: 1 },
      { code: "DISPLAY", name: "Display", isSystem: true, sortOrder: 2 },
      { code: "CASE", name: "Case", isSystem: true, sortOrder: 3 },
      { code: "BUNDLE", name: "Bundle", isSystem: true, sortOrder: 4 },
      { code: "PACK", name: "Pack", isSystem: true, sortOrder: 5 },
      { code: "CARTON", name: "Karton", isSystem: true, sortOrder: 6 },
    ],
  });
  await db.setting.createMany({
    data: [
      { key: "defaultCurrency", value: JSON.stringify("EUR") },
      { key: "targetMarginPct", value: JSON.stringify(25) },
    ],
  });
  await db.integrationConfig.create({ data: { provider: "UPS", enabled: true, mode: "MOCK" } });

  await db.user.create({
    data: { email: email.toLowerCase(), name, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" },
  });

  console.log("\nFrischer Start abgeschlossen – Datenbank ist leer.");
  console.log(`Login: ${email} / ${password === "admin1234" ? "admin1234 (BITTE nach dem Login ändern!)" : "(dein gewähltes Passwort)"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
