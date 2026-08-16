import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "./company-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unternehmen" };

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export default async function CompanySettingsPage() {
  const [companyName, defaultCurrency, targetMarginPct] = await Promise.all([
    getSetting("companyName", ""),
    getSetting("defaultCurrency", "EUR"),
    getSetting("targetMarginPct", 25),
  ]);
  return (
    <div>
      <PageHeader title="Unternehmen" backHref="/settings" backLabel="Einstellungen" />
      <CompanyForm defaults={{ companyName, defaultCurrency, targetMarginPct }} />
    </div>
  );
}
