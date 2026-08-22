// Backfill XP (chantier XP/niveaux/rangs, PR 2/9) — attribue rétroactivement
// l'XP "participation" (Axe 1) à partir de l'historique déjà en base :
// sessions créées, votes existants, participations aux sessions décidées,
// dispos hebdo déjà réglées, Steam déjà lié.
//
// Node/ESM autonome, même philosophie que prisma/seed.mjs (pas de
// ts-node/tsx en dépendance) : ce script duplique volontairement les
// formules pures de src/lib/xp.ts (XP_AMOUNTS, levelForXp, titleForLevel,
// rankForLevel) plutôt que de les importer — un module TS avec alias
// `@/...` n'est pas exécutable tel quel par Node. À GARDER EN SYNC avec
// src/lib/xp.ts si le barème ou la courbe changent.
//
// Wired dans `npm run build`, juste après le seed des messages : idempotent
// via la même contrainte unique que `awardXp` (`XpEvent` sur
// `[userId, reason, sourceId]`), donc sûr à rejouer à CHAQUE déploiement,
// pas seulement une fois. C'est même la propriété qui rend ce script utile
// au-delà du tout premier run : le chemin "live" (`awardXp` dans
// xp-actions.ts) et ce passage de reconciliation écrivent tous les deux
// dans le même ledger idempotent, donc un événement déjà crédité en direct
// est un no-op ici, et vice-versa — aucune double comptabilisation possible.
//
// IMPORTANT — ne déclenche JAMAIS de notif Discord "level up" : contrairement
// à `awardXp` (chemin live), ce script écrit directement en base sans passer
// par la détection de passage de niveau. Un backfill qui spammerait le salon
// de dizaines de "level up" rétroactifs au premier déploiement serait absurde.
//
// Limite assumée et documentée (pas de contournement possible sans
// historiser les votes, hors scope ici) : seuls les votes ENCORE PRÉSENTS en
// base sont visibles au backfill. Un vote posé puis retiré avant ce
// déploiement (ex. quelqu'un a voté puis a changé d'avis, `toggleVote`
// supprime la ligne `Vote`) n'a laissé aucune trace — il ne peut pas être
// crédité rétroactivement. Le chemin live, lui, capte tout vote posé à
// partir de maintenant.
//
// Ce script n'a pas accès à une base de prod réelle depuis ce
// sandbox — impossible de connaître à l'avance les chiffres exacts pour un
// user donné. Il imprime donc un récapitulatif détaillé par user à chaque
// exécution (visible dans les logs de build Vercel) pour permettre une
// vérification manuelle après déploiement.

import { PrismaClient } from "@prisma/client";

const XP_AMOUNTS = {
  CREATE_SESSION: 30,
  VOTE: 5,
  PARTICIPATE: 20,
  AVAILABILITY_FIRST: 15,
  STEAM_LINK_FIRST: 15,
};

function levelForXp(xp) {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}

const LEVEL_TITLES = [
  { level: 1, title: "Victime" },
  { level: 5, title: "Noob" },
  { level: 10, title: "PAPED" },
  { level: 15, title: "Habitué" },
  { level: 20, title: "Try-hard" },
  { level: 30, title: "Vétéran" },
  { level: 40, title: "Acharné" },
  { level: 50, title: "No-life" },
  { level: 70, title: "Possédé" },
  { level: 85, title: "Légende vivante" },
  { level: 100, title: "Sans-vie" },
];

function titleForLevel(level) {
  let current = LEVEL_TITLES[0].title;
  for (const tier of LEVEL_TITLES) {
    if (level < tier.level) break;
    current = tier.title;
  }
  return current;
}

const RANKS = [
  { name: "Bronze", minLevel: 1 },
  { name: "Argent", minLevel: 11 },
  { name: "Or", minLevel: 26 },
  { name: "Platine", minLevel: 51 },
  { name: "Diamant", minLevel: 76 },
  { name: "Légende", minLevel: 100 },
];

function rankForLevel(level) {
  let current = RANKS[0];
  for (const rank of RANKS) {
    if (level < rank.minLevel) break;
    current = rank;
  }
  return current.name;
}

const prisma = new PrismaClient();

/** Écriture idempotente d'un événement XP, sans détection de level-up ni notif. */
async function awardXpRaw(userId, reason, sourceId, amount) {
  try {
    await prisma.xpEvent.create({ data: { userId, reason, sourceId, amount } });
  } catch (err) {
    if (err.code === "P2002") return; // déjà attribué (backfill précédent, ou déjà crédité en live)
    throw err;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { xpTotal: { increment: amount } },
  });
}

async function backfillCreateSession(sessions) {
  for (const s of sessions) {
    await awardXpRaw(s.createdById, "CREATE_SESSION", s.id, XP_AMOUNTS.CREATE_SESSION);
  }
}

async function backfillVotes() {
  const votes = await prisma.vote.findMany({ select: { userId: true, proposalId: true } });
  for (const v of votes) {
    // sourceId = proposalId (pas l'id du Vote) : même convention que le
    // chemin live, cf. src/app/sessions/actions.ts.
    await awardXpRaw(v.userId, "VOTE", v.proposalId, XP_AMOUNTS.VOTE);
  }
}

async function backfillParticipation(sessions) {
  const decided = sessions.filter(
    (s) => (s.status === "SCHEDULED" || s.status === "DONE") && s.decidedGameId
  );
  for (const s of decided) {
    const winningProposal = await prisma.proposal.findFirst({
      where: { sessionId: s.id, gameId: s.decidedGameId },
      select: { id: true },
    });
    if (!winningProposal) continue;

    const winnerVotes = await prisma.vote.findMany({
      where: { proposalId: winningProposal.id },
      select: { userId: true },
    });
    for (const v of winnerVotes) {
      await awardXpRaw(v.userId, "PARTICIPATE", s.id, XP_AMOUNTS.PARTICIPATE);
    }
  }
}

async function backfillAvailabilityFirst() {
  const rows = await prisma.weeklyAvailability.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of rows) {
    await awardXpRaw(userId, "AVAILABILITY_FIRST", userId, XP_AMOUNTS.AVAILABILITY_FIRST);
  }
}

async function backfillSteamLinkFirst() {
  const users = await prisma.user.findMany({
    where: { steamId64: { not: null } },
    select: { id: true },
  });
  for (const { id } of users) {
    await awardXpRaw(id, "STEAM_LINK_FIRST", id, XP_AMOUNTS.STEAM_LINK_FIRST);
  }
}

async function printReport() {
  const users = await prisma.user.findMany({
    orderBy: { xpTotal: "desc" },
    select: { id: true, discordName: true, xpTotal: true },
  });

  if (users.length === 0) {
    console.log("[backfill-xp] Aucun user en base pour l'instant.");
    return;
  }

  console.log("\n=== Backfill XP — récapitulatif (à vérifier manuellement) ===");
  for (const user of users) {
    const breakdown = await prisma.xpEvent.groupBy({
      by: ["reason"],
      where: { userId: user.id },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const level = levelForXp(user.xpTotal);
    console.log(
      `\n${user.discordName} — ${user.xpTotal} XP total — niveau ${level} (${titleForLevel(level)}, rang ${rankForLevel(level)})`
    );
    if (breakdown.length === 0) {
      console.log("  (aucun événement XP)");
      continue;
    }
    for (const row of breakdown) {
      const total = row._sum.amount ?? 0;
      console.log(`  ${row.reason} : ${row._count._all} événement(s) → ${total} XP`);
    }
  }
  console.log("\n=== Fin du récapitulatif ===\n");
}

async function main() {
  const sessions = await prisma.session.findMany({
    select: { id: true, createdById: true, status: true, decidedGameId: true },
  });

  await backfillCreateSession(sessions);
  await backfillVotes();
  await backfillParticipation(sessions);
  await backfillAvailabilityFirst();
  await backfillSteamLinkFirst();
  await printReport();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
