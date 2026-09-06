/**
 * Idempotente Grundeinrichtung – läuft bei jedem Deployment (Vercel)
 * und kann jederzeit gefahrlos erneut ausgeführt werden:
 * - legt Systemeinheiten an, falls sie fehlen
 * - legt Grundeinstellungen an, falls sie fehlen
 * - legt einen Admin an, falls noch KEIN Benutzer existiert
 *   (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME aus den Umgebungsvariablen)
 * - Notfall-Passwort-Reset: Ist ADMIN_PASSWORD_RESET=true gesetzt, wird das
 *   Passwort des Benutzers ADMIN_EMAIL beim Deployment auf ADMIN_PASSWORD
 *   gesetzt (Zugriff auf die Vercel-Umgebungsvariablen ist der Nachweis).
 *   Die Variable danach wieder entfernen, sonst setzt JEDES Deployment
 *   das Passwort erneut zurück.
 *
 * Bestehende Daten werden sonst niemals verändert oder gelöscht.
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
    // Vorläufiges Jahresergebnis aus der Lexware-GuV (Stand 06.09.2026);
    // wird nur angelegt, falls noch nicht vorhanden – editierbar unter Reports.
    [
      "vorlaeufigesErgebnis",
      { umsatzCents: 528781085, wareneinkaufCents: 445401427, betriebsergebnisCents: 72901242, stand: "2026-09-06" },
    ],
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
    const email = (process.env.ADMIN_EMAIL ?? "admin@elia-erp.de").toLowerCase().trim();
    const password = (process.env.ADMIN_PASSWORD ?? "admin1234").trim();
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

  // Notfall-Reset: nur aktiv, wenn die Variable explizit gesetzt ist
  // (tolerant gegenüber Schreibweisen: true/TRUE/1/yes/ja)
  const resetFlag = (process.env.ADMIN_PASSWORD_RESET ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "ja"].includes(resetFlag)) {
    const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
    // trim: beim Einfügen in Vercel landen leicht unsichtbare Leerzeichen/Zeilenumbrüche im Wert
    const password = (process.env.ADMIN_PASSWORD ?? "").trim();
    if (!email || password.length < 8) {
      console.error(
        "ADMIN_PASSWORD_RESET=true gesetzt, aber ADMIN_EMAIL fehlt oder ADMIN_PASSWORD hat weniger als 8 Zeichen – Reset übersprungen."
      );
    } else {
      const passwordHash = await bcrypt.hash(password, 10);
      const existing = await db.user.findUnique({ where: { email } });
      const user = existing
        ? await db.user.update({ where: { email }, data: { passwordHash, active: true } })
        : await db.user.create({
            data: { email, name: process.env.ADMIN_NAME ?? "Admin", passwordHash, role: "ADMIN" },
          });
      // Alle Sitzungen dieses Benutzers beenden (Reset macht alte Logins ungültig)
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.auditLog.create({
        data: {
          entityType: "USER",
          entityId: user.id,
          action: "UPDATE",
          comment: existing
            ? "Passwort per Deployment-Reset (ADMIN_PASSWORD_RESET) zurückgesetzt"
            : "Admin per Deployment-Reset (ADMIN_PASSWORD_RESET) neu angelegt",
        },
      });
      console.log(
        `Passwort-Reset ausgeführt für ${email}. WICHTIG: Die Variable ADMIN_PASSWORD_RESET jetzt in Vercel wieder löschen!`
      );
    }
  }
  console.log("Grundeinrichtung abgeschlossen.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
