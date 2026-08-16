import { revalidatePath } from "next/cache";
import { toUserMessage } from "../errors";
import type { ActionState } from "@/components/form";

/**
 * Standard-Wrapper für Server Actions:
 * fängt Geschäftsfehler ab und liefert verständliche Meldungen.
 */
export async function runAction(
  fn: () => Promise<{ redirect?: string } | void>,
  revalidate: string[] = ["/"]
): Promise<ActionState> {
  try {
    const result = await fn();
    for (const path of revalidate) revalidatePath(path, "layout");
    return { ok: true, redirect: result?.redirect };
  } catch (err) {
    return { error: toUserMessage(err) };
  }
}

export function str(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export function optStr(formData: FormData, name: string): string | null {
  const v = str(formData, name);
  return v === "" ? null : v;
}

export function num(formData: FormData, name: string): number {
  const v = Number(String(formData.get(name) ?? "").replace(",", "."));
  return isFinite(v) ? v : 0;
}

export function optNum(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  const v = Number(raw.replace(",", "."));
  return isFinite(v) ? v : null;
}

export function optDate(formData: FormData, name: string): Date | null {
  const raw = str(formData, name);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
