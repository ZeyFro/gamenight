import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { FadeInView } from "@/components/ui/FadeInView";
import { getCurrentUser } from "@/lib/current-user";
import { listGroupAchievements } from "@/lib/group-achievements";
import { pageMetadata } from "@/lib/page-title";
import { formatDateFr } from "@/lib/wallclock";
import { isSessionChroniclesEnabled } from "@/lib/session-chronicle-input";
import { isCommunityExpressionsEnabled } from "@/lib/community-expressions-input";
import { isCommunityHighlightsEnabled } from "@/lib/community-highlights-input";

export const metadata = pageMetadata("Lore du groupe");

export default async function GroupLorePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const achievements = await listGroupAchievements(user.id);
  const unlockedCount = achievements.filter((item) => item.unlockedAt).length;

  return (
    <FadeInView className="flex flex-col gap-4">
      {isSessionChroniclesEnabled() && <Link href="/profil/lore/chroniques" className="inline-flex min-h-11 items-center text-sm text-accent">📖 Chroniques de mes soirées</Link>}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">🏆 Hall of Fame du groupe</h2>
          <p className="mt-1 text-sm text-muted">
            {unlockedCount} trophée{unlockedCount === 1 ? "" : "s"} débloqué{unlockedCount === 1 ? "" : "s"} sur {achievements.length}.
          </p>
        </div>
        <Link href="/profil/lore/devine-jeu" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-hover">
          🕵️ Devine le jeu
        </Link>
      </header>
      {isCommunityExpressionsEnabled() && <Link href="/profil/lore/expressions" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-hover">Expressions et running gags du serveur</Link>}
      {isCommunityHighlightsEnabled() && <Link href="/profil/lore/musee" className="inline-flex min-h-11 items-center text-sm text-accent">Exploits et fails du serveur →</Link>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {achievements.map((item) => (
          <li key={item.id}>
            <Card className={`flex h-full flex-col items-center gap-2 text-center ${item.unlockedAt ? "" : "opacity-55 grayscale"}`}>
              <span className="text-3xl" aria-hidden="true">{item.icon}</span>
              <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
              <p className="text-xs text-muted">{item.description}</p>
              <p className="mt-auto pt-2 text-[11px] text-faint">
                {item.unlockedAt ? `Débloqué le ${formatDateFr(item.unlockedAt)}` : "À débloquer"}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </FadeInView>
  );
}
