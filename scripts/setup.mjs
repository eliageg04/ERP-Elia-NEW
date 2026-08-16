// Erstellt .env aus .env.example mit zufälligem SESSION_SECRET, falls noch keine existiert.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const envPath = new URL("../.env", import.meta.url);
if (!existsSync(envPath)) {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const secret = randomBytes(32).toString("hex");
  writeFileSync(envPath, example.replace(/SESSION_SECRET=".*"/, `SESSION_SECRET="${secret}"`));
  console.log(".env erstellt (mit zufälligem SESSION_SECRET).");
} else {
  console.log(".env existiert bereits – unverändert.");
}
