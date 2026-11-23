import { COMMUNITY_PREFERENCES, PLAY_HABITS, PLAYER_LANGUAGES, type PlayerMatchingData } from "@/lib/player-matching-rules";
import { updatePlayerMatchingAction } from "@/app/profil/player-matching-actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const FEEDBACK: Record<string, string> = {
  ok: "Tes langues, habitudes et préférences ont été enregistrées.",
  invalide: "Choisis parmi les options proposées.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

function Choices({ legend, name, options, values }: { legend: string; name: string; options: readonly { key: string; label: string }[]; values: string[] }) {
  return <fieldset className="grid gap-2 sm:grid-cols-2">
    <legend className="mb-2 text-sm font-medium">{legend}</legend>
    {options.map(option => <label key={option.key} className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={option.key} defaultChecked={values.includes(option.key)} />{option.label}
    </label>)}
  </fieldset>;
}

export function PlayerMatchingForm({ user, feedback }: { user: PlayerMatchingData; feedback?: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Pour trouver des partenaires</h2>
      <p className="text-sm text-muted">Facultatif. Visible par les membres autorisés à consulter ta fiche. Sert aux filtres de Potes et aux partenaires proposés. Si tu masques ton profil, tu n’es jamais proposé.</p>
      {feedback && FEEDBACK[feedback] && <p role={feedback === "ok" ? "status" : "alert"} className="text-sm">{FEEDBACK[feedback]}</p>}
      <form action={updatePlayerMatchingAction} className="flex flex-col gap-4">
        <Choices legend="Langues parlées" name="languages" options={PLAYER_LANGUAGES} values={user.languages} />
        <Choices legend="Habitudes de jeu" name="playHabits" options={PLAY_HABITS} values={user.playHabits} />
        <Choices legend="Ambiance recherchée" name="communityPreferences" options={COMMUNITY_PREFERENCES} values={user.communityPreferences} />
        <p className="text-sm text-muted">Décoche tout pour effacer ces informations.</p>
        <Button type="submit" variant="primary">Enregistrer</Button>
      </form>
    </Card>
  );
}
