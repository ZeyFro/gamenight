// Recette authentifiée sur PostgreSQL local; jamais de compte ou service distant.
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
const origin = "http://127.0.0.1:3103", secret = randomUUID(), run = `boutique-${randomUUID()}`;
let browser, server;
const errors = [];
try {
  assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name, "gamenight_test");
  await assert.rejects(fetch(origin), "Le port 3103 doit être libre");
  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE" } });
  const user = await db.user.create({ data: { discordId: run, discordName: "Recette boutique", onboardingCompleted: true, activeCommunityId: community.id } });
  await db.membership.create({ data: { userId: user.id, communityId: community.id } });
  const where = { communityId_userId: { communityId: community.id, userId: user.id } };
  await db.communityMemberStats.create({ data: { communityId: community.id, userId: user.id, xpTotal: 2_000, xpBalance: 1_000 } });
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD/.test(key)) delete childEnv[key];
  Object.assign(childEnv, { NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href, AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin, COMMUNITY_ISOLATION_ENABLED: "true", COMMUNITY_PICKER_ENABLED: "true" });
  mkdirSync("logs", { recursive: true });
  const log = openSync("logs/recette-boutique-next.log", "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3103"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const readyUntil = Date.now() + 120_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* Serveur en démarrage. */ }
    assert.ok(Date.now() < readyUntil && server.exitCode === null, "Next local indisponible; voir logs/recette-boutique-next.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const name = "authjs.session-token";
  const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/profil/boutique`);
  await page.getByText("Solde dépensable de cette communauté : 1000 XP", { exact: true }).waitFor();
  const rank = await page.locator(".rank-badge-shimmer").innerText();
  for (const [item, cost, balance] of [["Stratège", 250, 750], ["Nébuleuse", 300, 450]]) {
    await page.getByRole("button", { name: `Acheter ${item} pour ${cost} XP`, exact: true }).click();
    await page.getByText(`Solde dépensable de cette communauté : ${balance} XP`, { exact: true }).waitFor();
    assert.equal((await db.communityMemberStats.findUniqueOrThrow({ where })).xpTotal, 2_000);
    assert.equal(await page.locator(".rank-badge-shimmer").innerText(), rank);
    await page.getByRole("button", { name: `Équiper ${item}`, exact: true }).click();
    await page.getByRole("button", { name: `Équiper ${item}`, exact: true, disabled: true }).waitFor();
  }
  let stats = await db.communityMemberStats.findUniqueOrThrow({ where });
  assert.equal(stats.xpBalance, 450);
  assert.equal(stats.equippedTitleId, "title-strategist");
  assert.equal(stats.equippedFrameId, "frame-nebula");
  await page.getByRole("button", { name: "Retirer l’équipement", exact: true }).first().click();
  await page.getByRole("button", { name: "Équiper Stratège", exact: true, disabled: false }).waitFor();
  stats = await db.communityMemberStats.findUniqueOrThrow({ where });
  assert.equal(stats.xpTotal, 2_000); assert.equal(stats.xpBalance, 450); assert.equal(stats.equippedTitleId, null);
  await db.communityMemberStats.update({ where, data: { xpBalance: 100 } });
  await page.reload();
  await page.getByRole("button", { name: "Acheter Noctambule pour 350 XP", exact: true }).click();
  await page.getByText("Ton solde XP est insuffisant.", { exact: true }).waitFor();
  stats = await db.communityMemberStats.findUniqueOrThrow({ where });
  assert.equal(stats.xpTotal, 2_000); assert.equal(stats.xpBalance, 100);
  assert.equal(await db.communityMemberCosmetic.count({ where: { userId: user.id, communityId: community.id } }), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Débordement mobile boutique");
  assert.deepEqual(errors, []);
  console.log(`OK navigateur local : achats 250+300, grade/progression2000 conservés; équipement/retrait sans débit; insuffisance malgré progression; mobile390x844. Fixtures conservées : ${run}`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  await browser?.close(); server?.kill(); await db.$disconnect();
}
