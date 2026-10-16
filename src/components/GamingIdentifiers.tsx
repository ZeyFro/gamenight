import { GAMING_IDENTIFIER_FIELDS, type GamingIdentifiers as Identifiers } from "@/lib/gaming-identifiers";

/** À rendre seulement après autorisation du profil par la page appelante. */
export function GamingIdentifiers({ user }: { user: Identifiers & { steamId64: string | null } }) {
  const entries = [
    { key: "steamId64", label: "Steam", value: user.steamId64 },
    ...GAMING_IDENTIFIER_FIELDS.map(field => ({ ...field, value: user[field.key] })),
  ].filter(entry => entry.value);
  if (!entries.length) return null;
  return (
    <section aria-label="Identifiants de jeu" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Identifiants de jeu</h2>
      <p className="mt-1 text-sm text-muted">Pseudonymes partagés pour vous retrouver en jeu.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map(entry => <div key={entry.key}>
          <dt className="text-xs text-muted">{entry.label}</dt>
          <dd className="break-all text-sm text-foreground">{entry.value}</dd>
        </div>)}
      </dl>
    </section>
  );
}
