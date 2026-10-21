// Recette navigateur authentifiée : veto, MVP (superlatifs), boutique XP, calendrier, mobile 390x844.
// Vrai navigateur/Next/PostgreSQL local dédié ; aucun appel externe (Discord, OAuth, Push, Blob).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";
import { recetteDatabaseTarget } from "./recette-database-target.mjs";
import { disableExistingSuperlativeCategories, restoreRecipeSuperlativeCategories } from "./recette-superlative-category-state.mjs";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
const recipeTarget = recetteDatabaseTarget();
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port || "5432", recipeTarget.port);
assert.equal(database.pathname, `/${recipeTarget.database}`);
assert.ok(!process.env.DOCKER_HOST, "DOCKER_HOST distant interdit");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) assert.ok(!existsSync(file), `Environnement interdit : ${file}`);
assertLocalDockerContext();
const container = recipeTarget.container;
assert.equal(execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).trim(), `127.0.0.1:${recipeTarget.port}`);
const addresses = execFileSync("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], { encoding: "utf8" }).trim().split(/\s+/);
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core hors dépendances app requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = "http://127.0.0.1:3117";
const run = `parcours-${randomUUID()}`;
const output = resolve("logs", run);
const secret = randomUUID();
const results = [];
const errors = [];
let browser, server;
const superlativeCategoryState = {};

async function step(name, body) {
  const started = Date.now();
  try {
    const detail = await body();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`OK   ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.message.split("\n")[0] });
    console.error(`ECHEC ${name}: ${error.message.split("\n")[0]}`);
    for (const [key, page] of Object.entries(globalThis.recettePages ?? {})) console.error(`  [${key}] ${page.url()} :: ${(await bodyText(page).catch(() => "?")).replace(/\s+/g, " ").slice(0, 500)}`);
  }
}
async function waitFor(read, message, limit = 30_000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.fail(message);
}
const day = offset => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset, 20, 0, 0));
const isoDay = date => date.toISOString().slice(0, 10);
const bodyText = page => page.locator("body").innerText();

try {
  const [target] = await db.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port`;
  assert.equal(target.name, recipeTarget.database);
  assert.equal(target.port, 5432);
  assert.ok(addresses.includes(target.address.split("/")[0]), "Cible différente du conteneur dédié");
  await assert.rejects(fetch(origin), "Port Next déjà occupé");
  mkdirSync(output, { recursive: true });

  // Fixtures isolées : une communauté, cinq comptes fictifs.
  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE" } });
  const people = {};
  for (const [key, label, role] of [["alice", "Alice", "OWNER"], ["bob", "Bob", "MEMBER"], ["carol", "Carol", "MEMBER"], ["dave", "Dave", "MEMBER"]]) {
    const user = await db.user.create({ data: { discordId: `${run}-${key}`, discordName: label, onboardingCompleted: true, activeCommunityId: community.id } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id, role } });
    people[key] = user;
  }
  people.eve = await db.user.create({ data: { discordId: `${run}-eve`, discordName: "Eve", onboardingCompleted: true } });
  const { alice, bob, carol, dave, eve } = people;
  const games = {};
  for (const name of ["Alpha", "Beta"]) {
    games[name] = await db.game.create({ data: { name: `${name} ${run.slice(-6)}`, source: "MANUAL", addedById: alice.id, minPlayers: 1, maxPlayers: 4 } });
    for (const user of [alice, bob, carol]) await db.userGame.create({ data: { userId: user.id, gameId: games[name].id, owned: true } });
  }
  const label = name => games[name].name;
  async function session(data, invited = [bob, carol, dave]) {
    const created = await db.session.create({ data: { communityId: community.id, createdById: alice.id, ...data } });
    for (const user of invited) await db.sessionInvite.create({ data: { sessionId: created.id, userId: user.id, invitedById: alice.id } });
    return created;
  }
  const voteDate = day(5);
  for (const user of [alice, bob, carol]) await db.availabilityOverride.create({ data: { userId: user.id, date: voteDate, available: true } });
  const veto = await session({ date: voteDate, status: "VOTING" });
  const proposals = {};
  for (const [name, proposer] of [["Alpha", alice], ["Beta", bob]]) proposals[name] = await db.proposal.create({ data: { sessionId: veto.id, gameId: games[name].id, proposedById: proposer.id } });
  const emptyVote = await session({ date: day(6), status: "VOTING" });
  // Les catégories sont globales : conserver et restaurer les états présents avant la recette.
  await disableExistingSuperlativeCategories(db, superlativeCategoryState);
  const recipeCategory = await db.superlativeCategory.create({ data: { icon: "🏅", name: `MVP de la soirée ${run.slice(-6)}`, modifiedById: alice.id } });
  superlativeCategoryState.recipeCategoryId = recipeCategory.id;
  const notificationSourceIds = [veto.id, emptyVote.id];
  async function doneSession(participants) {
    const created = await session({ date: day(-1), status: "DONE", decidedGameId: games.Alpha.id, superlativeVotingClosed: false, superlativeVotingDeadline: new Date(Date.now() + 86_400_000) });
    const proposal = await db.proposal.create({ data: { sessionId: created.id, gameId: games.Alpha.id, proposedById: alice.id } });
    for (const user of participants) await db.vote.create({ data: { proposalId: proposal.id, userId: user.id } });
    return created;
  }
  const mvp = await doneSession([alice, bob, carol]);
  const mvpForce = await doneSession([alice, bob]);
  const mvpNobody = await doneSession([alice, bob]);
  notificationSourceIds.push(mvp.id, mvpForce.id, mvpNobody.id);
  await db.communityMemberStats.upsert({ where: { communityId_userId: { communityId: community.id, userId: alice.id } }, create: { communityId: community.id, userId: alice.id, xpTotal: 300 }, update: { xpTotal: 300 } });
  await db.communityMemberStats.create({ data: { communityId: community.id, userId: bob.id, xpTotal: 250 } });

  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD|VERCEL|NODE_OPTIONS/.test(key)) delete childEnv[key];
  Object.assign(childEnv, {
    NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href,
    AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin, NEXT_TELEMETRY_DISABLED: "1",
    COMMUNITY_ISOLATION_ENABLED: "true", VOTE_VETO_ENABLED: "true",
    GAMENIGHT_RECIPE_BLOB_ORIGIN: "http://127.0.0.1:3118",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/recette-medias-transport.mjs")).href}`,
  });
  const log = openSync(resolve(output, "next.log"), "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3117"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const deadline = Date.now() + 180_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* démarrage Next local */ }
    assert.ok(Date.now() < deadline && server.exitCode === null, `Next indisponible : ${output}/next.log`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function contextFor(user) {
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (user) {
      const name = "authjs.session-token";
      const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
      await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
      await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
    }
    return context;
  }
  async function pageIn(context) {
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(180_000);
    page.on("pageerror", error => errors.push(error.message));
    return page;
  }
  const pageFor = async user => pageIn(await contextFor(user));
  const pages = globalThis.recettePages = {};
  for (const key of ["alice", "bob", "carol", "dave", "eve"]) pages[key] = await pageFor(people[key]);

  // ---------- VETO ----------
  const vetoUrl = `${origin}/sessions/${veto.id}`;
  const vetoRows = () => db.sessionVeto.findMany({ where: { sessionId: veto.id } });
  const card = (page, name) => page.locator("div,li,article").filter({ hasText: label(name) }).filter({ has: page.getByRole("button", { name: /veto/i }) }).last();
  await step("veto : deux jeux JOUABLES et un bouton veto chacun", async () => {
    await pages.bob.goto(vetoUrl, { waitUntil: "domcontentloaded" });
    await pages.bob.getByText(label("Alpha")).first().waitFor();
    assert.equal(await pages.bob.getByRole("button", { name: "Poser mon veto sur ce jeu" }).count(), 2);
    assert.equal(await pages.bob.getByText("JOUABLE", { exact: true }).count(), 2);
  });
  await step("veto : Bob pose un veto sur Alpha (toast, badge VETOÉ, base)", async () => {
    await card(pages.bob, "Alpha").getByRole("button", { name: "Poser mon veto sur ce jeu" }).waitFor();
    await card(pages.bob, "Alpha").getByRole("button", { name: "Poser mon veto sur ce jeu" }).click();
    const rows = await waitFor(async () => { const r = await vetoRows(); return r.length === 1 && r; }, "veto absent");
    assert.equal(rows[0].proposalId, proposals.Alpha.id);
    await pages.bob.getByText("Veto posé").first().waitFor();
    await pages.bob.getByText("VETOÉ", { exact: true }).waitFor();
  });
  await step("veto : un nouveau veto de Bob remplace le précédent (1 par personne)", async () => {
    await card(pages.bob, "Beta").getByRole("button", { name: "Poser mon veto sur ce jeu" }).click();
    const rows = await waitFor(async () => { const r = await vetoRows(); return r[0]?.proposalId === proposals.Beta.id && r; }, "veto non remplacé");
    assert.equal(rows.length, 1);
  });
  await step("veto échec : Carol ne peut pas vetoer le dernier jeu restant", async () => {
    await pages.carol.goto(vetoUrl, { waitUntil: "domcontentloaded" });
    await pages.carol.getByText(label("Alpha")).first().waitFor();
    await card(pages.carol, "Alpha").getByRole("button", { name: "Poser mon veto sur ce jeu" }).waitFor();
    await card(pages.carol, "Alpha").getByRole("button", { name: "Poser mon veto sur ce jeu" }).click();
    await pages.carol.getByText("Impossible : il ne resterait aucun jeu possible.").waitFor();
    assert.equal((await vetoRows()).length, 1);
  });
  await step("veto : Bob retire son veto, puis Carol peut vetoer", async () => {
    await card(pages.bob, "Beta").getByRole("button", { name: "Retirer mon veto" }).waitFor();
    await card(pages.bob, "Beta").getByRole("button", { name: "Retirer mon veto" }).click();
    await waitFor(async () => (await vetoRows()).length === 0, "veto non retiré");
    await card(pages.carol, "Alpha").getByRole("button", { name: "Poser mon veto sur ce jeu" }).click();
    await waitFor(async () => (await vetoRows())[0]?.userId === carol.id, "veto Carol absent");
  });
  await step("veto : état vide (soirée sans proposition) sans bouton veto", async () => {
    await pages.bob.goto(`${origin}/sessions/${emptyVote.id}`, { waitUntil: "domcontentloaded" });
    await pages.bob.getByText("Aucun jeu proposé pour l'instant.").waitFor();
    assert.equal(await pages.bob.getByRole("button", { name: /veto/i }).count(), 0);
  });
  await step("veto interdit : compte sans accès (Eve) ne voit pas la soirée", async () => {
    const response = await pages.eve.goto(vetoUrl, { waitUntil: "domcontentloaded" });
    const text = await bodyText(pages.eve);
    assert.ok(response.status() === 404 || !text.includes(label("Alpha")), "soirée visible hors communauté");
    assert.equal(await pages.eve.getByRole("button", { name: /veto/i }).count(), 0);
    return `HTTP ${response.status()}`;
  });

  // ---------- MVP ----------
  const voteUrl = id => `${origin}/sessions/${id}/vote-superlatifs`;
  await step("MVP interdit : Dave (invité non participant) et Eve (sans accès)", async () => {
    await pages.dave.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" });
    await pages.dave.getByText("Tu n'as pas participé à cette soirée").waitFor();
    assert.equal(await pages.dave.getByRole("button", { name: "Valider mes votes" }).count(), 0);
    const response = await pages.eve.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" });
    assert.ok(response.status() === 404 || !(await bodyText(pages.eve)).includes("Récompenses"), "vote visible hors communauté");
  });
  await step("MVP : bouton désactivé jusqu'au choix, pas de vote pour soi", async () => {
    await pages.alice.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" });
    const submit = pages.alice.getByRole("button", { name: "Valider mes votes" });
    await submit.waitFor();
    await pages.alice.locator("form").getByRole("button", { name: "Bob", exact: true }).waitFor();
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await pages.alice.locator("form").getByRole("button", { name: "Alice", exact: true }).count(), 0);
    await pages.alice.locator("form").getByRole("button", { name: "Bob", exact: true }).click();
    assert.equal(await submit.isDisabled(), false);
    await submit.click();
    await pages.alice.getByText("Vote enregistré").waitFor();
    assert.equal(await db.superlativeVote.count({ where: { sessionId: mvp.id, voterUserId: alice.id } }), 1);
  });
  await step("MVP : votes simultanés de Bob et Carol (clôture concurrente) sans erreur ni doublon", async () => {
    await Promise.all([pages.bob.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" }), pages.carol.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" })]);
    for (const page of [pages.bob, pages.carol]) {
      await page.getByRole("button", { name: "Valider mes votes" }).waitFor();
      await page.locator("form").getByRole("button", { name: "Alice", exact: true }).waitFor();
      await page.locator("form").getByRole("button", { name: "Alice", exact: true }).click();
    }
    await Promise.all([pages.bob, pages.carol].map(page => page.getByRole("button", { name: "Valider mes votes" }).click()));
    await waitFor(async () => (await db.session.findUnique({ where: { id: mvp.id } })).superlativeVotingClosed, "vote non clôturé");
    const awards = await db.superlativeAward.findMany({ where: { sessionId: mvp.id } });
    assert.equal(awards.length, 1);
    assert.equal(awards[0].winnerUserId, alice.id);
    assert.equal(awards[0].voteCount, 2);
    const duplicates = await db.xpEvent.groupBy({ by: ["userId", "reason", "sourceId"], where: { communityId: community.id }, _count: { _all: true }, having: { userId: { _count: { gt: 1 } } } });
    assert.deepEqual(duplicates, []);
    await pages.alice.goto(voteUrl(mvp.id), { waitUntil: "domcontentloaded" });
    await pages.alice.getByText("Alice — 2 voix").waitFor();
    return "1 award, 2 voix";
  });
  await step("MVP : seul le créateur voit « Forcer la clôture » ; état vide après clôture sans vote", async () => {
    await pages.bob.goto(voteUrl(mvpForce.id), { waitUntil: "domcontentloaded" });
    await pages.bob.getByRole("button", { name: "Valider mes votes" }).waitFor();
    assert.equal(await pages.bob.getByRole("button", { name: "Forcer la clôture des votes maintenant" }).count(), 0);
    await pages.alice.goto(voteUrl(mvpNobody.id), { waitUntil: "domcontentloaded" });
    await pages.alice.getByRole("button", { name: "Forcer la clôture des votes maintenant" }).waitFor();
    await pages.alice.getByRole("button", { name: "Forcer la clôture des votes maintenant" }).click();
    await pages.alice.getByText("Personne n'a voté pour cette soirée").waitFor();
    assert.equal(await db.superlativeAward.count({ where: { sessionId: mvpNobody.id } }), 0);
  });

  // ---------- BOUTIQUE ----------
  const shop = `${origin}/profil/boutique`;
  // Le MVP a pu créditer de l'XP à Alice : le solde de départ de la boutique est refixé.
  await db.communityMemberStats.update({ where: { communityId_userId: { communityId: community.id, userId: alice.id } }, data: { xpTotal: 300 } });
  const stats = user => db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: community.id, userId: user.id } } });
  await step("boutique : achat d'un objet à 200 XP (solde 300 -> 100, ledger, possédé)", async () => {
    await pages.alice.goto(shop, { waitUntil: "domcontentloaded" });
    await pages.alice.getByText("Solde de cette communauté : 300 XP").waitFor();
    await pages.alice.getByRole("button", { name: "Acheter Menthe pour 200 XP" }).waitFor();
    await pages.alice.getByRole("button", { name: "Acheter Menthe pour 200 XP" }).click();
    await pages.alice.getByText("Achat effectué.").waitFor();
    await pages.alice.getByText("Solde de cette communauté : 100 XP").waitFor();
    assert.equal((await stats(alice)).xpTotal, 100);
    assert.equal(await db.communityMemberCosmetic.count({ where: { userId: alice.id, itemId: "color-mint" } }), 1);
    assert.equal(await db.xpEvent.count({ where: { userId: alice.id, reason: "SHOP_PURCHASE", amount: -200 } }), 1);
  });
  await step("boutique échec : solde insuffisant (300 XP demandés, 100 disponibles)", async () => {
    await pages.alice.getByRole("button", { name: "Acheter Nébuleuse pour 300 XP" }).waitFor();
    await pages.alice.getByRole("button", { name: "Acheter Nébuleuse pour 300 XP" }).click();
    await pages.alice.getByText("Ton solde XP est insuffisant.").waitFor();
    assert.equal((await stats(alice)).xpTotal, 100);
    assert.equal(await db.communityMemberCosmetic.count({ where: { userId: alice.id } }), 1);
  });
  await step("boutique : équiper puis retirer l'objet possédé", async () => {
    await pages.alice.getByRole("button", { name: "Équiper Menthe" }).waitFor();
    assert.equal(await pages.alice.getByRole("button", { name: "Acheter Menthe pour 200 XP" }).count(), 0);
    await pages.alice.getByRole("button", { name: "Équiper Menthe" }).click();
    await pages.alice.getByText("Équipement mis à jour.").waitFor();
    await pages.alice.getByText("Possédé · Équipé").waitFor();
    assert.equal((await stats(alice)).equippedColorId, "color-mint");
    await pages.alice.getByRole("button", { name: "Retirer l’équipement" }).waitFor();
    await pages.alice.getByRole("button", { name: "Retirer l’équipement" }).click();
    await waitFor(async () => (await stats(alice)).equippedColorId === null, "équipement non retiré");
  });
  await step("boutique : double achat concurrent (2 onglets, 250 XP, objet à 250) = 1 achat, solde jamais négatif", async () => {
    const second = await pageIn(await contextFor(bob));
    await Promise.all([pages.bob.goto(shop, { waitUntil: "domcontentloaded" }), second.goto(shop, { waitUntil: "domcontentloaded" })]);
    for (const page of [pages.bob, second]) await page.getByRole("button", { name: "Acheter Glace pour 250 XP" }).waitFor();
    await Promise.all([pages.bob, second].map(page => page.getByRole("button", { name: "Acheter Glace pour 250 XP" }).click()));
    await waitFor(async () => (await db.communityMemberCosmetic.count({ where: { userId: bob.id } })) >= 1, "achat absent");
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(await db.communityMemberCosmetic.count({ where: { userId: bob.id } }), 1);
    assert.equal((await stats(bob)).xpTotal, 0);
    assert.equal(await db.xpEvent.count({ where: { userId: bob.id, reason: "SHOP_PURCHASE" } }), 1);
  });
  await step("boutique interdite : compte sans communauté redirigé hors de la boutique", async () => {
    await pages.eve.goto(shop, { waitUntil: "domcontentloaded" });
    await pages.eve.waitForURL(url => !url.pathname.startsWith("/profil/boutique"));
    assert.ok(!new URL(pages.eve.url()).pathname.startsWith("/profil/boutique"), `URL ${pages.eve.url()}`);
    return new URL(pages.eve.url()).pathname;
  });

  // ---------- CALENDRIER ----------
  const calDate = isoDay(voteDate);
  await step("calendrier : mois, jour sélectionné exposé sans aria-pressed, soirée visible", async () => {
    await pages.bob.goto(`${origin}/calendrier?date=${calDate}`, { waitUntil: "domcontentloaded" });
    await pages.bob.getByRole("heading", { name: "Le calendrier" }).waitFor();
    const selected = pages.bob.getByRole("link", { name: /, date sélectionnée$/ });
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.getAttribute("aria-pressed"), null);
    assert.ok(await pages.bob.locator(`a[href="/sessions/${veto.id}"]`).count() >= 1, "soirée absente de la grille");
  });
  await step("calendrier : vue semaine = 7 jours lundi-dimanche", async () => {
    await pages.bob.goto(`${origin}/calendrier?date=${calDate}&vue=semaine`, { waitUntil: "domcontentloaded" });
    await pages.bob.getByRole("heading", { name: "Le calendrier" }).waitFor();
    assert.equal(await pages.bob.locator("a.gn-calendar-date").count(), 7);
  });
  await step("calendrier : droits — formulaire serveur réservé OWNER/ADMIN, anniversaire pour tout membre", async () => {
    assert.equal(await pages.bob.getByLabel("Date importante", { exact: true }).count(), 0);
    assert.equal(await pages.bob.getByLabel("Partager ton anniversaire avec ce serveur").count(), 1);
    await pages.alice.goto(`${origin}/calendrier?date=${calDate}`, { waitUntil: "domcontentloaded" });
    assert.equal(await pages.alice.getByLabel("Date importante", { exact: true }).count(), 1);
  });
  await step("calendrier : Bob partage son anniversaire (année non conservée, URL sans date)", async () => {
    await pages.bob.goto(`${origin}/calendrier`, { waitUntil: "domcontentloaded" });
    await pages.bob.getByLabel("Partager ton anniversaire avec ce serveur").waitFor();
    await pages.bob.getByLabel("Partager ton anniversaire avec ce serveur").fill("1990-07-14");
    await pages.bob.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const row = await waitFor(() => db.communityDate.findFirst({ where: { communityId: community.id, memberId: bob.id } }), "anniversaire absent");
    assert.equal(row.kind, "BIRTHDAY");
    assert.equal(row.date.toISOString().slice(0, 10), "2000-07-14");
    await waitFor(async () => !new URL(pages.bob.url()).search.includes("1990"), "année dans l'URL");
  });
  await step("calendrier : Alice (OWNER) ajoute une date importante", async () => {
    await pages.alice.goto(`${origin}/calendrier?date=${calDate}`, { waitUntil: "domcontentloaded" });
    await pages.alice.getByPlaceholder("Anniversaire du serveur…").waitFor();
    await pages.alice.getByPlaceholder("Anniversaire du serveur…").fill("Anniversaire recette");
    await pages.alice.getByRole("button", { name: "Ajouter", exact: true }).click();
    const row = await waitFor(() => db.communityDate.findFirst({ where: { communityId: community.id, kind: "IMPORTANT" } }), "date importante absente");
    assert.equal(row.title, "Anniversaire recette");
    assert.equal(row.createdById, alice.id);
  });
  await step("calendrier : export .ics (membre OK, anonyme 401, hors communauté sans la soirée)", async () => {
    const own = await pages.bob.request.get(`${origin}/api/calendrier/export`);
    assert.equal(own.status(), 200);
    assert.match(own.headers()["content-type"], /text\/calendar/);
    assert.ok((await own.text()).includes(veto.id), "soirée absente de l'export");
    const anonymous = await (await contextFor(null)).request.get(`${origin}/api/calendrier/export`);
    assert.equal(anonymous.status(), 401);
    const outsider = await pages.eve.request.get(`${origin}/api/calendrier/export`);
    assert.ok(!(await outsider.text()).includes(veto.id), "fuite de soirée hors communauté");
    return `eve HTTP ${outsider.status()}`;
  });

  // ---------- MOBILE 390x844 ----------
  for (const [name, user, path, ready] of [
    ["session veto", "bob", `/sessions/${veto.id}`, page => page.getByText(label("Alpha")).first()],
    ["vote MVP après clôture", "alice", `/sessions/${mvp.id}/vote-superlatifs`, page => page.getByText("Alice — 2 voix")],
    ["vote MVP interdit", "dave", `/sessions/${mvp.id}/vote-superlatifs`, page => page.getByText("Tu n'as pas participé à cette soirée")],
    ["boutique", "bob", "/profil/boutique", page => page.getByRole("heading", { name: "Boutique XP" })],
    ["calendrier mois", "bob", `/calendrier?date=${calDate}`, page => page.getByRole("heading", { name: "Le calendrier" })],
    ["calendrier semaine", "alice", `/calendrier?date=${calDate}&vue=semaine`, page => page.getByRole("heading", { name: "Le calendrier" })],
  ]) {
    await step(`mobile 390x844 sans débordement : ${name}`, async () => {
      const page = pages[user];
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
      await ready(page).waitFor();
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
      await page.screenshot({ path: resolve(output, `mobile-${name.replaceAll(" ", "-")}.png`), fullPage: true });
      assert.ok(scrollWidth <= innerWidth, `débordement ${scrollWidth} > ${innerWidth}`);
      return `${scrollWidth}<=${innerWidth}`;
    });
  }
  await step("aucun NotificationDelivery ni erreur de page", async () => {
    assert.equal(await db.notificationDelivery.count({ where: { event: { communityId: community.id, sourceId: { in: notificationSourceIds } } } }), 0);
    assert.deepEqual(errors, []);
  });
  const failed = results.filter(result => !result.ok);
  writeFileSync(resolve(output, "preuve.json"), JSON.stringify({ run, transport: "aucun appel externe (HTTP externe bloqué)", total: results.length, failed: failed.length, results }, null, 2));
  console.log(`${results.length - failed.length}/${results.length} étapes OK; preuves ${output}`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch (error) { console.error(`Fermeture navigateur échouée : ${error.message}`); process.exitCode = 1; }
  if (server && server.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else server.kill();
  }
  try {
    await restoreRecipeSuperlativeCategories(db, superlativeCategoryState);
  } catch (error) {
    console.error(`Restauration catégories échouée : ${error.message}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
