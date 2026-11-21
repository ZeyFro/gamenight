import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalEmail, LegalPage, LegalValue } from "@/components/legal/LegalPage";
import { getLegalConfig, isLegalPagesEnabled } from "@/lib/legal-pages";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Mentions légales");

export default function MentionsLegalesPage() {
  if (!isLegalPagesEnabled()) notFound();
  const config = getLegalConfig();
  return (
    <LegalPage title="Mentions légales">
      <section className="flex flex-col gap-2">
        <h2>Éditeur du site</h2>
        <p>GameNight est un service privé d’organisation de soirées jeux, réservé aux membres de serveurs Discord partenaires.</p>
        <p>Éditeur : <LegalValue value={config.publisher} /></p>
        <p>Directeur de la publication : <LegalValue value={config.director} /></p>
        <p>Contact : <LegalEmail email={config.contactEmail} /></p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Hébergement</h2>
        <p>Application et stockage de fichiers : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.</p>
        <p>Base de données : Neon, Inc. (PostgreSQL), hébergée à Francfort (Allemagne).</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Signaler un contenu illicite</h2>
        <p>
          Pour signaler un contenu manifestement illicite (photo, vidéo, message, bannière, lien), écris à <LegalEmail email={config.contactEmail} /> en
          indiquant : la page ou le lien du contenu, sa description, le motif du signalement (avec le fondement légal si tu le connais), ton nom et
          ton adresse e-mail. Le contenu est examiné dans les meilleurs délais et retiré s’il est manifestement illicite.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Propriété intellectuelle et sources</h2>
        <p>
          Les contenus publiés par les membres (messages, images, vidéos, bannières) restent la propriété de leurs auteurs. Les noms et logos
          Discord, Steam, Xbox, PlayStation, Nintendo, Epic Games, Battle.net et Riot Games appartiennent à leurs propriétaires respectifs. Les
          informations sur les jeux proviennent notamment d’IGDB (Twitch) et, pour les offres gratuites, de GamerPower.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2>Données personnelles</h2>
        <p>Voir la <Link href="/confidentialite" className="text-accent underline underline-offset-2">politique de confidentialité</Link> et les <Link href="/conditions" className="text-accent underline underline-offset-2">conditions d’utilisation</Link>.</p>
      </section>
    </LegalPage>
  );
}
