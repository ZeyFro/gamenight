import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { saveSessionChronicleAction } from "@/app/sessions/actions/chronicles";
import { MAX_SESSION_CHRONICLE_LENGTH } from "@/lib/session-chronicle-input";

export function SessionChronicle({ sessionId, text, canEdit, result }: { sessionId: string; text: string | null; canEdit: boolean; result?: string }) {
  return <Card>
    <h2 className="font-semibold">Chronique de la soirée</h2>
    {result && <p role={result === "saved" ? "status" : "alert"} className="my-2 text-sm text-muted">{result === "saved" ? "Chronique enregistrée." : result === "rate" ? "Doucement, réessaie dans un instant." : "Chronique refusée : vérifie sa longueur et ton accès à cette soirée terminée."}</p>}
    {text && <p className="my-3 whitespace-pre-wrap break-words text-sm">{text}</p>}
    {canEdit && <form action={saveSessionChronicleAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <label htmlFor="session-chronicle" className="text-sm">Le souvenir ({MAX_SESSION_CHRONICLE_LENGTH.toLocaleString("fr-FR")} caractères maximum)</label>
      <textarea id="session-chronicle" name="chronicle" maxLength={MAX_SESSION_CHRONICLE_LENGTH} rows={6} defaultValue={text ?? ""} className="rounded-lg border border-border bg-surface p-3 text-foreground" />
      <p className="text-xs text-muted">Visible uniquement par les personnes autorisées à consulter cette soirée. Une chronique conserve la soirée dans les archives ; effacer le texte permet son nettoyage automatique.</p>
      <Button type="submit" size="sm" className="self-start">Enregistrer la chronique</Button>
    </form>}
    <Link href="/profil/lore/chroniques" className="mt-3 inline-flex min-h-11 items-center text-sm text-accent">Archives de mes soirées →</Link>
  </Card>;
}
