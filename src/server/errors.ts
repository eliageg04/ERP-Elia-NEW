// Geschäftsfehler mit verständlicher deutscher Meldung.
// Wird in Server Actions abgefangen und dem Benutzer direkt angezeigt –
// niemals kryptische Datenbankfehler ins UI durchreichen.
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) {
    // Bekannte Prisma-Fehlercodes in verständliche Meldungen übersetzen
    const anyErr = err as Error & { code?: string };
    if (anyErr.code === "P2002") {
      return "Dieser Datensatz existiert bereits (eindeutiger Wert doppelt vergeben).";
    }
    if (anyErr.code === "P2003") {
      return "Aktion nicht möglich: Der Datensatz ist noch mit anderen Daten verknüpft.";
    }
    if (anyErr.code === "P2025") {
      return "Der Datensatz wurde nicht gefunden (möglicherweise bereits gelöscht).";
    }
  }
  console.error("Unerwarteter Fehler:", err);
  return "Unerwarteter Fehler. Bitte erneut versuchen.";
}
