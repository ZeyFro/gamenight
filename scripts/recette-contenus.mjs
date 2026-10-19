// Recette isolée des permissions galerie/Lore; aucun service externe n'est appelé.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, openSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "55439");
assert.equal(database.pathname, "/gamenight_test");
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core existant hors dépôt requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = "http://127.0.0.1:3102";
const secret = randomUUID();
const run = `contenus-${randomUUID()}`;
let browser, server;
const errors = [];

try {
  const [destination] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(destination.name, "gamenight_test");
  // Un serveur préexistant n'est ni utilisé ni arrêté par cette recette.
  await assert.rejects(fetch(origin), "Le port 3102 doit être libre");
  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE", sessionGalleryEnabled: true } });
  const users = [];
  for (const [label, role] of [["Créateur", "MEMBER"], ["Admin invité", "ADMIN"], ["Invité", "MEMBER"], ["Admin tiers", "OWNER"], ["Admin global invité", "MEMBER"]]) {
    const user = await db.user.create({ data: { discordId: `${run}-${users.length}`, discordName: label, onboardingCompleted: true, activeCommunityId: community.id, role: label === "Admin global invité" ? "ADMIN" : "USER" } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id, role } });
    users.push(user);
  }
  const [creator, admin, guest, , globalAdmin] = users;
  const session = await db.session.create({ data: { communityId: community.id, createdById: creator.id, status: "DONE", date: new Date(), superlativeVotingClosed: true } });
  await db.sessionInvite.createMany({ data: [admin, guest, globalAdmin].map(user => ({ sessionId: session.id, userId: user.id, invitedById: creator.id })) });
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD/.test(key)) delete childEnv[key];
  }
  Object.assign(childEnv, {
    NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href,
    AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin,
    COMMUNITY_ISOLATION_ENABLED: "true", COMMUNITY_PICKER_ENABLED: "true",
    COMMUNITY_HIGHLIGHTS_ENABLED: "true", SESSION_CHRONICLES_ENABLED: "true",
    // Valeur locale inopérante : l'envoi Blob n'est jamais soumis.
    SESSION_MEDIA_BLOB_TOKEN: "local-recipe-no-upload",
  });
  mkdirSync("logs", { recursive: true });
  const log = openSync("logs/recette-contenus-next.log", "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3102"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const readyUntil = Date.now() + 120_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* Serveur en démarrage. */ }
    assert.ok(Date.now() < readyUntil && server.exitCode === null, "Next local indisponible; voir logs/recette-contenus-next.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function pageFor(user) {
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const name = "authjs.session-token";
    const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(120_000);
    page.on("pageerror", error => errors.push(error.message));
    return page;
  }
  const pages = [];
  for (const user of users) pages.push(await pageFor(user));
  for (const [index, page] of pages.entries()) {
    await page.goto(`${origin}/sessions/${session.id}`);
    if (index === 3) {
      await page.getByRole("heading", { name: /^404/ }).waitFor();
      assert.equal(await page.getByText("Galerie de la soirée", { exact: false }).count(), 0);
      continue;
    }
    await page.getByRole("heading", { name: "📸 Galerie de la soirée" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Partager dans la galerie" }).count(), index < 2 ? 1 : 0);
    assert.equal(await page.getByRole("button", { name: "Enregistrer la chronique" }).count(), index < 2 ? 1 : 0);
  }
  const adminPage = pages[1];
  await adminPage.locator('textarea[name="chronicle"]').fill(`Souvenir modéré ${run}`);
  await adminPage.getByRole("button", { name: "Enregistrer la chronique" }).click();
  await adminPage.getByText("Chronique enregistrée.", { exact: true }).waitFor();
  assert.equal((await db.session.findUniqueOrThrow({ where: { id: session.id } })).chronicle, `Souvenir modéré ${run}`);
  console.log("OK galerie/chronique : créateur + admin invité admis; membre/admin global invité sans gestion; admin tiers 404; édition admin persistée");
  for (const [index, page] of pages.entries()) {
    await page.goto(`${origin}/profil/lore/musee`);
    await page.getByRole("heading", { name: `Exploits et fails · ${run}` }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Publier", exact: true }).count(), [1, 3].includes(index) ? 1 : 0);
  }
  await adminPage.getByLabel("Titre", { exact: true }).fill(`Exploit ${run}`);
  await adminPage.getByLabel("Le souvenir", { exact: true }).fill("Souvenir local de recette, sans média distant.");
  await adminPage.getByRole("button", { name: "Publier", exact: true }).click();
  await adminPage.getByText("Souvenir enregistré.", { exact: true }).waitFor();
  assert.equal(await db.communityHighlight.count({ where: { communityId: community.id } }), 1);
  const guestPage = pages[2];
  await guestPage.reload();
  await guestPage.getByRole("heading", { name: `🏆 Exploit ${run}` }).waitFor();
  assert.equal(await guestPage.getByText("Modifier ou supprimer", { exact: true }).count(), 0);
  await guestPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Débordement mobile musée");
  await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: session.id, userId: admin.id } }, data: { status: "REVOKED" } });
  await adminPage.goto(`${origin}/sessions/${session.id}`);
  await adminPage.getByRole("heading", { name: /^404/ }).waitFor();
  assert.equal(await db.notificationDelivery.count({ where: { event: { sourceId: session.id } } }), 0);
  assert.deepEqual(errors, []);
  console.log(`OK musée : publication admin, lecture membre mobile; révocation admin effective; aucune notification. Fixtures conservées : ${run}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
  await db.$disconnect();
}
