import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { isAccountDeletionEnabled } from "@/lib/account-deletion-flag";
import { pageMetadata } from "@/lib/page-title";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { Card } from "@/components/ui/Card";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";

export const metadata = pageMetadata("Mon compte et mes données");

const ERRORS: Record<string, string> = {
  confirmation: "La confirmation ne correspond pas : tape ton pseudo exact ou le mot SUPPRIMER.",
  proprietaire: "Tu es le dernier propriétaire d’une communauté. Désigne un autre propriétaire avant de supprimer ton compte : rien n’a été effacé.",
  equipe: "Tu es le dernier membre d’une équipe qui a un défi en cours, un signalement ou une contestation ouverts : elle ne peut pas être dissoute pour le moment. Rien n’a été effacé.",
  stockage: "Tes fichiers n’ont pas pu être supprimés pour le moment. Rien n’a été effacé : réessaie plus tard.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

const ERASED = [
  "ton profil : identifiant et pseudo Discord, avatar, bannière (fichier supprimé), couleur, plateformes et identifiants de jeu, Steam, jetons de connexion Discord",
  "ta bibliothèque, tes jeux refusés, tes niveaux de jeu, tes tags, ta tierlist, tes disponibilités",
  "tes notifications, abonnements Web Push, abonnements calendrier et préférences",
  "tes messages de chat et tes réactions, tes petites annonces",
  "ta progression : XP, niveaux, badges, statistiques, saisons en cours, personnalisation du profil",
  "tes votes, vetos, places, candidatures, invitations reçues, pronostics et paris, participations aux roulettes, sondages et projets",
  "tes médias de galerie (fichiers supprimés) et tes présences vocales",
  "tes défis Tower solo avec leurs preuves, votes et recours, et ton grade",
  "tes appartenances aux serveurs et aux équipes",
];

const KEPT = [
  "les soirées, tournois, équipes et projets que tu as créés, qui concernent d’autres membres : ils restent, avec « Ancien membre » comme auteur",
  "tes résultats de soirée et de tournoi, tes présences et tes notes, sans lien avec une personne identifiable",
  "les archives de classement de saisons closes et les journaux d’administration, sans identifiant",
  "tes dettes (gages) non réglées envers le groupe, sans identité",
];

const LIMITS = [
  "les messages et fils déjà publiés sur Discord (annonces, preuves, messages privés du bot) ne sont pas effacés par GameNight : demande leur retrait à l’équipe d’administration du serveur",
  "ton compte Discord n’est pas touché : tu pourras te reconnecter plus tard, avec un compte neuf et vide",
  "la suppression est définitive : rien n’est récupérable",
];

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  if (!isAccountDeletionEnabled()) notFound();
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const { erreur } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">Télécharger mes données</h2>
        <p className="text-sm text-muted">
          Un fichier JSON lisible avec tes propres données et les contenus que tu as créés. Il ne contient ni tes jetons de connexion, ni les clés de tes
          appareils, ni les données des autres membres.
        </p>
        {/* Lien simple (pas `next/link`) : pas de préchargement d'une route qui génère un fichier. */}
        <a
          href="/api/compte/export"
          download
          className="inline-flex items-center justify-center rounded-lg border-2 border-border bg-surface px-5 py-3 text-base font-medium text-foreground hover:bg-surface-hover hover:border-border-hover sm:w-fit sm:py-2.5 sm:text-sm"
        >
          Télécharger mes données
        </a>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold text-destructive">Supprimer mon compte</h2>
        {erreur && ERRORS[erreur] && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {ERRORS[erreur]}
          </p>
        )}
        <div className="grid gap-3 text-sm text-muted">
          <div>
            <p className="font-medium text-foreground">Ce qui est effacé</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {ERASED.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">Ce qui est conservé, sans te nommer</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {KEPT.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">À savoir</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {LIMITS.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </div>
        <DeleteAccountForm discordName={user.discordName} />
      </Card>

      <Link href="/profil/parametres" className="text-sm font-medium text-accent">← Retour aux paramètres</Link>
    </div>
  );
}
