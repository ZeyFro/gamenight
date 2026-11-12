import type { ReactNode } from "react";
import { AuroraText } from "@/components/magicui/aurora-text";
import { ShineBorder } from "@/components/magicui/shine-border";

function isValidDiscordId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 17 && value.length <= 20 && !/[^0-9]/.test(value);
}

export function LoginLanding({ children }: { children: ReactNode }) {
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  const playerId = process.env.TOWER_DISCORD_PLAYER_SEARCH_FORUM_ID;
  const recruitmentId = process.env.TOWER_DISCORD_RECRUITMENT_FORUM_ID;
  const adventureId = process.env.TOWER_DISCORD_ADVENTURE_FORUM_ID;

  const isValid =
    isValidDiscordId(guildId) &&
    isValidDiscordId(playerId) &&
    isValidDiscordId(recruitmentId) &&
    isValidDiscordId(adventureId) &&
    playerId !== recruitmentId &&
    playerId !== adventureId &&
    recruitmentId !== adventureId;

  return <div className="gn-login-layout">
    <div className="gn-login-story"><span className="gn-eyebrow" style={{ color: "var(--gn-lime)" }}>Moins d’organisation. Plus de parties.</span><h1>Le point de départ<br />de vos <AuroraText colors={["#b99aff", "#e2ccff", "#d4ef80"]}>meilleures soirées.</AuroraText></h1><p>Vos jeux, vos potes, vos rendez-vous. Retrouvez votre serveur Discord et choisissez ensemble à quoi jouer.</p><div className="gn-login-art" aria-hidden="true"><span><b>🎮</b>Les jeux</span><span><b>☾</b>Les soirées</span><span><b>🏆</b>Les souvenirs</span></div></div>
    <section className="gn-login-card" aria-label="Connexion à GameNight">
      <ShineBorder shineColor={["#b99aff", "#d4ef80", "#8d70c1"]} duration={18} aria-hidden="true" />
      <p className="gn-eyebrow text-accent">Bienvenue dans GameNight</p><h2>Ta prochaine partie<br />commence ici.</h2>
      <p className="mb-7 text-sm text-muted">Connecte-toi avec Discord pour retrouver tes communautés.</p>
      {children}
      <ul className="gn-login-benefits"><li>Des soirées et roulettes à organiser ensemble</li><li>Une bibliothèque commune et vos tierlists</li><li>Une progression propre à chaque serveur</li></ul>
      {isValid && (
        <nav aria-label="Forums de The Tower" className="mt-6 flex flex-col gap-2">
          <a href={`https://discord.com/channels/${guildId}/${playerId}`} className="underline">Recherche de joueurs</a>
          <a href={`https://discord.com/channels/${guildId}/${recruitmentId}`} className="underline">Recrutement d’équipes</a>
          <a href={`https://discord.com/channels/${guildId}/${adventureId}`} className="underline">Projets et aventures</a>
        </nav>
      )}
    </section>
  </div>;
}
