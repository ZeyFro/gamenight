import { Button } from "@/components/ui/Button";
import {
  describeTeamCriteria,
  TEAM_AVAILABILITY_SLOTS, TEAM_CRITERIA_NOTE_MAX, TEAM_GOALS, TEAM_GOAL_LABELS, TEAM_LEVEL_LABELS, TEAM_MIC_LABELS,
  TEAM_MIC_REQUIREMENTS, TEAM_MIN_LEVELS, TEAM_SLOT_LABELS,
  type TeamRecruitmentCriteriaView,
} from "@/lib/team-recruitment-criteria-rules";

/** Objectifs et critères de recrutement d'une équipe (lecture seule). Rien si rien n'est renseigné. */
export function TeamCriteriaSummary({ criteria }: { criteria: TeamRecruitmentCriteriaView | undefined }) {
  if (!criteria) return null;
  const rows = describeTeamCriteria(criteria);
  if (!rows.length) return null;
  return <dl className="grid gap-1 rounded-lg bg-accent/5 p-3 text-sm" aria-label="Objectifs et critères de recrutement">
    {rows.map((row) => <div key={row.label} className="flex flex-wrap gap-x-2">
      <dt className="text-muted">{row.label} :</dt>
      <dd className="text-foreground">{row.values.join(" · ")}</dd>
    </div>)}
  </dl>;
}

const FIELD = "rounded-lg border border-border bg-background px-3 py-3 text-base";

/** Formulaire du capitaine : cases à cocher et listes fermées, aucun envoi de notification. */
export function TeamCriteriaForm({ teamId, action, criteria }: {
  teamId: string;
  action: (formData: FormData) => Promise<void>;
  criteria: TeamRecruitmentCriteriaView | undefined;
}) {
  return <form action={action} className="mt-6 grid gap-3 border-t border-border pt-4">
    <input type="hidden" name="teamId" value={teamId} />
    <h3 className="font-medium">Objectifs et critères de recrutement</h3>
    <fieldset className="grid gap-1">
      <legend className="text-sm text-muted">Objectifs</legend>
      <div className="flex flex-wrap gap-3">
        {TEAM_GOALS.map((goal) => <label key={goal} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="goals" value={goal} defaultChecked={criteria?.goals.includes(goal)} />{TEAM_GOAL_LABELS[goal]}
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Niveau de jeu minimum
        <select name="minLevel" defaultValue={criteria?.minLevel ?? ""} className={FIELD}>
          <option value="">Aucun</option>
          {TEAM_MIN_LEVELS.map((level) => <option key={level} value={level}>{TEAM_LEVEL_LABELS[level]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Micro
        <select name="mic" defaultValue={criteria?.mic ?? ""} className={FIELD}>
          <option value="">Non précisé</option>
          {TEAM_MIC_REQUIREMENTS.map((mic) => <option key={mic} value={mic}>{TEAM_MIC_LABELS[mic]}</option>)}
        </select>
      </label>
    </div>
    <fieldset className="grid gap-1">
      <legend className="text-sm text-muted">Créneaux habituels (heure de Paris)</legend>
      <div className="flex flex-wrap gap-3">
        {TEAM_AVAILABILITY_SLOTS.map((slot) => <label key={slot} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="slots" value={slot} defaultChecked={criteria?.slots.includes(slot)} />{TEAM_SLOT_LABELS[slot]}
        </label>)}
      </div>
    </fieldset>
    <label className="grid gap-1 text-sm">Plateformes acceptées (séparées par des virgules, 5 max)
      <input name="platforms" defaultValue={criteria?.platforms.join(", ") ?? ""} maxLength={200} placeholder="PC, PS5" className={FIELD} />
    </label>
    <label className="grid gap-1 text-sm">Précisions
      <textarea name="note" rows={2} maxLength={TEAM_CRITERIA_NOTE_MAX} defaultValue={criteria?.note ?? ""} className={FIELD} />
    </label>
    <Button type="submit" size="sm">Enregistrer les critères</Button>
  </form>;
}
