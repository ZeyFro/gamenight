import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalEmail, LegalPage, LegalValue } from "@/components/legal/LegalPage";
import { getLegalConfig, isLegalPagesEnabled } from "@/lib/legal-pages";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Politique de confidentialité");

export default function ConfidentialitePage() {
  if (!isLegalPagesEnabled()) notFound();
  const config = getLegalConfig();
  const deletionOpen = process.env.ACCOUNT_DELETION_ENABLED === "true";
  return (
    <LegalPage title="Politique de confidentialité">
      <section className="flex flex-col gap-2">
        <h2>Responsable du traitement</h2>
        <p>Éditeur : <LegalValue value={config.publisher} />. Contact pour toute question ou demande : <LegalEmail email={config.contactEmail} label={config.publisher} />.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Données collectées, finalités, durées</h2>
        <table>
          <thead><tr><th>Données</th><th>Finalité</th><th>Base légale</th><th>Durée</th></tr></thead>
          <tbody>
            <tr><td>Identifiant, pseudo et avatar Discord ; liste des serveurs Discord dont tu es membre ; adresse e-mail transmise par Discord à la connexion (jamais enregistrée dans la base, seulement conservée dans le cookie de session chiffré)</td><td>Connexion et contrôle d’accès au serveur</td><td>Exécution du service</td><td>Durée du compte</td></tr>
            <tr><td>Jetons de connexion Discord (chiffrés)</td><td>Actualiser ton pseudo et ton avatar</td><td>Intérêt légitime</td><td>Durée du compte</td></tr>
            <tr><td>Profil : couleur, bannière, préférences, niveaux de jeu, matériel, jour et mois d’anniversaire (sans l’année)</td><td>Personnalisation et organisation des soirées</td><td>Exécution du service</td><td>Durée du compte</td></tr>
            <tr><td>Identifiants de plateformes de jeu (Steam, PlayStation, Xbox, Switch, Epic, Battle.net, Riot), saisis volontairement ou importés depuis tes comptes liés Discord avec ton accord</td><td>Retrouver tes potes et mesurer certains défis</td><td>Consentement (saisie volontaire)</td><td>Jusqu’à ton effacement ou la suppression du compte</td></tr>
            <tr><td>Si tu lies ton compte Steam : jeux possédés, jeu en cours, et temps de jeu ou succès lus pour mesurer certains défis</td><td>Bibliothèque commune, indicateur « En jeu », validation des défis mesurables</td><td>Consentement (liaison volontaire)</td><td>Jusqu’à la suppression de la liaison ou du compte</td></tr>
            <tr><td>Activité : soirées, votes, notes, disponibilités, tournois, équipes, candidatures, XP, badges, classements, défis The Tower (texte et code de preuve, consentement de publication)</td><td>Fonctionnement du service</td><td>Exécution du service</td><td>Durée du compte. À la suppression du compte, tes défis solo et leurs preuves sont supprimés ; la preuve des défis d’équipe est effacée</td></tr>
            <tr><td>Chat de soirée, photos et vidéos de galerie, bannières</td><td>Échanges et souvenirs entre invités</td><td>Exécution du service ; accord des personnes visibles</td><td>Chat : 7 jours après la fin de la soirée lorsque la purge automatique est active ; médias : durée du compte ou suppression par un administrateur</td></tr>
            <tr><td>Notifications dans l’application et messages privés Discord ; abonnements de notification du navigateur (facultatifs) ; liens privés d’agenda</td><td>Te prévenir de ce qui te concerne</td><td>Exécution du service ; consentement pour le navigateur</td><td>Durée du compte ou jusqu’à désactivation</td></tr>
            <tr><td>Signalements de modération (extrait du message limité à 500 caractères, identifiants Discord)</td><td>Modération et sécurité</td><td>Intérêt légitime ; obligation légale</td><td>Jusqu’à leur suppression par l’équipe de modération (aucune purge automatique). À la suppression du compte de l’auteur ou de la personne qui signale, ses identifiants et l’extrait de son message sont effacés</td></tr>
            <tr><td>Si le serveur l’active : temps passé dans les salons vocaux d’une soirée</td><td>Statistiques de la soirée, visibles de son créateur et des administrateurs invités</td><td>Consentement</td><td>30 jours, puis suppression automatique</td></tr>
            <tr><td>Si le serveur l’active : date de début de ton boost Nitro du serveur, lue chez Discord</td><td>Badge et rôle de soutien purement cosmétiques</td><td>Intérêt légitime</td><td>Durée du compte ; le rôle est retiré à la fin du boost</td></tr>
            <tr><td>Journaux techniques (peuvent contenir ton identifiant Discord en cas d’erreur)</td><td>Sécurité et dépannage</td><td>Intérêt légitime</td><td>Selon l’offre de l’hébergeur : actuellement 1 heure pour les journaux d’exécution</td></tr>
          </tbody>
        </table>
        <p>Aucune donnée n’est vendue. Aucun outil de mesure d’audience ni de publicité n’est intégré à l’application.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Destinataires et sous-traitants</h2>
        <p>Tes données sont visibles des membres de ton serveur selon les réglages de chaque fonction, et des administrateurs. Elles sont traitées par :</p>
        <table>
          <thead><tr><th>Prestataire</th><th>Rôle</th><th>Localisation</th></tr></thead>
          <tbody>
            <tr><td>Vercel Inc.</td><td>Hébergement de l’application, journaux, stockage de fichiers</td><td>Société américaine ; fonctions déployées à Francfort ; fichiers (bannières, galerie) servis par le réseau mondial de Vercel, y compris hors Union européenne</td></tr>
            <tr><td>Neon, LLC (groupe Databricks)</td><td>Base de données PostgreSQL</td><td>Société américaine ; base hébergée à Francfort</td></tr>
            <tr><td>Discord Inc.</td><td>Connexion, bot, messages privés</td><td>États-Unis</td></tr>
            <tr><td>Valve (Steam)</td><td>Liaison facultative d’un compte Steam, temps de jeu</td><td>États-Unis</td></tr>
            <tr><td>IGDB (Twitch), DeepL, GamerPower</td><td>Catalogue de jeux, traduction de descriptions de jeux, offres gratuites</td><td>Aucun texte de membre n’est envoyé à DeepL</td></tr>
            <tr><td>Google (YouTube)</td><td>Bandes-annonces intégrées sur les fiches jeu : ton adresse IP est transmise à l’affichage de la vidéo</td><td>États-Unis</td></tr>
            <tr><td>Hébergeurs d’images de bannière (Klipy, Tenor, Giphy, Imgur, Discord)</td><td>Ton navigateur charge l’image depuis leur serveur</td><td>Variable</td></tr>
          </tbody>
        </table>
        <p>Transferts hors Union européenne : Vercel, Neon (via Databricks), Discord, Valve et Google sont certifiés au cadre de protection des données UE–États-Unis (Data Privacy Framework), d’après la liste officielle consultée le 22 novembre 2026 sur dataprivacyframework.gov. IGDB, DeepL et GamerPower ne reçoivent aucune donnée de compte : seulement des requêtes sur les jeux.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Cookies et stockage local</h2>
        <p>
          GameNight n’utilise que des cookies strictement nécessaires : connexion (session, protection contre les requêtes frauduleuses, retour après connexion,
          échange avec Discord) et liaison Steam temporaire. Ton navigateur garde aussi tes préférences d’affichage (fond animé, traînée de curseur, rappel de
          profil). Ils ne servent ni à la publicité ni au suivi, donc aucun bandeau de consentement n’est nécessaire.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Tes droits</h2>
        <p>
          Tu peux demander l’accès à tes données, leur rectification, leur effacement, leur portabilité, la limitation ou l’opposition à un traitement, et retirer un
          consentement. Écris à <LegalEmail email={config.contactEmail} label={config.publisher} /> ; réponse sous un mois.
          {deletionOpen
            ? " Tu peux aussi exporter tes données et supprimer ton compte toi-même depuis les paramètres de ton profil."
            : " L’export et la suppression en libre-service ne sont pas encore disponibles : la demande se fait par e-mail."}
        </p>
        <p>Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (<a href="https://www.cnil.fr" className="text-accent underline underline-offset-2">cnil.fr</a>).</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Âge minimum</h2>
        <p>Âge minimum : <LegalValue value={config.minAge ? `${config.minAge} ans` : null} />. Discord exige lui-même un âge minimum de 13 ans.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Contenu illicite</h2>
        <p>Pour signaler un contenu illicite, voir les <Link href="/mentions-legales" className="text-accent underline underline-offset-2">mentions légales</Link>.</p>
      </section>
    </LegalPage>
  );
}
