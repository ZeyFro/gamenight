import type { TournamentStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { submitTournamentPredictionAction } from "@/app/tournois/prediction-actions";
import { canPredictTournamentTarget, predictionWinner } from "@/lib/tournament-prediction-rules";

type Player = { id: string; discordName: string };
type Match = { id: string; round: number; position: number; player1Id: string | null; player2Id: string | null; winnerId: string | null; completedAt: Date | null; player1: Player | null; player2: Player | null };
export function TournamentPredictions({ tournament, predictions }: {
  tournament: { id: string; status: TournamentStatus; championId: string | null; participants: { user: Player }[]; matches: Match[] };
  predictions: { target: string; predictedUserId: string }[];
}) {
  const participants = tournament.participants.map(p => p.user);
  const targets = [
    { id: "champion", label: "Champion du tournoi", players: participants, match: null as Match | null },
    ...tournament.matches.map(match => ({ id: match.id, label: `Round ${match.round}, match ${match.position + 1}`, players: [match.player1, match.player2].filter((p): p is Player => !!p), match })),
  ];
  return <Card>
    <h2 className="font-semibold text-foreground">Tes pronostics</h2>
    <p className="my-2 text-sm text-muted">Un choix définitif par cible, sans mise ni gain d’XP. Le champion se choisit avant le lancement ; les matchs dès que les deux joueurs sont connus.</p>
    <div className="flex flex-col gap-4">{targets.map(target => {
      const prediction = predictions.find(p => p.target === target.id);
      const winner = predictionWinner(tournament.status, target.id === "champion" ? tournament.championId : null, target.match?.winnerId ?? null);
      if (prediction) return <p key={target.id} className="text-sm">{target.label} : {target.players.find(p => p.id === prediction.predictedUserId)?.discordName ?? "Ancien participant"} — {tournament.status === "CANCELLED" ? "annulé" : winner ? (winner === prediction.predictedUserId ? "réussi ✓" : "manqué") : "en attente"}</p>;
      if (!target.players.some(player => canPredictTournamentTarget(tournament.status, participants.map(p => p.id), player.id, target.match))) return null;
      return <form key={target.id} action={submitTournamentPredictionAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tournamentId" value={tournament.id} />
        <input type="hidden" name="target" value={target.id} />
        <label className="flex flex-col gap-1 text-sm">{target.label}
          <select name="predictedUserId" required defaultValue="" className="min-h-11 rounded-lg border border-border bg-surface px-3 text-foreground">
            <option value="" disabled>Choisir un gagnant</option>
            {target.players.map(player => <option key={player.id} value={player.id}>{player.discordName}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm">Pronostiquer</Button>
      </form>;
    })}</div>
  </Card>;
}
