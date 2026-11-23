// Peuplement de la base LOCALE JETABLE de recette (127.0.0.1:55439/gamenight_preuves). Refuse tout autre hôte/base.
// Une communauté, 30 membres, 3 équipes, 5 soirées, 2 tournois, des défis Tower, un booster. Aucune valeur secrète.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/gamenight_preuves", "Seule la base jetable gamenight_preuves est autorisée");
const db = new PrismaClient({ datasourceUrl: url.href });
const [dest] = await db.$queryRaw`SELECT current_database() AS name`;
assert.equal(dest.name, "gamenight_preuves");

const now = Date.now();
const day = 86_400_000;
const names = ["Alice", "Bastien", "Camille", "Dorian", "Eloïse", "Fabien", "Gaëlle", "Hugo", "Inès", "Jules", "Kévin", "Léa", "Mathis", "Nina", "Océane", "Paul", "Quentin", "Rose", "Sacha", "Tom", "Uma", "Victor", "Wendy", "Xavier", "Yanis", "Zoé", "Ambre", "Basile", "Clara", "Damien"];
const GUILD = "900000000000000001";

const community = await db.community.upsert({
  where: { slug: "default" },
  update: {},
  create: {
    slug: "default", name: "La Tour (recette locale)", status: "ACTIVE", discordGuildId: GUILD,
    towerChallengesEnabled: true, steamPriceAlertsEnabled: true, attendanceXpEnabled: true, freeGamesEnabled: true,
    groupPurchasePlansEnabled: true, playerClassifiedsEnabled: true, communityTeamsEnabled: true, sessionGalleryEnabled: true,
  },
});
const cid = community.id;
await db.community.update({ where: { id: cid }, data: { discordGuildId: GUILD, towerChallengesEnabled: true, steamPriceAlertsEnabled: true, attendanceXpEnabled: true, freeGamesEnabled: true, groupPurchasePlansEnabled: true, playerClassifiedsEnabled: true, communityTeamsEnabled: true, sessionGalleryEnabled: true } });

// --- Utilisateurs : 30 membres + 1 admin + 1 « nouveau » sans aucune donnée (hors communauté ACTIVE seulement par Membership)
const users = [];
for (let i = 0; i < names.length; i++) {
  users.push(await db.user.upsert({
    where: { discordId: `p-${i}` }, update: {},
    create: { discordId: `p-${i}`, discordName: names[i], onboardingCompleted: true, xpTotal: i * 40 },
  }));
}
const admin = await db.user.upsert({ where: { discordId: "p-admin" }, update: {}, create: { discordId: "p-admin", discordName: "Admin Tour", role: "ADMIN", onboardingCompleted: true, xpTotal: 900 } });
const newcomer = await db.user.upsert({ where: { discordId: "p-nouveau" }, update: {}, create: { discordId: "p-nouveau", discordName: "Nouveau Joueur", onboardingCompleted: false } });
for (const user of [...users, admin, newcomer]) {
  await db.membership.upsert({ where: { communityId_userId: { communityId: cid, userId: user.id } }, update: { status: "ACTIVE" }, create: { userId: user.id, communityId: cid, status: "ACTIVE" } });
}
const active = users[0];

// --- Jeux et bibliothèques
const gameNames = ["Overcooked 2", "Rocket League", "Among Us", "Valheim", "Mario Kart 8", "It Takes Two", "Minecraft", "Fall Guys", "Helldivers 2", "Deep Rock Galactic", "Stardew Valley", "Gartic Phone"];
const games = [];
for (const [i, name] of gameNames.entries()) {
  games.push(await db.game.upsert({
    where: { id: `preuve-game-${i}` }, update: {},
    create: { id: `preuve-game-${i}`, name, source: "MANUAL", addedById: active.id, minPlayers: 2, maxPlayers: 4 + (i % 4) },
  }));
}
for (const [index, user] of [...users, admin].entries()) {
  for (let g = 0; g < 4; g++) {
    const game = games[(index + g * 3) % games.length];
    await db.userGame.upsert({ where: { userId_gameId: { userId: user.id, gameId: game.id } }, update: {}, create: { userId: user.id, gameId: game.id, owned: true } });
  }
}
for (const [index, user] of users.slice(0, 12).entries()) {
  await db.userGameLevel.upsert({ where: { userId_gameId: { userId: user.id, gameId: games[index % games.length].id } }, update: {}, create: { userId: user.id, gameId: games[index % games.length].id, level: ["DEBUTANT", "INTERMEDIAIRE", "CONFIRME", "COMPETITIF"][index % 4] } });
}

// --- 3 équipes
const teams = [];
for (const [t, label] of ["Les Grimpeurs", "Étage 42", "Casual Club"].entries()) {
  const team = await db.communityTeam.create({
    data: { communityId: cid, gameId: games[t].id, createdById: users[t * 5].id, captainId: users[t * 5].id, name: label, description: `Équipe ${label} : parties régulières le soir.`, platform: "PC", maxMembers: 8 },
  });
  for (let m = 0; m < 5; m++) await db.communityTeamMember.create({ data: { communityId: cid, teamId: team.id, userId: users[t * 5 + m].id } });
  teams.push(team);
}

// --- 5 soirées
const sessionSpecs = [
  { offset: 2, status: "SCHEDULED", visibility: "PUBLIC" }, { offset: 4, status: "VOTING", visibility: "PRIVATE" },
  { offset: 7, status: "SCHEDULED", visibility: "APPLICATION" }, { offset: -3, status: "DONE", visibility: "PRIVATE" }, { offset: -10, status: "DONE", visibility: "PRIVATE" },
];
const sessions = [];
for (const [i, spec] of sessionSpecs.entries()) {
  const session = await db.session.create({
    data: {
      date: new Date(now + spec.offset * day), status: spec.status, visibility: spec.visibility, createdById: users[i].id, communityId: cid,
      decidedGameId: spec.status !== "VOTING" ? games[i].id : null, decidedTime: spec.status !== "VOTING" ? new Date(now + spec.offset * day) : null,
      votingDeadline: new Date(now + (spec.offset - 1) * day),
    },
  });
  for (let g = 0; g < 3; g++) await db.proposal.create({ data: { sessionId: session.id, gameId: games[(i + g) % games.length].id, proposedById: users[(i + g) % users.length].id } });
  for (let u = 0; u < 8; u++) if (u !== i) await db.sessionInvite.create({ data: { sessionId: session.id, userId: users[u].id, invitedById: users[i].id } }).catch(() => {});
  sessions.push(session);
}

// --- 2 tournois (1 classique, 1 par équipes)
const tournaments = [];
for (const [i, label] of ["Coupe de la Tour", "Tournoi des équipes"].entries()) {
  const tournament = await db.tournament.create({ data: { name: label, createdById: users[i].id, gameId: games[i + 4].id, maxPlayers: 8, communityId: cid, status: "REGISTRATION" } }).catch(async () => db.tournament.create({ data: { name: label, createdById: users[i].id, gameId: games[i + 4].id, maxPlayers: 8 } }));
  if (i === 0) for (let u = 0; u < 6; u++) await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: users[u].id } });
  tournaments.push(tournament);
}
await db.tournamentTeamSettings.create({ data: { tournamentId: tournaments[1].id, communityId: cid, maxTeams: 4 } }).catch(() => {});
for (const team of teams.slice(0, 2)) await db.tournamentTeamEntry.create({ data: { communityId: cid, tournamentId: tournaments[1].id, teamId: team.id, status: "REGISTERED" } }).catch(() => {});

// --- Défis Tower : catalogue, progression, tentatives
const definitions = [];
for (const [i, title] of ["Finis une partie sans mourir", "Fais gagner ton équipe avec un rôle inhabituel", "Réussis un défi créatif : dessine ton personnage", "Joue 2 heures avec un inconnu", "Découvre un jeu que tu ne possèdes pas encore"].entries()) {
  definitions.push(await db.towerChallengeDefinition.create({ data: { communityId: cid, title, instructions: `Consigne du défi n°${i + 1} : réalise-le, poste une preuve avec ton code.`, rewardFloors: 1 + (i % 3), active: true, mode: "SOLO" } }));
}
for (const [i, user] of users.slice(0, 10).entries()) {
  await db.towerChallengeProgress.upsert({ where: { communityId_userId: { communityId: cid, userId: user.id } }, update: {}, create: { communityId: cid, userId: user.id, floorsClimbed: BigInt(i * 3) } });
}
const attemptStatuses = ["ASSIGNED", "SUBMITTED", "APPROVED", "REJECTED"];
for (const [i, status] of attemptStatuses.entries()) {
  const definition = definitions[i];
  await db.towerChallengeAttempt.create({ data: {
    communityId: cid, userId: users[i].id, definitionId: definition.id, requestKey: `preuve-${i}`, title: definition.title, instructions: definition.instructions,
    rewardFloors: definition.rewardFloors, assignedAt: new Date(now - day), expiresAt: new Date(now + day), status,
    ...(status !== "ASSIGNED" ? { submittedAt: new Date(now - 3600_000), proofText: "Voici ma preuve TWR-ABCD2345", proofChannelId: "123456789012345678", proofMessageId: "223456789012345678", publicationConsent: true } : {}),
    ...(status === "APPROVED" ? { rewardedAt: new Date() } : {}),
  } }).catch(error => console.warn("tentative", status, String(error.message).split("\n").pop()));
}

// --- Booster
await db.boosterSupport.create({ data: { communityId: cid, userId: users[2].id, discordId: users[2].discordId, boosting: true, since: new Date(now - 5 * day), roleGranted: true, checkedAt: new Date() } }).catch(() => {});

// --- Annonce de recherche de joueurs, projet, notification in-app d'exemple
await db.playerClassified.create({ data: { communityId: cid, gameId: games[0].id, createdById: users[3].id, message: "Cherche 2 joueurs pour Overcooked ce soir", createdAt: new Date(), expiresAt: new Date(now + day) } }).catch(() => {});
await db.project.create({ data: { communityId: cid, organizerId: users[1].id, name: "Projet Minecraft : la Tour", description: "Construire la Tour de Dieu en 3 semaines.", endsAt: new Date(now + 21 * day) } }).catch(() => {});
await db.notification.create({ data: { userId: users[0].id, type: "SESSION_CREATED", title: "Invitation", message: "Alice t'invite à une soirée." } }).catch(error => console.warn("notification", String(error.message).split("\n").pop()));

console.log(JSON.stringify({ communityId: cid, users: users.length + 2, teams: teams.length, sessions: sessions.length, tournaments: tournaments.length, definitions: definitions.length, newcomer: newcomer.discordId, active: active.discordId, admin: admin.discordId }));
await db.$disconnect();
