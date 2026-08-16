/**
 * Datenbank-Backup: kopiert die SQLite-Datei mit Zeitstempel nach backups/
 * und behält die letzten 30 Backups. Für automatische Backups per Cron:
 *   0 3 * * * cd /pfad/zum/erp && npm run db:backup
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

const dbPath = path.join(process.cwd(), "prisma", "erp.db");
const backupDir = path.join(process.cwd(), "backups");

if (!existsSync(dbPath)) {
  console.error("Keine Datenbank gefunden unter", dbPath);
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.join(backupDir, `erp-${stamp}.db`);
copyFileSync(dbPath, target);
console.log("Backup erstellt:", target);

// Aufräumen: nur die letzten 30 Backups behalten
const backups = readdirSync(backupDir)
  .filter((f) => f.startsWith("erp-") && f.endsWith(".db"))
  .sort()
  .reverse();
for (const old of backups.slice(30)) {
  unlinkSync(path.join(backupDir, old));
  console.log("Altes Backup entfernt:", old);
}
