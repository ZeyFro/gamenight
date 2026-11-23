import { notFound } from "next/navigation";
import { LegalEmail, LegalPage, LegalValue } from "@/components/legal/LegalPage";
import { LEGAL_LAST_UPDATED, LEGAL_PUBLISHER_NAME, getLegalConfig, isLegalPagesEnabled } from "@/lib/legal-pages";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Conditions d’utilisation");

export default function ConditionsPage() {
  if (!isLegalPagesEnabled()) notFound();
  const config = getLegalConfig();
  return (
    <LegalPage title="Conditions d’utilisation">
      <section className="flex flex-col gap-2">
        <h2>Objet et accès</h2>
        <p>GameNight est un service gratuit et sans publicité édité par {LEGAL_PUBLISHER_NAME}.</p>
        <p>
          GameNight aide les membres de serveurs Discord à organiser leurs soirées jeux (soirées, votes, tournois, équipes, défis The Tower). L’accès est
          gratuit et réservé aux membres actifs d’un serveur Discord relié au service ; la connexion se fait uniquement avec ton compte Discord. Si tu quittes
          le serveur, ton accès aux données de ce serveur s’arrête.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Âge minimum</h2>
        <p>Âge minimum pour utiliser GameNight : <LegalValue value={config.minAge ? `${config.minAge} ans` : null} />. Tu dois aussi respecter l’âge minimum exigé par Discord.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Règles d’usage</h2>
        <ul>
          <li>Pas de contenu illicite, haineux, harcelant, sexuellement explicite ou portant atteinte à la vie privée.</li>
          <li>Pas de triche sur les défis et tournois (fausse preuve, fausse déclaration de résultat).</li>
          <li>Pas d’usage automatisé, de tentative d’accès aux données d’autres membres ou de perturbation du service.</li>
          <li>Respecte la charte de fair-play du serveur lorsqu’elle existe.</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Photos, vidéos et droit à l’image</h2>
        <p>
          En ajoutant une photo, une vidéo ou une bannière, tu confirmes avoir le droit de la publier et, si d’autres personnes y sont reconnaissables
          ou audibles, avoir obtenu leur accord. Tu autorises les membres invités à la soirée à la consulter. Une personne visible dans un média peut
          demander son retrait par e-mail à <LegalEmail email={config.contactEmail} label={config.publisher} /> ; l’auteur, le créateur de la soirée ou un administrateur peuvent
          aussi le supprimer.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Contenus des membres</h2>
        <p>
          Tu restes propriétaire de tes contenus. Tu accordes à GameNight le droit de les stocker et de les afficher aux membres concernés, uniquement pour
          faire fonctionner le service. Les administrateurs peuvent retirer un contenu contraire aux règles.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Modération, suspension et fin d’accès</h2>
        <p>Un compte qui ne respecte pas ces règles peut être restreint ou supprimé par les administrateurs du serveur ou de l’application. Tu peux demander la suppression de ton compte à tout moment (voir la politique de confidentialité).</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Disponibilité et responsabilité</h2>
        <p>
          Le service est fourni sans garantie de disponibilité continue ; il peut être interrompu pour maintenance ou évolution. Les récompenses (XP, étages, titres,
          cadres) sont purement cosmétiques et n’ont aucune valeur monétaire. Sauf faute lourde ou dispositions légales contraires, la responsabilité de l’éditeur
          est limitée aux dommages directs.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Modification des conditions, droit applicable</h2>
        <p>Ces conditions peuvent évoluer ; la date de dernière mise à jour est le {LEGAL_LAST_UPDATED}. Elles sont soumises au droit français. Contact : <LegalEmail email={config.contactEmail} label={config.publisher} />.</p>
      </section>
    </LegalPage>
  );
}
