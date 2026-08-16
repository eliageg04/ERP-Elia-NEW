import { db } from "@/server/db";
import { formatDateTime } from "@/lib/format";
import { addNoteAction } from "@/server/actions/notes";
import { ActionForm, SubmitButton, Textarea } from "./form";
import { Card } from "./ui";

/** Chronologische Notizen zu einer Entität + Eingabeformular. */
export async function NotesPanel({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const notes = await db.note.findMany({
    where: { entityType, entityId },
    include: { author: { select: { name: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  return (
    <Card title={`Notizen${notes.length ? ` (${notes.length})` : ""}`}>
      <ActionForm action={addNoteAction} resetOnSuccess className="mb-4">
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <Textarea name="body" placeholder="Notiz hinzufügen… (z.B. „2 von 3 Paketen angekommen, Paket 3 laut UPS unterwegs“)" required />
        <div className="mt-2">
          <SubmitButton size="sm">Notiz speichern</SubmitButton>
        </div>
      </ActionForm>
      {notes.length === 0 ? (
        <p className="text-sm text-ink-tertiary">Noch keine Notizen.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-border bg-canvas/50 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              <p className="mt-1 text-xs text-ink-tertiary">
                {note.author?.name ?? "System"} · {formatDateTime(note.createdAt)}
                {note.pinned && " · 📌 Angepinnt"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
