/**
 * Sofortiges Lade-Feedback bei jeder Navigation: erscheint ohne Verzögerung,
 * während die Seite auf dem Server gerendert wird (Cloud-DB braucht 1–3 s).
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Wird geladen">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-border" />
        <div className="h-4 w-80 animate-pulse rounded-md bg-border opacity-60" />
      </div>
      <div className="h-40 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-surface opacity-70" />
    </div>
  );
}
