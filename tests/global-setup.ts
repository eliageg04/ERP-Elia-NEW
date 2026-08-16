// Läuft einmal vor allen Tests: Test-Datenbank anlegen.
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
