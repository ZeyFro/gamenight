import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Multi-communautés, PR A — garde-fou statique (même principe que
 * `use-server-exports.test.ts`) : aucun NOUVEAU code ne doit appeler
 * directement Prisma sur un modèle collectif (`prisma.session.findMany(…)`,
 * `tx.xpEvent.create(…)`…). Ces accès devront passer par le point de
 * contrôle de communauté (`src/lib/community-access.ts`, puis le client
 * scopé des PR suivantes) pour qu'aucune donnée ne fuie d'une communauté à
 * l'autre.
 *
 * `EXISTING_EXCEPTIONS` fige l'état au moment de la PR A (84 fichiers). On ne
 * l'allonge JAMAIS : chaque PR de filtrage (B1–B3) en retire des lignes. Le
 * test échoue aussi sur une exception devenue inutile, pour forcer ce
 * retrait. Borne basse assumée : un accès via `include` imbriqué ou une
 * requête SQL brute n'est pas détecté.
 */

const COLLECTIVE_MODELS = [
  "CommunityExpression",
  "SessionPreparation", "Session", "SessionInvite", "SessionSeat", "Proposal", "Vote", "SessionResult", "SessionRating", "Pronostic", "XpBet", "Debt",
  "SuperlativeVote", "SuperlativeAward", "SuperlativeCategory", "GameStatType", "Superlative",
  "MessageTemplate", "Roulette", "RouletteEntry", "InstantSession", "InstantSessionPresenceInterval",
  "Tournament", "TournamentParticipant", "TournamentMatch", "ChatMessage", "ChatReaction",
  "GameWishlist", "GameWishlistVote", "XpEvent", "LevelUpEvent", "Season", "SeasonSnapshot",
  "MonthlyRecap", "WeeklyChallenge", "GroupAchievement", "GroupSessionStats", "GroupGameStat",
  "GroupActiveWeek", "SessionVeto", "RouletteVeto", "SessionAvailabilityPoll", "SessionAvailabilityPollParticipant", "SessionAvailabilityPollSlot", "SessionAvailabilityPollResponse",
  "CommunityMemberStats", "CommunityDate",
  // Décision 3 (catalogues copiés par communauté) : le catalogue de badges et
  // les badges gagnés deviennent collectifs.
  "Badge", "UserBadge",
] as const;

/** Modules autorisés à accéder directement aux modèles collectifs (point de contrôle). */
// xp-shop verrouille communauté + appartenance avant toute écriture et filtre chaque lecture/écriture par communityId.
const SCOPED_MODULES = new Set(["src/lib/community-access.ts", "src/lib/xp-shop.ts"]);

/**
 * Accès directs existants à la PR A — à retirer au fil des PR B1 (soirées),
 * B2 (XP, saisons, badges…) et B3 (chat, tournois, roulette…). Ne jamais
 * ajouter de ligne.
 */
const EXISTING_EXCEPTIONS: Record<string, string[]> = {
  "src/app/admin/badges/actions.ts": ["badge"],
  "src/app/admin/jeux-stats/actions.ts": ["gameStatType", "superlative"],
  "src/app/admin/messages/actions.ts": ["messageTemplate"],
  "src/app/admin/superlatifs/actions.ts": ["superlativeCategory"],
  "src/app/api/cron/close-sessions/route.ts": ["session"],
  "src/app/api/cron/reminders/route.ts": ["session"],
  "src/app/chat/actions.ts": ["chatReaction"],
  "src/app/page.tsx": ["session"],
  "src/app/potes/[id]/badges/page.tsx": ["badge"],
  "src/app/profil/badges/page.tsx": ["badge"],
  "src/app/profil/page.tsx": ["session"],
  "src/app/profil/saisons/page.tsx": ["seasonSnapshot"],
  "src/app/roulette/[id]/page.tsx": ["rouletteEntry"],
  "src/app/roulette/actions.ts": ["proposal", "rouletteEntry"],
  "src/app/roulette/page.tsx": ["session"],
  "src/app/sessions/[id]/invites/page.tsx": ["session"],
  "src/app/sessions/[id]/page.tsx": ["pronostic", "session", "sessionResult", "superlativeAward", "superlativeVote", "xpBet"],
  "src/app/sessions/[id]/resultats/page.tsx": ["session"],
  "src/app/sessions/[id]/vote-superlatifs/page.tsx": ["session", "superlativeAward", "superlativeCategory", "superlativeVote"],
  "src/app/sessions/actions/invites.ts": ["session", "sessionInvite"],
  "src/app/sessions/actions/proposals-votes.ts": ["proposal", "session", "vote"],
  "src/app/sessions/actions/results.ts": ["sessionResult"],
  "src/app/sessions/actions/session-lifecycle.ts": ["proposal", "session"],
  "src/app/sessions/actions/superlatives.ts": ["superlativeCategory", "superlativeVote"],
  "src/app/tournois/[id]/page.tsx": ["tournament"],
  "src/app/tournois/actions.ts": ["tournament", "tournamentMatch", "tournamentParticipant"],
  "src/app/tournois/page.tsx": ["tournament"],
  "src/app/wishlist/actions.ts": ["gameWishlistVote"],
  "src/components/admin/BadgesTab.tsx": ["badge"],
  "src/components/admin/MessagesTab.tsx": ["messageTemplate"],
  "src/components/admin/SuperlativesTab.tsx": ["superlativeCategory"],
  "src/lib/backfill-badges.ts": ["badge"],
  "src/lib/backfill-game-news.ts": ["session"],
  "src/lib/backfill-xp.ts": ["proposal", "vote"],
  "src/lib/badges.ts": ["badge"],
  "src/lib/discord-reminder.ts": ["proposal"],
  "src/lib/discord-roulette.ts": ["session"],
  "src/lib/fix-invalid-templates.ts": ["messageTemplate"],
  "src/lib/instant-session-announce.ts": ["instantSession"],
  "src/lib/instant-sessions.ts": ["instantSession", "instantSessionPresenceInterval"],
  "src/lib/message-templates.ts": ["messageTemplate"],
  "src/lib/revanche.ts": ["session"],
  "src/lib/roulette-dm.ts": ["roulette", "session"],
  "src/lib/seed-badges.ts": ["badge"],
  "src/lib/seed-game-stats.ts": ["gameStatType"],
  "src/lib/seed-messages.ts": ["messageTemplate"],
  "src/lib/seed-superlatives.ts": ["superlativeCategory"],
  "src/lib/session-access.ts": ["session", "sessionInvite"],
  "src/lib/session-announce.ts": ["session", "sessionInvite"],
  "src/lib/sessions.ts": ["groupActiveWeek", "groupGameStat", "groupSessionStats", "proposal", "session", "vote"],
  "src/lib/superlative-voting.ts": ["proposal", "superlativeCategory", "superlativeVote"],
  "src/lib/tournament-announce.ts": ["tournament", "tournamentParticipant"],
  "src/lib/tournaments.ts": ["tournament", "tournamentMatch", "tournamentParticipant"],
};

const OPERATIONS = [
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "create",
  "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert",
  "delete", "deleteMany", "count", "aggregate", "groupBy",
];

const accessor = (model: string) => model[0].toLowerCase() + model.slice(1);
/** Le client scopé (`getScopedPrisma`, PR7) s'appelle `scopedDb` : ses accès sont autorisés. */
const SCOPED_RECEIVER = "scopedDb";
const ACCESS_RE = new RegExp(
  `([\\w$]*)\\s*\\.\\s*(${COLLECTIVE_MODELS.map(accessor).join("|")})\\s*\\.\\s*(${OPERATIONS.join("|")})\\s*\\(`,
  "g"
);

/** Accesseurs de modèles collectifs appelés directement dans `source`, triés. */
function collectiveAccesses(source: string): string[] {
  return [
    ...new Set([...source.matchAll(ACCESS_RE)].filter((m) => m[1] !== SCOPED_RECEIVER).map((m) => m[2])),
  ].sort();
}

/** Un fichier qui utilise `scopedDb` doit l'obtenir de `getScopedPrisma` / `scopedPrisma` (borne basse : présence du nom). */
function usesScopedDbWithoutFactory(source: string): boolean {
  return /\bscopedDb\b/.test(source) && !/\b(getScopedPrisma|getActiveScopedPrisma|scopedPrisma|scopedTransactionPrisma|scopedPrismaForCommunity|scopedPrismaForCommunityId)\s*\(/.test(source);
}

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("collectiveAccesses (détecteur)", () => {
  it("détecte prisma.<modèle>.<op>( y compris sur plusieurs lignes et via un client de transaction", () => {
    expect(collectiveAccesses("await prisma.session.findMany({})")).toEqual(["session"]);
    expect(collectiveAccesses("tx.xpEvent\n      .create({ data })")).toEqual(["xpEvent"]);
    expect(collectiveAccesses("db.userBadge.deleteMany(); prisma.badge.count()")).toEqual(["badge", "userBadge"]);
  });

  it("autorise le client scopé `scopedDb` mais pas un autre receveur", () => {
    expect(collectiveAccesses("await scopedDb.chatMessage.findMany({})")).toEqual([]);
    expect(collectiveAccesses("scopedDb.debt\n  .create({})")).toEqual([]);
    expect(collectiveAccesses("await db.chatMessage.findMany({}); scopedDb.debt.count()")).toEqual(["chatMessage"]);
    expect(collectiveAccesses("(await getPrisma()).debt.count()")).toEqual(["debt"]);
    expect(collectiveAccesses("myscopedDb.debt.count()")).toEqual(["debt"]);
  });

  it("`scopedDb` sans `getScopedPrisma` / `scopedPrisma` dans le fichier est signalé", () => {
    expect(usesScopedDbWithoutFactory("const scopedDb = prisma; scopedDb.debt.count()")).toBe(true);
    expect(usesScopedDbWithoutFactory("const scopedDb = await getScopedPrisma(user.id);")).toBe(false);
    expect(usesScopedDbWithoutFactory("const x = 1")).toBe(false);
  });

  it("ignore les modèles personnels / globaux et les noms qui ne sont qu'un préfixe", () => {
    expect(collectiveAccesses("prisma.user.findMany(); prisma.game.findUnique(); prisma.membership.count()")).toEqual([]);
    expect(collectiveAccesses("prisma.sessionResultX.findMany()")).toEqual([]);
    expect(collectiveAccesses("const session = await auth(); session.user")).toEqual([]);
  });
});

describe("garde-fou : pas d'accès direct aux modèles collectifs hors du point de contrôle", () => {
  const found: Record<string, string[]> = {};
  for (const file of sourceFiles(join(ROOT, "src"))) {
    const models = collectiveAccesses(readFileSync(file, "utf8"));
    if (models.length) found[relative(ROOT, file).split(sep).join("/")] = models;
  }

  it("aucun nouvel accès direct (fichier ou modèle absent de EXISTING_EXCEPTIONS)", () => {
    const unexpected = Object.entries(found)
      .filter(([file]) => !SCOPED_MODULES.has(file))
      .flatMap(([file, models]) =>
        models.filter((m) => !(EXISTING_EXCEPTIONS[file] ?? []).includes(m)).map((m) => `${file} → ${m}`)
      );
    expect(unexpected).toEqual([]);
  });

  it("tout fichier qui utilise `scopedDb` l'obtient d'une fabrique du client scopé", () => {
    const offenders = sourceFiles(join(ROOT, "src"))
      .filter((file) => !file.endsWith("community-scoped-client.ts"))
      .filter((file) => usesScopedDbWithoutFactory(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("aucune exception périmée (accès déjà retiré : supprimer la ligne de EXISTING_EXCEPTIONS)", () => {
    const stale = Object.entries(EXISTING_EXCEPTIONS).flatMap(([file, models]) =>
      models.filter((m) => !(found[file] ?? []).includes(m)).map((m) => `${file} → ${m}`)
    );
    expect(stale).toEqual([]);
  });
});
