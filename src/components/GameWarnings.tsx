import type { GameWarningsData } from "@/lib/game-warnings";

function risk(value: boolean | null | undefined) {
  return value === true ? "Présence signalée" : value === false ? "Absence déclarée" : "Non renseigné";
}
export function GameWarnings({ game }: { game: GameWarningsData }) {
  return <section aria-label="Avertissements et langues" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
    <h2 className="font-semibold">À savoir avant de jouer</h2>
    <dl className="mt-2 grid gap-1">
      <div><dt className="inline font-medium">Jumpscares : </dt><dd className="inline">{risk(game.jumpscares)}</dd></div>
      <div><dt className="inline font-medium">Risque de mal des transports : </dt><dd className="inline">{risk(game.motionSickness)}</dd></div>
      <div><dt className="inline font-medium">Langues des textes : </dt><dd className="inline">{game.textLanguages || "Non renseignées"}</dd></div>
      <div><dt className="inline font-medium">Langues de l’audio : </dt><dd className="inline">{game.audioLanguages || "Non renseignées"}</dd></div>
    </dl>
    <p className="mt-2 text-xs text-muted">Informations déclarées par les joueurs, à vérifier selon ta version du jeu. Une absence déclarée ne garantit pas l’absence de risque.
      {game.warningsUpdatedAt && <> Mise à jour : {new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(new Date(game.warningsUpdatedAt))}.</>}
    </p>
  </section>;
}
