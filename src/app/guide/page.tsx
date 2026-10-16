import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { Card } from "@/components/ui/Card";
import { Stagger, StaggerItem } from "@/components/motion";
import { guideSections, type GuideSection } from "@/lib/guide-sections";
import { pageMetadata } from "@/lib/page-title";
import { ButtonLink } from "@/components/ui/Button";

export const metadata = pageMetadata("Guide");

const SECTIONS: GuideSection[] = [
  {
    icon: "🎮",
    title: "Jeux communs",
    lines: [
      "Dans Bibliothèque du groupe, choisis les personnes qui joueront pour voir les jeux possédés par chacune d’elles.",
      "Inclus-toi si tu participes. Les autres filtres restent disponibles ; efface la sélection pour retrouver tout le groupe.",
      "Les bibliothèques déclarées doivent être à jour : ce filtre ne vérifie ni l’installation ni la présence en ligne.",
      "Sur la fiche d’un jeu, consulte le prix Steam en France et les informations de téléchargement déclarées avec leur source. Le volume varie selon la plateforme et la version ; une valeur absente reste inconnue.",
    ],
  },
  {
    icon: "📅",
    title: "Calendrier",
    lines: [
      "Regarde les dispos de tout le monde en un coup d'œil.",
      "Bascule entre vue Collectif (le groupe) et Individuel (un pote).",
      "Tape un créneau pour indiquer ta dispo directement.",
    ],
  },
  {
    icon: "🎯",
    title: "Soirées",
    lines: [
      "Propose une date, tes potes votent pour le jeu.",
      "Le jeu le plus voté est retenu à la deadline.",
      "Retrouve les soirées passées dans l'onglet Historique.",
      "Avant de participer, consulte les avertissements et les langues du jeu. Les joueurs qui possèdent le jeu peuvent les renseigner sur sa fiche ; une information non renseignée reste inconnue.",
    ],
  },
  {
    icon: "🏆",
    title: "XP, rangs et badges",
    lines: [
      "Chaque participation, vote ou soirée créée rapporte de l'XP.",
      "Progresse à travers les rangs, de Bronze à Légende.",
      "Débloque des badges pour tes exploits (streak, ancienneté...).",
    ],
  },
  {
    icon: "🥇",
    title: "Récompenses",
    lines: [
      "Après chaque soirée, votez des récompenses entre potes (MVP, etc.).",
      "Les gagnants s'affichent sur leur profil.",
    ],
  },
  {
    icon: "🔔",
    title: "Notifications",
    lines: [
      "GameNight poste dans Discord à chaque étape (création, rappels, clôture).",
      "Choisis qui est mentionné à la création d'une soirée.",
      "Coupe les pings perso depuis ton profil, les messages restent postés.",
    ],
  },
  {
    icon: "👤",
    title: "Profil",
    lines: [
      "Personnalise ta bannière et ta couleur perso.",
      "Consulte tes stats, ton historique et tes récompenses gagnées.",
      "Lie ton compte Steam pour importer ta bibliothèque de jeux.",
      "Dans les paramètres, renseigne tes identifiants PSN, Xbox, Nintendo Switch, Epic Games et Battle.net : les membres qui peuvent voir ta fiche les retrouveront sur ton profil.",
      "Déclare aussi tes commandes, plateformes disponibles et ton micro dans les paramètres : les membres autorisés à consulter ta fiche verront ton matériel, sans filtrage automatique des jeux.",
    ],
  },
];

/**
 * Page "Comment ça marche" (Sprint 2 PR-B, U2) — route statique, une
 * section par grand pan de l'app, accessible depuis le "?" flottant
 * (`GuideFab`, monté dans le layout racine). Aucune donnée dynamique :
 * `getCurrentUser` sert uniquement à garder la même garde d'accès que le
 * reste de l'app (redirection si non connecté), pas à personnaliser le
 * contenu.
 */
export default async function GuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Comment ça marche
        </h1>
        <p className="mt-1 text-sm text-muted">
          Un tour rapide des grandes fonctions de GameNight.
        </p>
      </div>

      <ButtonLink href="/bienvenue">Reprendre le guide pas à pas</ButtonLink>
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {guideSections(SECTIONS).map((section) => (
          <StaggerItem key={section.title}>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>
                  {section.icon}
                </span>
                <h2 className="font-semibold text-foreground">{section.title}</h2>
              </div>
              <ul className="flex flex-col gap-1.5">
                {section.lines.map((line) => (
                  <li key={line} className="text-sm text-muted">
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
