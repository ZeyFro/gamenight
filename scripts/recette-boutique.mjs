// Recette navigateur de la boutique XP sur PostgreSQL local jetable; jamais de compte ou service distant.
// Variables : TEST_DATABASE_URL (127.0.0.1, base gamenight_test), PLAYWRIGHT_MODULE_PATH (playwright-core hors dépôt),
// RECETTE_PG_PORT (défaut 55439), RECETTE_APP_PORT (défaut 3103), RECETTE_CHROME (exécutable Chrome/Edge, défaut : canal msedge).
// Chaque scénario utilise son propre utilisateur et son propre profil navigateur temporaire (supprimé à la fin).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
const pgPort = process.env.RECETTE_PG_PORT ?? "55439", appPort = process.env.RECETTE_APP_PORT ?? "3103";
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, pgPort);
assert.equal(database.pathname, "/gamenight_test");
assert.match(appPort, /^[1-9]\d{3,4}$/);
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core existant hors dépôt requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = `http://127.0.0.1:${appPort}`, secret = randomUUID(), run = `boutique-${randomUUID()}`;
const profiles = [], errors = [], results = [], contexts = [];
let server;

async function actor(label, { xpTotal = 2_000, xpBalance = 1_000 } = {}) {
  const community = await db.community.create({ data: { slug: `${run}-${label}`, name: `${run}-${label}`, status: "ACTIVE" } });
  const user = await db.user.create({ data: { discordId: `${run}-${label}`, discordName: `Recette ${label}`, onboardingCompleted: true, activeCommunityId: community.id } });
  await db.membership.create({ data: { userId: user.id, communityId: community.id } });
  const where = { communityId_userId: { communityId: community.id, userId: user.id } };
  await db.communityMemberStats.create({ data: { communityId: community.id, userId: user.id, xpTotal, xpBalance } });
  const profile = mkdtempSync(join(tmpdir(), "gn-a4-chrome-"));
  profiles.push(profile);
  const launch = { headless: true, viewport: { width: 1000, height: 900 }, ...(process.env.RECETTE_CHROME ? { executablePath: process.env.RECETTE_CHROME } : { channel: "msedge" }) };
  const context = await chromium.launchPersistentContext(profile, launch);
  contexts.push(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const name = "authjs.session-token";
  const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
  await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
  const open = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/profil/boutique`);
    return page;
  };
  const stats = () => db.communityMemberStats.findUniqueOrThrow({ where });
  const owned = () => db.communityMemberCosmetic.findMany({ where: { userId: user.id, communityId: community.id }, select: { itemId: true } }).then(rows => rows.map(r => r.itemId).sort());
  const events = reason => db.xpEvent.findMany({ where: { userId: user.id, communityId: community.id, reason }, select: { amount: true, sourceId: true } });
  return { community, user, where, context, open, stats, owned, events };
}
const balanceText = n => `Solde dépensable de cette communauté : ${n} XP`;
const buy = (page, item, cost) => page.getByRole("button", { name: `Acheter ${item} pour ${cost} XP`, exact: true });
async function scenario(name, body) {
  if (process.env.RECETTE_ONLY && !name.includes(process.env.RECETTE_ONLY)) return;
  try { const detail = await body(); results.push({ name, ok: true }); console.log(`OK    ${name} : ${detail}`); }
  catch (error) { results.push({ name, ok: false }); process.exitCode = 1; console.error(`ECHEC ${name} : ${error.message.split("\n").slice(0, 3).join(" | ")}`); }
}

try {
  assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name, "gamenight_test");
  await assert.rejects(fetch(origin), `Le port ${appPort} doit être libre`);
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD/.test(key)) delete childEnv[key];
  Object.assign(childEnv, { NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href, AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin, COMMUNITY_ISOLATION_ENABLED: "true", COMMUNITY_PICKER_ENABLED: "true" });
  mkdirSync("logs", { recursive: true });
  const log = openSync("logs/recette-boutique-next.log", "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...(process.env.RECETTE_BUNDLER === "turbopack" ? [] : ["--webpack"]), "--hostname", "127.0.0.1", "--port", appPort], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const readyUntil = Date.now() + 120_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* Serveur en démarrage. */ }
    assert.ok(Date.now() < readyUntil && server.exitCode === null, "Next local indisponible; voir logs/recette-boutique-next.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await scenario("achat, équipement, retrait, insuffisance, objet possédé, mobile", async () => {
    const a = await actor("achat");
    const page = await a.open();
    await page.getByText(balanceText(1_000), { exact: true }).waitFor();
    const rank = await page.locator(".rank-badge-shimmer").innerText();
    for (const [item, cost, balance] of [["Stratège", 250, 750], ["Nébuleuse", 300, 450]]) {
      await buy(page, item, cost).click();
      await page.getByText(balanceText(balance), { exact: true }).waitFor();
      assert.equal((await a.stats()).xpTotal, 2_000);
      assert.equal(await page.locator(".rank-badge-shimmer").innerText(), rank);
      assert.equal(await buy(page, item, cost).count(), 0, "objet possédé encore achetable");
      await page.getByRole("button", { name: `Équiper ${item}`, exact: true }).click();
      await page.getByRole("button", { name: `Équiper ${item}`, exact: true, disabled: true }).waitFor();
    }
    let stats = await a.stats();
    assert.equal(stats.xpBalance, 450); assert.equal(stats.equippedTitleId, "title-strategist"); assert.equal(stats.equippedFrameId, "frame-nebula");
    assert.equal((await a.events("SHOP_BALANCE_PURCHASE")).length, 2);
    await page.getByRole("button", { name: "Retirer l’équipement", exact: true }).first().click();
    await page.getByRole("button", { name: "Équiper Stratège", exact: true, disabled: false }).waitFor();
    stats = await a.stats();
    assert.equal(stats.xpTotal, 2_000); assert.equal(stats.xpBalance, 450); assert.equal(stats.equippedTitleId, null);
    await db.communityMemberStats.update({ where: a.where, data: { xpBalance: 100 } });
    await page.reload();
    await buy(page, "Noctambule", 350).click();
    await page.getByText("Ton solde XP est insuffisant.", { exact: true }).waitFor();
    stats = await a.stats();
    assert.equal(stats.xpTotal, 2_000); assert.equal(stats.xpBalance, 100);
    assert.deepEqual(await a.owned(), ["frame-nebula", "title-strategist"]);
    assert.equal((await a.events("SHOP_BALANCE_PURCHASE")).length, 2, "refus insuffisant : aucun événement");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Débordement mobile boutique");
    return "xpTotal 2000 et grade conservés, solde 1000->450, équipement/retrait sans débit, insuffisance refusée sans événement, aucun bouton Acheter sur objet possédé, mobile 390x844 sans débordement";
  });

  await scenario("double clic et 3 onglets concurrents sur le même article", async () => {
    const a = await actor("concurrent-meme");
    const pages = await Promise.all([a.open(), a.open(), a.open()]);
    await Promise.all(pages.map(page => buy(page, "Solaire", 300).waitFor()));
    await Promise.all([buy(pages[0], "Solaire", 300).dblclick(), buy(pages[1], "Solaire", 300).click(), buy(pages[2], "Solaire", 300).click()]);
    await pages[0].getByText(balanceText(700), { exact: true }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const stats = await a.stats();
    assert.equal(stats.xpBalance, 700, "débit unique attendu");
    assert.equal(stats.xpTotal, 2_000);
    assert.deepEqual(await a.owned(), ["frame-solar"]);
    assert.deepEqual(await a.events("SHOP_BALANCE_PURCHASE"), [{ amount: -300, sourceId: "frame-solar" }]);
    const messages = await Promise.all(pages.map(page => page.getByRole("status").innerText()));
    return `1 achat, solde 700, 1 événement -300; messages par onglet : ${messages.join(" / ")}`;
  });

  await scenario("achats concurrents d'articles différents, solde pour un seul", async () => {
    const a = await actor("concurrent-diff", { xpTotal: 2_000, xpBalance: 300 });
    const pages = await Promise.all([a.open(), a.open()]);
    await Promise.all([buy(pages[0], "Menthe", 200).click(), buy(pages[1], "Glace", 250).click()]);
    await Promise.all(pages.map(page => page.getByRole("status").waitFor()));
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const stats = await a.stats(), owned = await a.owned();
    assert.equal(owned.length, 1, `un seul achat attendu : ${owned}`);
    assert.equal(stats.xpBalance, owned[0] === "color-mint" ? 100 : 50);
    assert.equal(stats.xpTotal, 2_000);
    assert.equal((await a.events("SHOP_BALANCE_PURCHASE")).length, 1);
    return `acheté : ${owned[0]}, solde ${stats.xpBalance} (jamais négatif)`;
  });

  await scenario("achats historiques (SHOP_PURCHASE) conservés dans la progression", async () => {
    const a = await actor("historique", { xpTotal: 400, xpBalance: 400 });
    await db.xpEvent.createMany({ data: [
      { communityId: a.community.id, userId: a.user.id, reason: "PARTICIPATE", amount: 500, sourceId: "recette-historique" },
      { communityId: a.community.id, userId: a.user.id, reason: "SHOP_PURCHASE", amount: -100, sourceId: "title-strategist" },
    ] });
    const weekXp = async () => {
      const page = await a.context.newPage();
      await page.goto(`${origin}/classement?periode=week`);
      await page.getByText(/^\d+ XP$/).first().waitFor();
      const text = await page.getByText(/^\d+ XP$/).first().innerText();
      await page.close();
      return text;
    };
    assert.equal(await weekXp(), "400 XP", "ancien achat (-100) compté dans la progression : 500-100");
    const page = await a.open();
    await buy(page, "Menthe", 200).click();
    await page.getByText(balanceText(200), { exact: true }).waitFor();
    assert.equal(await weekXp(), "400 XP", "achat récent exclu de la progression");
    assert.equal((await a.stats()).xpTotal, 400);
    assert.equal(await db.xpEvent.count({ where: { userId: a.user.id, reason: "SHOP_PURCHASE" } }), 1, "ancien événement intact");
    return "classement semaine 400 XP avant/après achat (ancien -100 compté, nouveau exclu), xpTotal 400, solde 400->200";
  });

  assert.deepEqual(errors, []);
  console.log(`Fin : ${results.filter(r => r.ok).length}/${results.length} scénarios OK. Fixtures conservées : ${run}`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  server?.kill(); await db.$disconnect();
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
}
