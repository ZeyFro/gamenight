// Recette navigateur : Next dev déjà lancé sur 127.0.0.1:3101, même secret local.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.equal(process.env.NODE_ENV === "production", false, "Recette interdite en production");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55440");
assert.equal(url.pathname, "/gamenight_portable1_test");
assert.equal(url.protocol, "postgresql:");
assert.ok(process.env.AUTH_SECRET, "Secret éphémère du serveur local requis");
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "Chemin vers playwright-core hors dépôt requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const origin = "http://127.0.0.1:3101";
const db = new PrismaClient({ datasourceUrl: url.href });
let browser;
const run = `recette-${randomUUID()}`;
const errors = [];

try {
  const [destination] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(destination.name, "gamenight_portable1_test");
  const community = await db.community.upsert({ where: { slug: "default" }, update: {}, create: { slug: "default", name: "Recette locale", status: "ACTIVE" } });
  assert.equal(community.status, "ACTIVE");
  const users = [];
  for (const name of ["Hôte", "Invité", "Tiers"]) {
    const user = await db.user.create({ data: { discordId: `${run}-${users.length}`, discordName: `${name} ${run}`, onboardingCompleted: true } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id, status: "ACTIVE" } });
    users.push(user);
  }
  const [host, guest, outsider] = users;
  const games = [];
  for (const label of ["Commun", "Refus explicite", "Horreur", "Hôte seul"]) {
    const game = await db.game.create({ data: { name: `${label} ${run}`, source: "MANUAL", addedById: host.id, minPlayers: 1, maxPlayers: 4,
      igdbDetails: { genres: ["Puzzle"], themes: label === "Horreur" ? ["Horror"] : [] } } });
    await db.userGame.createMany({ data: (label === "Hôte seul" ? [host] : [host, guest]).map(user => ({ userId: user.id, gameId: game.id, owned: true })) });
    games.push(game);
  }
  await db.userGameRefusal.create({ data: { userId: guest.id, gameId: games[1].id } });
  await db.user.update({ where: { id: guest.id }, data: { refusedGameCategories: ["HORROR"] } });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function pageFor(user) {
    const context = await browser.newContext();
    await context.route("**/*", route => {
      const requestUrl = new URL(route.request().url());
      return requestUrl.origin === origin ? route.continue() : route.abort();
    });
    if (user) {
      const name = "authjs.session-token";
      const value = await encode({ secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
      await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
      await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
    }
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(120_000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.text().includes("Encountered two children with the same key")) errors.push("Clés React dupliquées");
    });
    return page;
  }
  const page = await pageFor(host), guestPage = await pageFor(guest), outsiderPage = await pageFor(outsider);
  await page.goto(`${origin}/sessions/sondages/nouveau`);
  await page.getByLabel("Nom de la préparation").fill(run);
  for (const input of await page.locator('input[name="participantId"]').all()) await input.uncheck();
  await page.locator(`input[name="participantId"][value="${guest.id}"]`).check();
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Date option 1", { exact: true }).fill(day);
  await page.getByLabel("Date option 2", { exact: true }).fill(day);
  await page.getByLabel("Heure option 2", { exact: true }).fill("22:00");
  await page.getByRole("button", { name: "Créer le sondage privé", exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith("/sessions/sondages/") && url.pathname !== "/sessions/sondages/nouveau");
  const pollUrl = page.url(), pollId = new URL(pollUrl).pathname.split("/").at(-1);
  const poll = await db.sessionAvailabilityPoll.findUniqueOrThrow({ where: { id: pollId }, include: { participants: true } });
  assert.deepEqual(poll.participants.map(row => row.userId).sort(), [host.id, guest.id].sort());
  await guestPage.goto(pollUrl);
  await guestPage.getByRole("button", { name: "Oui", exact: true }).first().click();
  await guestPage.getByRole("button", { name: "Oui", exact: true }).first().and(guestPage.locator('[aria-pressed="true"]')).waitFor();
  assert.equal(await db.sessionAvailabilityPollResponse.count({ where: { pollId, userId: guest.id, answer: "AVAILABLE" } }), 1);
  await outsiderPage.goto(pollUrl);
  await outsiderPage.getByRole("heading", { name: /^404/ }).waitFor();
  assert.equal(await outsiderPage.getByRole("heading", { name: run, exact: true }).count(), 0);
  await page.reload();
  await page.getByRole("button", { name: "Choisir et créer la soirée", exact: true }).first().click();
  await page.waitForURL(/\/sessions\/[^/?]+$/);
  const converted = await db.sessionAvailabilityPoll.findUniqueOrThrow({ where: { id: pollId } });
  assert.ok(converted.sessionId);
  assert.equal(new URL(page.url()).pathname, `/sessions/${converted.sessionId}`);
  assert.equal(await db.session.count({ where: { id: converted.sessionId } }), 1);
  await outsiderPage.goto(page.url());
  await outsiderPage.getByRole("heading", { name: /^404/ }).waitFor();
  console.log("OK sondage → réponse invitée → soirée; tiers refusé (page introuvable)");

  await page.goto(`${origin}/bibliotheque/groupe`);
  for (const input of await page.locator('input[name="participants"]').all()) await input.uncheck();
  for (const user of [host, guest]) await page.locator(`input[name="participants"][value="${user.id}"]`).check();
  await page.getByRole("button", { name: "Afficher les jeux communs", exact: true }).click();
  await page.waitForURL(url => url.searchParams.getAll("participants").length === 2);
  for (const game of games.slice(0, 3)) await page.getByText(game.name, { exact: true }).first().waitFor();
  assert.equal(await page.getByText(games[3].name, { exact: true }).count(), 0);
  console.log("OK intersection des deux bibliothèques choisies");

  await page.goto(`${origin}/bibliotheque/suggestions?selection=1&participants=${host.id}&participants=${guest.id}`);
  await page.getByRole("link", { name: games[0].name, exact: true }).waitFor();
  for (const game of games.slice(1)) assert.equal(await page.getByRole("link", { name: game.name, exact: true }).count(), 0);
  console.log("OK suggestions : refus explicite et catégorie exclus sans assouplissement");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Débordement horizontal mobile des suggestions");
  for (const path of ["/calendrier", "/guide", "/profil/parametres"]) {
    assert.equal((await page.goto(`${origin}${path}`)).status(), 200);
    await page.locator("h1").first().waitFor();
    assert.equal(new URL(page.url()).pathname, path);
  }
  const authSession = await page.request.get(`${origin}/api/auth/session`);
  assert.equal(authSession.status(), 200);
  assert.equal((await authSession.json()).user.discordId, host.discordId);
  assert.equal((await page.request.get(`${origin}/api/calendrier/feed/${"a".repeat(43)}`)).status(), 404);
  console.log("OK suggestions mobiles; calendrier/guide/paramètres authentifiés; feed désactivé");
  const anonymous = await pageFor(null);
  await anonymous.goto(pollUrl);
  await anonymous.waitForURL(`${origin}/`);
  assert.equal(new URL(anonymous.url()).pathname, "/");
  assert.deepEqual(errors, []);
  assert.equal(await db.notificationDelivery.count({ where: { event: { sourceId: converted.sessionId } } }), 0);
  console.log(`OK visite anonyme refusée; aucune erreur navigateur. Fixtures conservées : ${run}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await db.$disconnect();
}
