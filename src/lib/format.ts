export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("de-DE").format(n);
}

export function daysAgo(d: Date | string): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/** Für <input type="date"> */
export function toDateInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
