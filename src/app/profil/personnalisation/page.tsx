import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { getCustomizationState } from "@/lib/profile-customization";
import {
  PROFILE_COSMETICS,
  PROFILE_KIND_FIELD,
  PROFILE_KIND_LABELS,
  PROFILE_COSMETIC_KINDS,
  SHOWCASE_MAX,
  SHOWCASE_MIN,
  isProfileCustomizationEnabled,
} from "@/lib/profile-cosmetics";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";
import { saveCustomizationAction, setEffectsPreferenceAction } from "./actions";

export const metadata = pageMetadata("Personnalisation du profil");

const STATUS_MESSAGES: Record<string, string> = {
  saved: "Personnalisation enregistrée.",
  effects_saved: "Préférence d'effets enregistrée.",
  disabled: "La personnalisation du profil n'est pas activée.",
  invalid: "Choix invalide.",
  not_owned: "Tu dois posséder un élément pour l'équiper.",
  showcase_too_few: `La vitrine doit contenir au moins ${SHOWCASE_MIN} badges (ou aucun).`,
  showcase_too_many: `La vitrine ne peut pas dépasser ${SHOWCASE_MAX} badges.`,
  showcase_duplicate: "Un badge ne peut figurer qu'une fois dans la vitrine.",
  showcase_locked: "Seuls les badges que tu as débloqués peuvent figurer dans la vitrine.",
  no_community: "Choisis une communauté pour personnaliser ton profil.",
  busy: "Trop de requêtes : réessaie dans un instant.",
};

function acquisitionLabel(item: (typeof PROFILE_COSMETICS)[number]): string {
  const a = item.acquisition;
  if (a.mode === "SHOP") return `Boutique XP : ${a.price} XP`;
  return `${a.mode === "EARNED" ? "À gagner" : "Exclusif boosters"} : ${a.hint}`;
}

export default async function ProfileCustomizationPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!isProfileCustomizationEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await writeCommunityIdForUser(user.id);
  if (!communityId) redirect("/profil");
  const [state, query] = await Promise.all([getCustomizationState(user.id, communityId), searchParams]);
  const showcase = new Set(state.customization?.showcaseBadgeIds ?? []);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Personnalisation du profil</h2>
        <p className="mt-1 text-sm text-muted">
          Purement décoratif : aucun avantage de jeu (ni étage, ni XP, ni priorité). Les éléments gagnés ne s’achètent pas ;
          les autres s’achètent dans la <Link href="/profil/boutique" className="text-accent hover:underline">boutique XP</Link>.
        </p>
      </div>
      {query.status && STATUS_MESSAGES[query.status] && (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm text-foreground">{STATUS_MESSAGES[query.status]}</p>
      )}

      <Card className="p-4 sm:p-4">
        <form action={setEffectsPreferenceAction} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Effets animés des profils</h3>
            <p className="text-sm text-muted">
              Pour toi, quand tu regardes un profil : {state.effectsEnabled ? "effets activés" : "effets désactivés"}. Les effets sont aussi
              coupés si ton appareil demande de réduire les animations.
            </p>
          </div>
          <input type="hidden" name="effects" value={state.effectsEnabled ? "off" : "on"} />
          <Button type="submit" size="sm" variant="secondary">{state.effectsEnabled ? "Désactiver les effets" : "Activer les effets"}</Button>
        </form>
      </Card>

      <form action={saveCustomizationAction} className="flex flex-col gap-5">
        {PROFILE_COSMETIC_KINDS.map((kind) => {
          const field = PROFILE_KIND_FIELD[kind];
          const current = state.customization?.[field] ?? "";
          const owned = PROFILE_COSMETICS.filter((item) => item.kind === kind && state.owned.has(item.id));
          const locked = PROFILE_COSMETICS.filter((item) => item.kind === kind && !state.owned.has(item.id));
          return (
            <fieldset key={kind} className="flex flex-col gap-2 rounded-xl border border-border p-4">
              <legend className="px-1 text-base font-semibold text-foreground">{PROFILE_KIND_LABELS[kind]}</legend>
              <label className="text-sm text-muted" htmlFor={`pc-${field}`}>Équipé</label>
              <select id={`pc-${field}`} name={field} defaultValue={owned.some((item) => item.id === current) ? current : ""} className="rounded-lg border border-border bg-surface px-3 py-2 text-foreground">
                <option value="">Aucun</option>
                {owned.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {locked.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
                  {locked.map((item) => (
                    <li key={item.id}><span className="font-medium text-foreground">{item.name}</span> (verrouillé) · {acquisitionLabel(item)}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}

        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-base font-semibold text-foreground">Vitrine de badges</legend>
          <p className="text-sm text-muted">Choisis {SHOWCASE_MIN} à {SHOWCASE_MAX} badges débloqués, ou aucun pour masquer la vitrine.</p>
          {state.unlockedBadges.length === 0 ? (
            <p className="text-sm text-muted">Tu n’as encore débloqué aucun badge.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {state.unlockedBadges.map((badge) => (
                <label key={badge.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" name="showcase" value={badge.id} defaultChecked={showcase.has(badge.id)} />
                  <span aria-hidden>{badge.icon}</span> {badge.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div><Button type="submit">Enregistrer</Button></div>
      </form>
    </section>
  );
}
