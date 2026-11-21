// Parcours scripté du nouveau joueur (bureau ou mobile) : chaque étape = un vrai clic Playwright, une capture, l'URL et les actions visibles.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import sharp from "sharp";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const viewportName = process.argv[2] ?? "bureau";
const viewport = viewportName === "mobile" ? { width: 375, height: 812 } : { width: 1280, height: 800 };
const flow = process.argv[3] ?? "A";
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const user = await db.user.findUniqueOrThrow({ where: { discordId: "p-nouveau" } });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const dir = "docs/preuves/parcours"; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport, locale: "fr-FR", timezoneId: "Europe/Paris" });
await context.route("**/*", route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
await context.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 7200, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage(); page.setDefaultTimeout(8000);
const steps = []; let clicks = 0;
async function snap(label, action) {
  const before = page.url();
  if (action) { try { await action(); clicks++; } catch (error) { steps.push({ n: steps.length + 1, label, ok: false, error: String(error.message).split("\n")[0].slice(0, 160), clicks, url: page.url() }); return false; } }
  await page.waitForLoadState("load").catch(() => {}); await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent?.trim() ?? "", dialog: Boolean(document.querySelector("[role=dialog],dialog[open]")),
    actions: [...document.querySelectorAll("main a, main button, [role=dialog] a, [role=dialog] button")].filter(e => e.getBoundingClientRect().width > 0).map(e => (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean).slice(0, 14),
    text: document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 1500) }));
  const file = `${dir}/${flow}-${viewportName}-${String(steps.length + 1).padStart(2, "0")}.png`;
  const png = await page.screenshot({ fullPage: false });
  writeFileSync(file, await sharp(png).png({ palette: true, colours: 64, compressionLevel: 9, effort: 8 }).toBuffer());
  steps.push({ n: steps.length + 1, label, ok: true, clicks, url: new URL(page.url()).pathname, changedPage: before !== page.url(), file, ...info });
  return true;
}
const click = (role, name) => () => page.getByRole(role, { name }).first().click();
if (flow === "A") { // arrivée → première partie : onboarding, puis « Rejoindre une soirée »
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée après connexion : l'invite d'accueil s'affiche");
  await snap("Plus tard — garder mes étapes", click("button", /Plus tard/));
  await snap("Rejoindre une soirée", click("link", /Rejoindre une soirée/));
} else if (flow === "A2") { // … jusqu'au bout : rejoindre la première soirée ouverte
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée");
  await snap("Plus tard", click("button", /Plus tard/));
  await snap("Rejoindre une soirée", click("link", /Rejoindre une soirée/));
  await snap("Rejoindre (première soirée)", click("button", /^Rejoindre$/));
} else if (flow === "B") { // Qui joue ce soir ?
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée");
  await snap("Plus tard", click("button", /Plus tard/));
  await snap("Trouver des joueurs", click("link", /Trouver des joueurs/));
  await snap("Voir les annonces GameNight", click("link", /Voir les annonces/));
  await snap("Qui joue ce soir ?", click("link", /Qui joue ce soir/));
  await snap("Choisir un jeu", () => page.locator("main select[name=gameId]").first().selectOption({ index: 1 }));
  await snap("Envoyer ma disponibilité", () => page.locator("main button[type=submit], main form button").first().click());
} else if (flow === "C") { // Tower : premier défi
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée");
  await snap("Plus tard", click("button", /Plus tard/));
  await snap("The Tower", click("link", /The Tower/));
} else if (flow === "D") { // Jouer maintenant
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée");
  await snap("Plus tard", click("button", /Plus tard/));
  await snap("Jouer maintenant", click("link", /Jouer maintenant/));
  const demarrer = page.getByRole("button", { name: /Démarrer/ }).first();
  console.log("Bouton Démarrer : désactivé =", await demarrer.isDisabled(), "| texte d'aide près du bouton :", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("main p, main small, main [role=status]")].map(e => e.textContent.trim()).filter(t => /sélection|choisi|au moins|joueur/i.test(t)).slice(0, 4))));
  console.log("Cases « Prévenir qui » cochées par défaut :", await page.locator("input[name=notifyUserId]:checked").count(), "/", await page.locator("input[name=notifyUserId]").count());
  await snap("Choisir un jeu (recherche + sélection)", async () => { await page.getByPlaceholder(/Rechercher un jeu/).fill("Overcooked"); await page.waitForTimeout(1500); await page.locator("main [role=option], main ul li button, main li[role=option]").first().click(); });
  await snap("Démarrer (31 potes prévenus par défaut)", () => page.getByRole("button", { name: /Démarrer/ }).first().click());
} else if (flow === "E") { // Configurer mon profil pas à pas
  await page.goto(origin + "/", { waitUntil: "load" });
  await snap("Arrivée");
  await snap("Configurer mon profil pas à pas", click("link", /Configurer mon profil|pas à pas/));
  await snap("Je n'utilise pas Steam", click("button", /Je n.utilise pas Steam/));
  await snap("Suivant", click("button", /Suivant/));
}
await browser.close(); await db.$disconnect();
writeFileSync(`${dir}/${flow}-${viewportName}.json`, JSON.stringify(steps, null, 1));
for (const s of steps) console.log(`#${s.n} [${s.clicks} clic] ${s.ok ? s.url : "ÉCHEC " + s.error} | ${s.label} | h1: ${s.h1 ?? ""} | dialogue: ${s.dialog ?? ""}\n    actions: ${(s.actions ?? []).join(" · ")}`);
