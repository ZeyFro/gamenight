import { COMMUNITY_PREFERENCES, labelsFor, PLAY_HABITS, PLAYER_LANGUAGES, type PlayerMatchingData } from "@/lib/player-matching-rules";

/** L'appelant autorise le profil (canViewPote) avant de charger ces données. */
export function PlayerMatchingProfile({ user }: { user: PlayerMatchingData }) {
  const rows = [
    ["Langues", labelsFor(PLAYER_LANGUAGES, user.languages)],
    ["Habitudes de jeu", labelsFor(PLAY_HABITS, user.playHabits)],
    ["Ambiance recherchée", labelsFor(COMMUNITY_PREFERENCES, user.communityPreferences)],
  ] as const;
  if (rows.every(([, values]) => !values.length)) return null;
  return (
    <section aria-label="Langues et habitudes" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Langues et habitudes</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        {rows.map(([label, values]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd>{values.join(", ") || "Non renseigné"}</dd></div>)}
      </dl>
    </section>
  );
}
