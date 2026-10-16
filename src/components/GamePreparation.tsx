import type { GamePreparationData } from "@/lib/game-preparation";
import { getSteamPurchaseInfo } from "@/lib/game-purchase";

export function GamePreparation({ game }: { game: GamePreparationData }) {
  return <section aria-label="Coût et téléchargement déclarés" className="rounded-xl border border-border bg-surface p-4 text-sm">
    <h2 className="font-semibold">Préparer le jeu</h2>
    <dl className="mt-2 grid gap-1">
      <div><dt className="inline font-medium">Coût déclaré : </dt><dd className="inline">{game.preparationCost === "FREE" ? "Gratuit" : game.preparationCost === "PAID" ? `Payant${game.preparationPrice ? ` · ${game.preparationPrice}` : " · prix non renseigné"}` : "Non renseigné"}</dd></div>
      <div><dt className="inline font-medium">Téléchargement estimé : </dt><dd className="inline">{game.downloadSizeGb === null ? "Non renseigné" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(game.downloadSizeGb)} Go`}</dd></div>
      {game.preparationPlatform && <div><dt className="inline font-medium">Plateforme / version : </dt><dd className="inline">{game.preparationPlatform}</dd></div>}
    </dl>
    <p className="mt-2 text-xs text-muted">Relevé déclaré par les joueurs. Le téléchargement varie selon la plateforme, la version et les mises à jour ; l’espace disque requis est une autre information.</p>
    {game.preparationSourceUrl && <a href={game.preparationSourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-accent underline">Consulter la source du relevé</a>}
    {game.preparationUpdatedAt && <p className="text-xs text-muted">Déclaration du {new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" }).format(game.preparationUpdatedAt)}.</p>}
  </section>;
}
export async function GameSteamPrice({ appId }: { appId: number }) {
  const info = await getSteamPurchaseInfo(appId);
  return <section aria-label="Prix Steam France" className="rounded-xl border border-border bg-surface p-4 text-sm">
    <h2 className="font-semibold">Boutique Steam · France</h2>
    {info ? <>
      <p>{info.isFree === true ? "Gratuit" : info.isFree === false ? "Payant" : "Statut gratuit/payant non renseigné"}</p>
      {info.isFree !== true && <p>Prix affiché : {info.priceFormatted ?? "non disponible"}{info.priceFormatted && info.currency ? ` (${info.currency})` : ""}.</p>}
      <p className="text-xs text-muted">Relevé le {new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(new Date(info.observedAt))}. Vérifie le prix et les offres de ta région sur la boutique avant achat.</p>
    </> : <p>Informations Steam indisponibles pour le moment.</p>}
    <a href={`https://store.steampowered.com/app/${appId}/?cc=fr`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-accent underline">Voir la fiche Steam</a>
  </section>;
}
