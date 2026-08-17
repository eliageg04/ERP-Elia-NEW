/**
 * Idempotente Grundeinrichtung – läuft bei jedem Deployment (Vercel)
 * und kann jederzeit gefahrlos erneut ausgeführt werden:
 * - legt Systemeinheiten an, falls sie fehlen
 * - legt Grundeinstellungen an, falls sie fehlen
 * - legt einen Admin an, falls noch KEIN Benutzer existiert
 *   (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME aus den Umgebungsvariablen)
 *
 * Bestehende Daten werden niemals verändert oder gelöscht.
 */
import bcrypt from "bcryptjs";
import { db } from "../src/server/db";

async function main() {
  const units = [
    { code: "PIECE", name: "Stück", sortOrder: 0 },
    { code: "BOX", name: "Box", sortOrder: 1 },
    { code: "DISPLAY", name: "Display", sortOrder: 2 },
    { code: "CASE", name: "Case", sortOrder: 3 },
    { code: "BUNDLE", name: "Bundle", sortOrder: 4 },
    { code: "PACK", name: "Pack", sortOrder: 5 },
    { code: "CARTON", name: "Karton", sortOrder: 6 },
  ];
  for (const u of units) {
    await db.unit.upsert({
      where: { code: u.code },
      create: { ...u, isSystem: true },
      update: {},
    });
  }

  const settings: Array<[string, unknown]> = [
    ["defaultCurrency", "EUR"],
    ["targetMarginPct", 25],
  ];
  for (const [key, value] of settings) {
    await db.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: {},
    });
  }

  await db.integrationConfig.upsert({
    where: { provider: "UPS" },
    create: { provider: "UPS", enabled: true, mode: "MOCK" },
    update: {},
  });

  const userCount = await db.user.count();
  if (userCount === 0) {
    const email = (process.env.ADMIN_EMAIL ?? "admin@elia-erp.de").toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? "admin1234";
    const name = process.env.ADMIN_NAME ?? "Admin";
    if (password.length < 8) {
      console.error("ADMIN_PASSWORD muss mindestens 8 Zeichen haben.");
      process.exit(1);
    }
    await db.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" },
    });
    console.log(`Admin angelegt: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log("WARNUNG: Standard-Passwort admin1234 aktiv – bitte nach dem ersten Login ändern!");
    }
  } else {
    console.log(`Benutzer vorhanden (${userCount}) – kein neuer Admin angelegt.`);
  }
  console.log("Grundeinrichtung abgeschlossen.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
