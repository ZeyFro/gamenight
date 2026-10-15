import Link from "next/link";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Sondage de disponibilités");
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { AvailabilityPollError, loadAvailabilityPoll } from "@/lib/session-availability-poll-data";
import { rankAvailabilityPollSlots } from "@/lib/session-availability-poll";
import { answerAvailabilityPollAction, chooseAvailabilityPollSlotAction, closeAvailabilityPollAction } from "@/app/sessions/actions/availability-polls";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";

const answerLabel = { AVAILABLE: "Oui", MAYBE: "Peut-être", UNAVAILABLE: "Non" } as const;
const answerClass = { AVAILABLE: "border-emerald-500/40 bg-emerald-500/10", MAYBE: "border-amber-500/40 bg-amber-500/10", UNAVAILABLE: "border-border bg-background" } as const;
const pageErrors: Record<string, string> = {
  unavailable: "L’action n’a pas abouti. Si la soirée est déjà créée, reprends sa confirmation ci-dessous.",
  save_failed: "Ta réponse n’a pas été enregistrée. Vérifie ton accès au sondage puis réessaie.",
  close_failed: "La clôture n’a pas été enregistrée. Vérifie ton accès au sondage puis réessaie.",
  rate_limited: "Trop d’actions rapprochées. Réessaie dans quelques secondes.",
};

export default async function AvailabilityPollPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let poll;
  try { poll = await loadAvailabilityPoll(user.id, id); }
  catch (error) { if (error instanceof AvailabilityPollError) notFound(); throw error; }
  const participantIds = poll.participants.map(row => row.userId);
  const slots = rankAvailabilityPollSlots(poll.slots, participantIds);
  const own = new Map(poll.slots.flatMap(slot => slot.responses.filter(row => row.userId === user.id).map(row => [slot.id, row.answer] as const)));
  const isCreator = poll.createdById === user.id;
  const canAnswer = poll.status === "OPEN" && participantIds.includes(user.id);
  const canChoose = isCreator && !poll.sessionId && !poll.chosenSlotId;
  const chosenSession = poll.sessionId ? `/sessions/${poll.sessionId}` : null;
  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/sessions/sondages" className="text-sm text-accent hover:underline">← Tous les sondages</Link><h1 className="mt-2 text-2xl font-bold">{poll.title}</h1><p className="text-sm text-muted">{poll.status === "OPEN" ? "Sondage ouvert" : "Sondage clos"} · {poll.participants.length} participant{poll.participants.length === 1 ? "" : "s"}</p></div>{chosenSession && <Link href={chosenSession} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Voir la soirée créée</Link>}</header>
    {query.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{pageErrors[query.error] ?? "L’action n’a pas abouti. Recharge le sondage et réessaie."}</p>}
    <Card><div className="flex flex-col gap-3"><h2 className="font-semibold">Participants</h2><ul className="flex flex-wrap gap-2">{poll.participants.map(row => <li key={row.userId} className="rounded-full border border-border px-3 py-1 text-sm">{row.user.discordName}{row.userId === poll.createdById ? " · organisateur" : ""}</li>)}</ul>{canAnswer && <p className="text-xs text-muted">Tes réponses sont explicites. Une case vide reste « sans réponse ».</p>}</div></Card>
    {slots.map(slot => <Card key={slot.id}><section className="flex flex-col gap-4" aria-labelledby={`slot-${slot.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id={`slot-${slot.id}`} className="font-semibold">#{slot.rank} · {formatDateTimeFr(slot.start)}</h2><p className="text-xs text-muted">Fin vers {formatDateTimeFr(slot.end)} · {slot.available} oui · {slot.maybe} peut-être · {slot.unavailable} non · {slot.unanswered} sans réponse</p></div>{canChoose && <form action={chooseAvailabilityPollSlotAction}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="slotId" value={slot.id} /><button className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90">Choisir et créer la soirée</button></form>}{isCreator && poll.sessionId && poll.chosenSlotId === slot.id && <form action={chooseAvailabilityPollSlotAction}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="slotId" value={slot.id} /><button className="rounded-lg border border-accent px-3 py-2 text-sm font-semibold text-accent hover:bg-accent/10">Reprendre la confirmation</button></form>}</div>
      <ul className="grid gap-2 sm:grid-cols-2">{poll.participants.map(participant => {
        const answer = slot.responses.find(row => row.userId === participant.userId)?.answer;
        return <li key={participant.userId} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${answer ? answerClass[answer] : "border-border bg-background"}`}><span className="truncate">{participant.user.discordName}</span><span className="shrink-0 text-xs">{answer ? answerLabel[answer] : "Sans réponse"}</span></li>;
      })}</ul>
      {canAnswer && <div className="flex flex-wrap gap-2"><span className="self-center text-xs text-muted">Ta réponse :</span>{(["AVAILABLE", "MAYBE", "UNAVAILABLE"] as const).map(answer => <form key={answer} action={answerAvailabilityPollAction}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="slotId" value={slot.id} /><input type="hidden" name="answer" value={answer} /><button aria-pressed={own.get(slot.id) === answer} className={`rounded-lg border px-3 py-2 text-sm aria-pressed:border-accent aria-pressed:ring-1 aria-pressed:ring-accent ${answerClass[answer]}`}>{answerLabel[answer]}</button></form>)}{own.has(slot.id) && <form action={answerAvailabilityPollAction}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="slotId" value={slot.id} /><input type="hidden" name="answer" value="CLEAR" /><button className="rounded-lg px-3 py-2 text-sm text-muted hover:underline">Effacer</button></form>}</div>}
    </section></Card>)}
    {isCreator && !poll.sessionId && !poll.chosenSlotId && poll.status === "OPEN" && <form action={closeAvailabilityPollAction} className="self-start"><input type="hidden" name="pollId" value={poll.id} /><button className="rounded-lg border border-border px-4 py-2 text-sm hover:border-accent">Fermer les réponses</button></form>}
    {isCreator && poll.chosenSlotId && !poll.sessionId && <p className="rounded-lg border border-border p-3 text-sm text-muted">La soirée créée depuis ce sondage a été supprimée ; ce choix reste définitif.</p>}
    <p className="text-xs text-muted">Le planning personnel n’est pas affiché ici : seuls les votes donnés explicitement apparaissent. Le classement départage d’abord le nombre de « oui », puis les « peut-être » ; les ex æquo partagent leur rang.</p>
  </main>;
}
