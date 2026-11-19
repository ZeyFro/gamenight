import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getRivalriesCommunityId, getTeamRivalries } from "@/lib/team-rivalries";
import { teamRivalriesEnabled } from "@/lib/team-rivalries-rules";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";
import {
  answerChallengeResultAction,
  cancelChallengeAction,
  proposeChallengeAction,
  reportChallengeResultAction,
  respondToChallengeAction,
} from "./actions";

export const metadata = pageMetadata("Rivalités d'équipe");

const RESULTS: Record<string, string> = {
  proposed: "Défi envoyé au capitaine adverse.", accepted: "Défi accepté.", declined: "Défi refusé.", cancelled: "Défi annulé.",
  reported: "Résultat déclaré : l'autre capitaine doit le confirmer.", confirmed: "Résultat confirmé.", disputed: "Résultat contesté : il doit être redéclaré.",
  forbidden: "Seul le capitaine concerné peut faire cette action.", pair_open: "Un défi est déjà en cours entre ces deux équipes.",
  too_many: "Trop de défis en cours pour l'une des équipes.", same_team: "Choisis une autre équipe.", invalid: "Vérifie les informations saisies.",
  expired: "Cette proposition a expiré.", rate: "Trop de demandes, réessaie dans une minute.", missing: "Défi ou équipe introuvable.",
};
const STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Proposé", ACCEPTED: "Accepté", RESULT_REPORTED: "Résultat à confirmer", COMPLETED: "Terminé", DECLINED: "Refusé", CANCELLED: "Annulé", EXPIRED: "Expiré",
};

function outcomeLabel(outcome: string | null, role: "challenger" | "opponent"): string {
  if (!outcome) return "";
  if (outcome === "DRAW") return "Égalité";
  return (outcome === "CHALLENGER_WON") === (role === "challenger") ? "Victoire" : "Défaite";
}

export default async function TeamRivalriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ result?: string }> }) {
  if (!teamRivalriesEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getRivalriesCommunityId(user.id);
  if (!communityId) notFound();
  const [{ id }, { result }] = await Promise.all([params, searchParams]);
  const view = await getTeamRivalries(user.id, communityId, id);
  if (!view) notFound();
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <Link href="/equipes" className="text-sm text-accent underline-offset-4 hover:underline">← Équipes</Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">⚔️ Rivalités — {view.team.name}</h1>
        <p className="mt-2 text-sm text-muted">Les capitaines se défient et confirment ensemble chaque résultat. Aucun XP ni étage n&apos;est en jeu.</p>
      </header>
      {result && RESULTS[result] && <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{RESULTS[result]}</p>}

      <Card className="grid gap-1">
        <h2 className="font-semibold text-foreground">Bilan confirmé</h2>
        <p className="text-sm text-muted">{view.record.played} défi(s) · {view.record.wins} victoire(s) · {view.record.losses} défaite(s) · {view.record.draws} égalité(s)</p>
      </Card>

      {view.isCaptain && view.opponents.length > 0 && (
        <Card>
          <form action={proposeChallengeAction} className="grid gap-3">
            <input type="hidden" name="teamId" value={view.team.id} />
            <h2 className="font-semibold text-foreground">Défier une équipe</h2>
            <label className="grid gap-1 text-sm text-foreground">Équipe adverse
              <select name="opponentTeamId" required className="rounded-lg border border-border bg-background px-3 py-3 text-base">
                {view.opponents.map((opponent) => <option key={opponent.id} value={opponent.id}>{opponent.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-foreground">Jeu (facultatif)<input name="gameName" maxLength={80} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
            <label className="grid gap-1 text-sm text-foreground">Message (facultatif)<textarea name="message" maxLength={300} rows={2} className="rounded-lg border border-border bg-background px-3 py-3 text-base" /></label>
            <Button type="submit" variant="primary" fullWidthOnMobile>Envoyer le défi</Button>
          </form>
        </Card>
      )}

      <section aria-labelledby="historique" className="grid gap-3">
        <h2 id="historique" className="font-semibold text-foreground">Historique</h2>
        {view.history.length === 0 && <p className="text-sm text-muted">Aucun défi pour le moment.</p>}
        {view.history.map((entry) => (
          <Card key={entry.id} className="grid gap-2">
            <p className="text-sm font-semibold text-foreground">
              {entry.role === "challenger" ? "Défi envoyé à" : "Défi reçu de"} {entry.opponentName}
              {entry.gameName ? ` · ${entry.gameName}` : ""}
            </p>
            <p className="text-xs text-muted">
              {STATUS_LABELS[entry.status] ?? entry.status} · {dateFormat.format(entry.createdAt)}
              {entry.status === "COMPLETED" ? ` · ${outcomeLabel(entry.outcome, entry.role)}` : ""}
              {entry.disputeCount > 0 ? ` · ${entry.disputeCount} contestation(s)` : ""}
            </p>
            {entry.message && <p className="whitespace-pre-wrap text-sm text-foreground">{entry.message}</p>}
            {entry.status === "RESULT_REPORTED" && <p className="text-sm text-muted">Résultat déclaré : {outcomeLabel(entry.reportedOutcome, entry.role)} {entry.reportedByMe ? "(en attente de l'autre capitaine)" : "(à confirmer)"}.</p>}
            <div className="flex flex-wrap gap-2">
              {entry.canRespond && (["ACCEPT", "DECLINE"] as const).map((decision) => (
                <form key={decision} action={respondToChallengeAction}>
                  <input type="hidden" name="teamId" value={view.team.id} /><input type="hidden" name="challengeId" value={entry.id} /><input type="hidden" name="decision" value={decision} />
                  <Button type="submit" variant={decision === "ACCEPT" ? "secondary" : "destructive"} size="sm">{decision === "ACCEPT" ? "Accepter" : "Refuser"}</Button>
                </form>
              ))}
              {entry.canCancel && (
                <form action={cancelChallengeAction}>
                  <input type="hidden" name="teamId" value={view.team.id} /><input type="hidden" name="challengeId" value={entry.id} />
                  <Button type="submit" variant="destructive" size="sm">Annuler le défi</Button>
                </form>
              )}
              {entry.canReport && (
                <form action={reportChallengeResultAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="teamId" value={view.team.id} /><input type="hidden" name="challengeId" value={entry.id} />
                  <select name="outcome" className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value={entry.role === "challenger" ? "CHALLENGER_WON" : "OPPONENT_WON"}>Nous avons gagné</option>
                    <option value={entry.role === "challenger" ? "OPPONENT_WON" : "CHALLENGER_WON"}>Nous avons perdu</option>
                    <option value="DRAW">Égalité</option>
                  </select>
                  <Button type="submit" variant="secondary" size="sm">Déclarer le résultat</Button>
                </form>
              )}
              {entry.canAnswer && (["CONFIRM", "DISPUTE"] as const).map((answer) => (
                <form key={answer} action={answerChallengeResultAction}>
                  <input type="hidden" name="teamId" value={view.team.id} /><input type="hidden" name="challengeId" value={entry.id} /><input type="hidden" name="answer" value={answer} />
                  <Button type="submit" variant={answer === "CONFIRM" ? "secondary" : "destructive"} size="sm">{answer === "CONFIRM" ? "Confirmer" : "Contester"}</Button>
                </form>
              ))}
            </div>
          </Card>
        ))}
      </section>
    </main>
  );
}
