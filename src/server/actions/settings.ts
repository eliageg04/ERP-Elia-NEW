"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit } from "../audit";
import { runAction, str, optStr, optNum } from "./helpers";
import type { ActionState } from "@/components/form";

export async function saveCompanySettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("ADMIN");
    const entries: Array<[string, unknown]> = [
      ["companyName", str(formData, "companyName")],
      ["defaultCurrency", str(formData, "defaultCurrency") || "EUR"],
      ["targetMarginPct", optNum(formData, "targetMarginPct") ?? 25],
    ];
    for (const [key, value] of entries) {
      await db.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      });
    }
    await writeAudit({
      userId: user.id,
      entityType: "SETTING",
      entityId: "company",
      action: "UPDATE",
      comment: "Unternehmenseinstellungen gespeichert",
    });
  });
}

export async function createUnitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const name = str(formData, "name");
    if (!name) throw new AppError("Bitte einen Namen für die Einheit angeben.");
    const code = name
      .toUpperCase()
      .replace(/Ä/g, "AE").replace(/Ö/g, "OE").replace(/Ü/g, "UE").replace(/ß/g, "SS")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!code) throw new AppError("Aus dem Namen konnte kein gültiger Code erzeugt werden.");
    const existing = await db.unit.findUnique({ where: { code } });
    if (existing) throw new AppError(`Eine Einheit mit dem Code ${code} existiert bereits.`);
    const maxSort = await db.unit.aggregate({ _max: { sortOrder: true } });
    const unit = await db.unit.create({
      data: { code, name, isSystem: false, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
    });
    await writeAudit({
      userId: user.id,
      entityType: "UNIT",
      entityId: unit.id,
      action: "CREATE",
      comment: `Einheit ${name} (${code}) angelegt`,
    });
  });
}

export async function deleteUnitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const unit = await db.unit.findUniqueOrThrow({ where: { id } });
    if (unit.isSystem) throw new AppError("Systemeinheiten können nicht gelöscht werden.");
    const [asBase, inConversions, inPoLines] = await Promise.all([
      db.product.count({ where: { baseUnitId: id } }),
      db.unitConversion.count({ where: { unitId: id } }),
      db.purchaseOrderLine.count({ where: { enteredUnitId: id } }),
    ]);
    if (asBase + inConversions + inPoLines > 0) {
      throw new AppError(
        `Die Einheit wird noch verwendet (${asBase} Produkte, ${inConversions} Umrechnungen, ${inPoLines} Bestellzeilen) und kann nicht gelöscht werden.`
      );
    }
    await db.unit.delete({ where: { id } });
    await writeAudit({
      userId: user.id,
      entityType: "UNIT",
      entityId: id,
      action: "DELETE",
      comment: `Einheit ${unit.name} gelöscht`,
    });
  });
}

export async function updateIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("ADMIN");
    const provider = str(formData, "provider");

    if (provider === "AI") {
      const enabled = formData.get("enabled") === "on";
      const apiKey = optStr(formData, "apiKey");
      const existing = await db.integrationConfig.findUnique({ where: { provider } });
      const prev = existing?.config ? (JSON.parse(existing.config) as Record<string, string>) : {};
      const merged = { apiKey: apiKey ?? prev.apiKey };
      if (enabled && !merged.apiKey && !process.env.ANTHROPIC_API_KEY) {
        throw new AppError("Bitte einen Anthropic-API-Schlüssel eintragen (console.anthropic.com).");
      }
      await db.integrationConfig.upsert({
        where: { provider },
        create: { provider, enabled, mode: "LIVE", config: JSON.stringify(merged) },
        update: { enabled, config: JSON.stringify(merged) },
      });
      await writeAudit({
        userId: user.id,
        entityType: "INTEGRATION",
        entityId: provider,
        action: "UPDATE",
        changes: [{ field: "enabled", old: existing?.enabled ?? null, new: enabled }],
        comment: apiKey ? "API-Schlüssel aktualisiert" : undefined,
      });
      return;
    }

    if (provider === "LEXWARE") {
      const enabled = formData.get("enabled") === "on";
      const apiKey = optStr(formData, "apiKey");
      const baseUrl = optStr(formData, "baseUrl");
      const existing = await db.integrationConfig.findUnique({ where: { provider } });
      const prev = existing?.config ? (JSON.parse(existing.config) as Record<string, string>) : {};
      const merged = {
        apiKey: apiKey ?? prev.apiKey,
        baseUrl: baseUrl ?? prev.baseUrl,
      };
      if (enabled && !merged.apiKey) {
        throw new AppError("Bitte den Lexware-API-Schlüssel eintragen, bevor die Integration aktiviert wird.");
      }
      await db.integrationConfig.upsert({
        where: { provider },
        create: { provider, enabled, mode: "LIVE", config: JSON.stringify(merged) },
        update: { enabled, config: JSON.stringify(merged) },
      });
      await writeAudit({
        userId: user.id,
        entityType: "INTEGRATION",
        entityId: provider,
        action: "UPDATE",
        changes: [{ field: "enabled", old: existing?.enabled ?? null, new: enabled }],
        comment: apiKey ? "API-Schlüssel aktualisiert" : undefined,
      });
      return;
    }

    if (provider !== "UPS") throw new AppError("Unbekannter Integrations-Provider.");
    const enabled = formData.get("enabled") === "on";
    const mode = str(formData, "mode") === "LIVE" ? "LIVE" : "MOCK";
    const clientId = optStr(formData, "clientId");
    const clientSecret = optStr(formData, "clientSecret");

    const existing = await db.integrationConfig.findUnique({ where: { provider } });
    // Secrets nur überschreiben, wenn neue eingegeben wurden
    let config = existing?.config ?? null;
    if (clientId || clientSecret) {
      const prev = config ? (JSON.parse(config) as Record<string, string>) : {};
      config = JSON.stringify({
        clientId: clientId ?? prev.clientId,
        clientSecret: clientSecret ?? prev.clientSecret,
      });
    }
    if (mode === "LIVE" && !config) {
      throw new AppError("Für den Live-Modus müssen Client-ID und Client-Secret hinterlegt werden.");
    }
    await db.integrationConfig.upsert({
      where: { provider },
      create: { provider, enabled, mode, config },
      update: { enabled, mode, config },
    });
    await writeAudit({
      userId: user.id,
      entityType: "INTEGRATION",
      entityId: provider,
      action: "UPDATE",
      changes: [
        { field: "enabled", old: existing?.enabled ?? null, new: enabled },
        { field: "mode", old: existing?.mode ?? null, new: mode },
      ],
      comment: clientId || clientSecret ? "Credentials aktualisiert" : undefined,
    });
  });
}

export async function updateMappingFactorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const factor = optNum(formData, "unitFactor");
    const mapping = await db.supplierProductMapping.findUniqueOrThrow({ where: { id } });
    await db.supplierProductMapping.update({
      where: { id },
      data: { unitFactor: factor && factor > 0 ? Math.round(factor) : null },
    });
    await writeAudit({
      userId: user.id,
      entityType: "SUPPLIER_MAPPING",
      entityId: id,
      action: "CORRECTION",
      changes: [{ field: "unitFactor", old: mapping.unitFactor, new: factor }],
      comment: "Einheiten-Faktor des Lieferanten-Mappings geändert",
    });
  });
}

export async function deleteMappingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const id = str(formData, "id");
    const mapping = await db.supplierProductMapping.findUniqueOrThrow({ where: { id } });
    await db.supplierProductMapping.delete({ where: { id } });
    await writeAudit({
      userId: user.id,
      entityType: "SUPPLIER_MAPPING",
      entityId: id,
      action: "DELETE",
      comment: `Mapping „${mapping.supplierName}" gelöscht`,
    });
  });
}
