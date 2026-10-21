// Recette navigateur complémentaire : veto flag OFF, roulette + veto de roulette, abonnement calendrier,
// rôle ADMIN distinct d'OWNER, POST forgé de createCommunityDateAction/deleteCommunityDateAction par un MEMBER.
// Deux serveurs Next successifs (jamais en parallèle) : phase A flags allumés, phase B flags éteints.
// Vrai navigateur/Next/PostgreSQL local dédié ; aucun appel externe (Discord, OAuth, Push, Blob).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "55447");
assert.equal(database.pathname, "/gamenight_fixe2_browser");
assert.ok(!process.env.DOCKER_HOST, "DOCKER_HOST distant interdit");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) assert.ok(!existsSync(file), `Environnement interdit : ${file}`);
assertLocalDockerContext();
const container = "gamenight-fixe2-browser-pg";
assert.equal(execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).trim(), "127.0.0.1:55447");
const addresses = execFileSync("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], { encoding: "utf8" }).trim().split(/\s+/);
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core hors dépendances app requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = "http://127.0.0.1:3117";
const run = `complements-${randomUUID()}`;
const output = resolve("logs", run);
const secret = randomUUID();
const results = [];
const errors = [];
let browser, server;

async function step(name, body) {
  const started = Date.now();
  try {
    const detail = await body();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`OK   ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.message.split("\n").slice(0, 5).join(" / ") });
    console.error(`ECHEC ${name}: ${error.message.split("\n").slice(0, 5).join(" / ")}`);
    for (const [key, page] of Object.entries(globalThis.recettePages ?? {})) console.error(`  [${key}] ${page.url()} :: ${(await bodyText(page).catch(() => "?")).replace(/\s+/g, " ").slice(0, 400)}`);
  }
}
async function waitFor(read, message, limit = 30_000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.fail(message);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = offset => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offset, 20, 0, 0));
const isoDay = date => date.toISOString().slice(0, 10);
const bodyText = page => page.locator("body").innerText();

async function startServer(flags, tag) {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD|VERCEL|NODE_OPTIONS/.test(key)) delete childEnv[key];
  Object.assign(childEnv, {
    NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href,
    AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin, NEXT_TELEMETRY_DISABLED: "1",
    COMMUNITY_ISOLATION_ENABLED: "true", GAMENIGHT_RECIPE_BLOB_ORIGIN: "http://127.0.0.1:3118",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/recette-medias-transport.mjs")).href}`,
    ...flags,
  });
  const log = openSync(resolve(output, `next-${tag}.log`), "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3117"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const deadline = Date.now() + 180_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* démarrage Next local */ }
    assert.ok(Date.now() < deadline && server.exitCode === null, `Next indisponible : ${output}/next-${tag}.log`);
    await sleep(500);
  }
}
async function stopServer() {
  if (server && server.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else server.kill();
  }
  server = undefined;
  const end = Date.now() + 30_000;
  while (Date.now() < end) { try { await fetch(origin); } catch { return; } await sleep(300); }
  assert.fail("Next toujours actif sur 3117");
}

try {
  const [target] = await db.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port`;
  assert.equal(target.name, "gamenight_fixe2_browser");
  assert.equal(target.port, 5432);
  assert.ok(addresses.includes(target.address.split("/")[0]), "Cible différente du conteneur dédié");
  await assert.rejects(fetch(origin), "Port Next déjà occupé");
  mkdirSync(output, { recursive: true });

  // Fixtures isolées : une communauté, comptes fictifs (OWNER, ADMIN, MEMBER) + une autre communauté.
  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE" } });
  const other = await db.community.create({ data: { slug: `${run}-autre`, name: `${run}-autre`, status: "ACTIVE" } });
  const people = {};
  for (const [key, label, role] of [["alice", "Alice", "OWNER"], ["casey", "Casey", "ADMIN"], ["bob", "Bob", "MEMBER"], ["carol", "Carol", "MEMBER"], ["dave", "Dave", "MEMBER"]]) {
    const user = await db.user.create({ data: { discordId: `${run}-${key}`, discordName: label, onboardingCompleted: true, activeCommunityId: community.id } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id, role } });
    people[key] = user;
  }
  const { alice, casey, bob, carol, dave } = people;
  const stranger = await db.user.create({ data: { discordId: `${run}-zed`, discordName: "Zed", onboardingCompleted: true, activeCommunityId: other.id } });
  await db.membership.create({ data: { userId: stranger.id, communityId: other.id, role: "OWNER" } });
  const games = {};
  for (const name of ["G1", "G2", "G3"]) games[name] = await db.game.create({ data: { name: `${name} ${run.slice(-6)}`, source: "MANUAL", addedById: alice.id, minPlayers: 1, maxPlayers: 6 } });
  for (const user of [alice, bob, carol]) for (const name of ["G1", "G2", "G3"]) await db.userGame.create({ data: { userId: user.id, gameId: games[name].id, owned: true } });
  const everyone = [alice, casey, bob, carol, dave];
  async function plannedSession(date, status, extra = {}) {
    const created = await db.session.create({ data: { communityId: community.id, createdById: alice.id, date, status, ...extra } });
    for (const user of everyone.filter(user => user.id !== alice.id)) await db.sessionInvite.create({ data: { sessionId: created.id, userId: user.id, invitedById: alice.id } });
    return created;
  }
  // Soirée de vote (veto flag OFF) : disponibilité forcée pour que les jeux soient JOUABLES.
  const voteDate = day(5);
  for (const user of [alice, bob, carol]) await db.availabilityOverride.create({ data: { userId: user.id, date: voteDate, available: true } });
  const vote = await plannedSession(voteDate, "VOTING");
  const proposals = [];
  for (const name of ["G1", "G2"]) proposals.push(await db.proposal.create({ data: { sessionId: vote.id, gameId: games[name].id, proposedById: alice.id } }));
  // Soirée d'une autre communauté, Bob invité mais non membre : jamais dans son flux.
  const foreign = await db.session.create({ data: { communityId: other.id, createdById: stranger.id, date: day(7), status: "SCHEDULED" } });
  await db.sessionInvite.create({ data: { sessionId: foreign.id, userId: bob.id, invitedById: stranger.id } });
  // Deux roulettes asynchrones tirées (R1 vetoée en phase A, R2 intacte pour la phase B). Résultat initial G1.
  async function drawnRoulette(offset) {
    const planned = await plannedSession(day(offset), "SCHEDULED", { announceViaBot: true, decidedGameId: games.G1.id });
    const roulette = await db.roulette.create({
      data: { communityId: community.id, createdById: alice.id, scheduledAt: planned.date, deadline: new Date(Date.now() - 3_600_000), status: "DONE", resultGameId: games.G1.id, resultSessionId: planned.id, notifiedUserIds: everyone.map(user => user.id) },
    });
    for (const [user, names] of [[alice, ["G1", "G2"]], [bob, ["G2", "G3"]], [carol, ["G3", "G1"]]]) for (const name of names) await db.rouletteEntry.create({ data: { rouletteId: roulette.id, userId: user.id, gameId: games[name].id } });
    const proposal = await db.proposal.create({ data: { sessionId: planned.id, gameId: games.G1.id, proposedById: alice.id } });
    for (const user of [alice, bob, carol]) await db.vote.create({ data: { proposalId: proposal.id, userId: user.id } });
    return { roulette, planned };
  }
  const r1 = await drawnRoulette(3);
  const r2 = await drawnRoulette(4);
  const notificationScope = {
    event: {
      communityId: community.id,
      sourceId: { in: [vote.id, r1.roulette.id, r1.planned.id, r2.roulette.id, r2.planned.id] },
    },
  };
  const calDate = isoDay(voteDate);

  await startServer({ VOTE_VETO_ENABLED: "true", CALENDAR_SUBSCRIPTIONS_ENABLED: "true" }, "a");
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
  const pages = globalThis.recettePages = {};
  const contexts = {};
  async function openPages() {
    for (const key of ["alice", "casey", "bob", "carol", "dave"]) {
      contexts[key] = await contextFor(people[key]);
      const page = await contexts[key].newPage();
      page.setDefaultTimeout(45_000);
      page.setDefaultNavigationTimeout(180_000);
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => dialog.accept());
      pages[key] = page;
    }
  }
  await openPages();
  const rouletteUrl = id => `${origin}/roulette/${id}`;
  const vetoButton = page => page.getByRole("button", { name: "Veto : relancer sans ce jeu" });
  const vetoes = id => db.rouletteVeto.findMany({ where: { rouletteId: id }, orderBy: { createdAt: "asc" } });

  // ================= PHASE A : flags allumés =================
  // ---------- ROULETTE + VETO DE ROULETTE ----------
  await step("roulette : participant voit le résultat tiré et le bouton veto ; invité non participant, non", async () => {
    await pages.carol.goto(rouletteUrl(r1.roulette.id));
    await pages.carol.getByText(games.G1.name).first().waitFor();
    await vetoButton(pages.carol).waitFor();
    await pages.dave.goto(rouletteUrl(r1.roulette.id));
    await pages.dave.getByText(games.G1.name).first().waitFor();
    assert.equal(await vetoButton(pages.dave).count(), 0);
  });
  await step("roulette interdit : Zed (autre communauté) ne voit pas la roulette", async () => {
    const context = await contextFor(stranger);
    const page = await context.newPage();
    const response = await page.goto(rouletteUrl(r1.roulette.id));
    assert.ok(response.status() === 404 || !(await bodyText(page)).includes(games.G1.name), "roulette visible hors invités");
    assert.equal(await vetoButton(page).count(), 0);
    return `HTTP ${response.status()}`;
  });
  let afterFirst;
  await step("roulette : Carol vetoe G1 -> relance sans G1 (soirée et roulette mises à jour, 1 veto)", async () => {
    await pages.carol.waitForLoadState("networkidle");
    await vetoButton(pages.carol).click();
    await pages.carol.getByText("Nouveau jeu tiré").first().waitFor();
    const rows = await waitFor(async () => { const r = await vetoes(r1.roulette.id); return r.length === 1 && r; }, "veto absent");
    const roulette = await db.roulette.findUniqueOrThrow({ where: { id: r1.roulette.id } });
    const planned = await db.session.findUniqueOrThrow({ where: { id: r1.planned.id } });
    assert.notEqual(roulette.resultGameId, games.G1.id);
    assert.equal(planned.decidedGameId, roulette.resultGameId);
    assert.equal(rows[0].gameId, games.G1.id);
    afterFirst = roulette.resultGameId;
    // Le veto relance un tirage : une proposition par participant votant, pas de doublon de proposition.
    assert.equal(await db.proposal.count({ where: { sessionId: r1.planned.id } }), 1);
    return `nouveau jeu != G1`;
  });
  await step("roulette échec : Carol ne peut pas vetoer deux fois (bouton retiré)", async () => {
    await waitFor(async () => (await vetoButton(pages.carol).count()) === 0, "bouton encore visible");
    assert.equal((await vetoes(r1.roulette.id)).length, 1);
  });
  await step("roulette : Bob vetoe le nouveau jeu, puis Alice : plus aucun candidat (échec explicite)", async () => {
    await pages.bob.goto(rouletteUrl(r1.roulette.id));
    await pages.bob.waitForLoadState("networkidle");
    await vetoButton(pages.bob).click();
    await waitFor(async () => (await vetoes(r1.roulette.id)).length === 2, "veto Bob absent");
    await pages.alice.goto(rouletteUrl(r1.roulette.id));
    await pages.alice.waitForLoadState("networkidle");
    await vetoButton(pages.alice).click();
    await pages.alice.getByText("Impossible : il ne reste aucun autre jeu à tirer.").waitFor();
    assert.equal((await vetoes(r1.roulette.id)).length, 2);
    const roulette = await db.roulette.findUniqueOrThrow({ where: { id: r1.roulette.id } });
    assert.notEqual(roulette.resultGameId, games.G1.id);
    assert.notEqual(roulette.resultGameId, afterFirst);
  });
  await step("roulette : 0 envoi Discord (aucun NotificationDelivery envoyée, exécuteur éteint)", async () => {
    const sent = await db.notificationDelivery.count({ where: { ...notificationScope, status: "SENT" } });
    assert.equal(sent, 0);
    return `${await db.notificationDelivery.count({ where: notificationScope })} livraisons en file, 0 envoyée`;
  });

  // ---------- ABONNEMENT CALENDRIER ----------
  let activeFeed;
  const anonymous = await contextFor(null);
  const feed = async url => anonymous.request.get(url);
  await step("abonnement : section visible, création d'un lien privé, flux .ics sans cookie", async () => {
    await pages.bob.goto(`${origin}/calendrier?date=${calDate}`);
    await pages.bob.getByRole("heading", { name: "S’abonner aux soirées" }).waitFor();
    await pages.bob.waitForLoadState("networkidle");
    await pages.bob.getByRole("button", { name: "Créer / renouveler le lien" }).click();
    const input = pages.bob.locator("#calendar-subscription-url");
    await input.waitFor();
    const url = await input.inputValue();
    assert.match(url, /\/api\/calendrier\/feed\/[A-Za-z0-9_-]{43}$/);
    const response = await feed(url);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /text\/calendar/);
    assert.equal(response.headers()["cache-control"], "private, no-store");
    assert.equal(response.headers()["x-robots-tag"], "noindex, noarchive");
    const text = await response.text();
    assert.ok(text.includes(vote.id), "soirée accessible absente du flux");
    assert.ok(!text.includes(foreign.id), "soirée d'une autre communauté dans le flux");
    activeFeed = url;
  });
  await step("abonnement : renouveler invalide l'ancien lien, révoquer arrête le flux, lien malformé = 404", async () => {
    const previous = activeFeed;
    await pages.bob.getByRole("button", { name: "Créer / renouveler le lien" }).click();
    await waitFor(async () => (await pages.bob.locator("#calendar-subscription-url").inputValue()) !== previous, "lien non renouvelé");
    const renewed = await pages.bob.locator("#calendar-subscription-url").inputValue();
    assert.equal((await feed(previous)).status(), 404);
    assert.equal((await feed(renewed)).status(), 200);
    await pages.bob.getByRole("button", { name: "Révoquer le lien de ce serveur" }).click();
    await pages.bob.getByText("Le lien de ce serveur est révoqué.").waitFor();
    assert.equal((await feed(renewed)).status(), 404);
    assert.equal((await feed(`${origin}/api/calendrier/feed/pas-un-jeton`)).status(), 404);
    await pages.bob.getByRole("button", { name: "Créer / renouveler le lien" }).click();
    await waitFor(async () => (await pages.bob.locator("#calendar-subscription-url").count()) > 0 && (await pages.bob.locator("#calendar-subscription-url").inputValue()) !== renewed, "lien final absent");
    activeFeed = await pages.bob.locator("#calendar-subscription-url").inputValue();
    assert.equal((await feed(activeFeed)).status(), 200);
    assert.equal(await db.calendarFeedToken.count({ where: { userId: bob.id, revokedAt: null } }), 1);
  });
  await step("abonnement : le jeton n'est stocké que haché (jamais en clair en base)", async () => {
    const token = activeFeed.split("/").pop();
    const rows = await db.calendarFeedToken.findMany({ where: { userId: bob.id } });
    assert.ok(rows.length >= 1);
    assert.ok(rows.every(row => !JSON.stringify(row).includes(token)), "jeton en clair");
  });

  // ---------- ADMIN distinct d'OWNER + POST forgé ----------
  const calendar = `${origin}/calendrier?date=${calDate}`;
  const dates = title => db.communityDate.findMany({ where: { communityId: community.id, title } });
  let createRequest, deleteRequest;
  await step("ADMIN : Casey voit le formulaire serveur et crée une date importante (créée par Casey)", async () => {
    await pages.casey.goto(calendar);
    await pages.casey.waitForLoadState("networkidle");
    assert.equal(await pages.casey.getByLabel("Date importante", { exact: true }).count(), 1);
    await pages.casey.getByPlaceholder("Anniversaire du serveur…").fill("Date Casey");
    await pages.casey.getByRole("button", { name: "Ajouter", exact: true }).click();
    const [row] = await waitFor(async () => { const r = await dates("Date Casey"); return r.length === 1 && r; }, "date Casey absente");
    assert.equal(row.createdById, casey.id);
    assert.equal(row.kind, "IMPORTANT");
  });
  await step("OWNER : Alice crée une date (requête de création capturée pour le rejeu forgé)", async () => {
    await pages.alice.goto(calendar);
    await pages.alice.waitForLoadState("networkidle");
    await pages.alice.getByPlaceholder("Anniversaire du serveur…").fill("Date Alice");
    const captured = pages.alice.waitForRequest(request => request.method() === "POST" && Boolean(request.headers()["next-action"]));
    await pages.alice.getByRole("button", { name: "Ajouter", exact: true }).click();
    createRequest = await captured;
    await waitFor(async () => (await dates("Date Alice")).length === 1, "date Alice absente");
    assert.ok(createRequest.postDataBuffer(), "corps de la requête absent");
  });
  await step("POST forgé : Bob (MEMBER) rejoue la requête de création d'Alice -> aucune date créée", async () => {
    const headers = { "next-action": createRequest.headers()["next-action"], "content-type": createRequest.headers()["content-type"], accept: createRequest.headers().accept ?? "text/x-component" };
    const body = createRequest.postDataBuffer();
    const forged = Buffer.from(body.toString("latin1").replace("Date Alice", "Date Bob!"), "latin1");
    const response = await contexts.bob.request.post(calendar, { headers, data: forged, maxRedirects: 0 });
    await sleep(1500);
    assert.equal((await dates("Date Bob!")).length, 0, "un MEMBER a créé une date serveur");
    // Témoin positif : le même rejeu avec la session d'Alice (OWNER) fonctionne, donc le rejeu est valide.
    const control = await contexts.alice.request.post(calendar, { headers, data: Buffer.from(body.toString("latin1").replace("Date Alice", "Date Rejeu"), "latin1"), maxRedirects: 0 });
    await waitFor(async () => (await dates("Date Rejeu")).length === 1, `témoin positif absent (HTTP ${control.status()})`);
    return `Bob HTTP ${response.status()}, témoin OWNER HTTP ${control.status()}`;
  });
  await step("MEMBER : Bob ne voit pas « Retirer du calendrier » sur la date d'un autre ; ADMIN le voit", async () => {
    await pages.bob.goto(calendar);
    await pages.bob.getByRole("heading", { name: "Date Alice" }).waitFor();
    assert.equal(await pages.bob.getByRole("button", { name: "Retirer du calendrier" }).count(), 0);
    await pages.casey.goto(calendar);
    await pages.casey.getByRole("heading", { name: "Date Alice" }).waitFor();
    assert.ok(await pages.casey.getByRole("button", { name: "Retirer du calendrier" }).count() >= 1);
  });
  await step("POST forgé : Bob rejoue la suppression -> la date d'Alice reste ; ADMIN supprime la date d'Alice", async () => {
    // Capture de la requête de suppression réelle (Casey retire « Date Rejeu », autre date de test).
    const captured = pages.casey.waitForRequest(request => request.method() === "POST" && Boolean(request.headers()["next-action"]));
    await pages.casey.locator(".gn-agenda-event").filter({ hasText: "Date Rejeu" }).getByRole("button", { name: "Retirer du calendrier" }).click();
    deleteRequest = await captured;
    await waitFor(async () => (await dates("Date Rejeu")).length === 0, "ADMIN n'a pas pu retirer une date d'un autre");
    const [target] = await dates("Date Alice");
    const original = (await dates("Date Casey"))[0];
    const body = deleteRequest.postDataBuffer().toString("latin1");
    assert.ok(body.includes("Date Rejeu") === false);
    const idPattern = /(?<=name="_1_id"\r\n\r\n)[^\r]+/;
    assert.match(body, idPattern, "identifiant de date absent du corps capturé");
    const forged = Buffer.from(body.replace(idPattern, target.id), "latin1");
    const headers = { "next-action": deleteRequest.headers()["next-action"], "content-type": deleteRequest.headers()["content-type"], accept: deleteRequest.headers().accept ?? "text/x-component" };
    await contexts.bob.request.post(calendar, { headers, data: forged, maxRedirects: 0 });
    await sleep(1500);
    assert.equal((await dates("Date Alice")).length, 1, "un MEMBER a supprimé une date serveur");
    // Témoin positif : l'ADMIN rejoue la même suppression forgée sur la date d'Alice -> supprimée (droit de gestion).
    const adminReplay = await contexts.casey.request.post(calendar, { headers, data: forged, maxRedirects: 0 });
    await waitFor(async () => (await dates("Date Alice")).length === 0, "ADMIN n'a pas pu supprimer la date d'Alice");
    assert.equal((await dates("Date Casey")).length, 1, `date de Casey préservée (${original.id})`);
  });
  await step("MEMBER : Bob peut toujours retirer son propre anniversaire, pas celui d'un autre", async () => {
    await db.communityDate.createMany({ data: [
      { communityId: community.id, createdById: bob.id, memberId: bob.id, kind: "BIRTHDAY", date: new Date(Date.UTC(2000, new Date(voteDate).getUTCMonth(), voteDate.getUTCDate())), repeatsAnnually: true },
      { communityId: community.id, createdById: carol.id, memberId: carol.id, kind: "BIRTHDAY", date: new Date(Date.UTC(2000, new Date(voteDate).getUTCMonth(), voteDate.getUTCDate())), repeatsAnnually: true },
    ] });
    await pages.bob.goto(calendar);
    await pages.bob.waitForLoadState("networkidle");
    assert.equal(await pages.bob.getByRole("button", { name: "Retirer du calendrier" }).count(), 1);
    const own = pages.bob.locator(".gn-agenda-event").filter({ hasText: "Anniversaire" }).getByRole("button", { name: "Retirer du calendrier" });
    assert.equal(await own.count(), 1);
    await own.click();
    await waitFor(async () => (await db.communityDate.count({ where: { communityId: community.id, memberId: bob.id } })) === 0, "anniversaire de Bob non retiré");
    assert.equal(await db.communityDate.count({ where: { communityId: community.id, memberId: carol.id } }), 1);
  });

  // ================= PHASE B : flags éteints =================
  await browser.close();
  await stopServer();
  await startServer({}, "b");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  await openPages();
  const anonymousOff = await contextFor(null);
  await step("flag OFF veto de soirée : pas de bouton veto, jeux toujours JOUABLES, aucun veto en base", async () => {
    await pages.bob.goto(`${origin}/sessions/${vote.id}`);
    await pages.bob.getByText(games.G1.name).first().waitFor();
    await pages.bob.waitForLoadState("networkidle");
    assert.ok(await pages.bob.getByText("JOUABLE", { exact: true }).count() >= 1);
    assert.equal(await pages.bob.getByRole("button", { name: /veto/i }).count(), 0);
    assert.equal(await db.sessionVeto.count({ where: { sessionId: vote.id } }), 0);
  });
  await step("flag OFF veto de roulette : pas de bouton sur une roulette tirée, résultat inchangé", async () => {
    await pages.carol.goto(rouletteUrl(r2.roulette.id));
    await pages.carol.getByText(games.G1.name).first().waitFor();
    await pages.carol.waitForLoadState("networkidle");
    assert.equal(await vetoButton(pages.carol).count(), 0);
    assert.equal((await db.roulette.findUniqueOrThrow({ where: { id: r2.roulette.id } })).resultGameId, games.G1.id);
    assert.equal((await vetoes(r2.roulette.id)).length, 0);
  });
  await step("flag OFF abonnement : section absente et ancien flux = 404", async () => {
    await pages.bob.goto(`${origin}/calendrier?date=${calDate}`);
    await pages.bob.getByRole("heading", { name: "Le calendrier" }).waitFor();
    assert.equal(await pages.bob.getByRole("heading", { name: "S’abonner aux soirées" }).count(), 0);
    assert.equal((await anonymousOff.request.get(activeFeed)).status(), 404);
    assert.equal(await db.calendarFeedToken.count({ where: { userId: bob.id, revokedAt: null } }), 1);
  });

  // ---------- MOBILE ----------
  for (const [name, user, path] of [["roulette tirée", "carol", `/roulette/${r2.roulette.id}`], ["calendrier (ADMIN)", "casey", `/calendrier?date=${calDate}`]]) {
    await step(`mobile 390x844 sans débordement : ${name}`, async () => {
      const page = pages[user];
      await page.setViewportSize({ width: 390, height: 844 });
      const measure = () => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
      const isRoulette = path.startsWith("/roulette/");
      const measurements = [];
      if (isRoulette) {
        await page.addInitScript(() => {
          const target = window;
          target.__radarScrollMeasurements = null;
          const onAnimationStart = event => {
            if (event.animationName !== "radar-ping" || target.__radarScrollSampling) return;
            target.__radarScrollSampling = true;
            document.removeEventListener("animationstart", onAnimationStart, true);
            const startedAt = performance.now();
            const samples = [];
            const sample = () => {
              samples.push({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth });
              if (performance.now() - startedAt >= 2_200) {
                target.__radarScrollMeasurements = samples;
              } else {
                setTimeout(sample, 100);
              }
            };
            sample();
          };
          document.addEventListener("animationstart", onAnimationStart, true);
        });
        await page.goto(`${origin}${path}`);
        await page.waitForLoadState("networkidle");
        await page.waitForFunction(() => Array.isArray(window.__radarScrollMeasurements));
        measurements.push(...await page.evaluate(() => window.__radarScrollMeasurements));
      } else {
        await page.goto(`${origin}${path}`);
        await page.waitForLoadState("networkidle");
      }
      measurements.push(await measure());
      const innerWidth = measurements[0].innerWidth;
      const scrollWidth = Math.max(...measurements.map(value => value.scrollWidth));
      await page.screenshot({ path: resolve(output, `mobile-${name.replace(/[^a-z]/gi, "-")}.png`), fullPage: true });
      if (scrollWidth > innerWidth) {
        const culprits = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(element => !element.closest("svg") && !element.className?.toString().includes("gn-aurora") && element.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map(element => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)} right=${Math.round(element.getBoundingClientRect().right)}`));
        console.error("  éléments qui débordent :", culprits.join(" | "));
      }
      assert.ok(scrollWidth <= innerWidth, `débordement ${scrollWidth} > ${innerWidth}`);
      return `${scrollWidth}<=${innerWidth}${isRoulette ? ` (${measurements.length - 1} mesures sur 2,2 s depuis le début de radar-ping)` : ""}`;
    });
  }
  await step("aucune notification Discord envoyée ni erreur de page", async () => {
    assert.equal(await db.notificationDelivery.count({ where: { ...notificationScope, status: "SENT" } }), 0);
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
  await browser?.close();
  await stopServer().catch(error => console.error(error.message));
  await db.$disconnect();
}
