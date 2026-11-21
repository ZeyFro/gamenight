// Captures Playwright LOCALES (127.0.0.1:3102 uniquement : toute requête externe est bloquée).
// Sessions : JWT Auth.js signés avec le secret éphémère du serveur local (aucun OAuth Discord réel).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const origin = "http://127.0.0.1:3102";
const dbUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.equal(dbUrl.pathname, "/gamenight_preuves");
assert.equal(dbUrl.hostname, "127.0.0.1");
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const db = new PrismaClient({ datasourceUrl: dbUrl.href });
const out = "docs/preuves/captures";
mkdirSync(out, { recursive: true });

const firstSession = await db.session.findFirstOrThrow({ where: { visibility: "PUBLIC" } });
const doneSession = await db.session.findFirstOrThrow({ where: { status: "DONE" } });
const tournaments = await db.tournament.findMany({ orderBy: { createdAt: "asc" } });
const team = await db.communityTeam.findFirstOrThrow();
const project = await db.project.findFirstOrThrow();
const game = await db.game.findFirstOrThrow();
const pote = await db.user.findUniqueOrThrow({ where: { discordId: "p-3" } });

const personas = {
  visiteur: null,
  nouveau: await db.user.findUniqueOrThrow({ where: { discordId: "p-nouveau" } }),
  actif: await db.user.findUniqueOrThrow({ where: { discordId: "p-0" } }),
  admin: await db.user.findUniqueOrThrow({ where: { discordId: "p-admin" } }),
};
const viewports = { mobile: { width: 375, height: 812 }, bureau: { width: 1280, height: 800 } };

const publicPages = ["/", "/charte", "/conditions", "/mentions-legales", "/confidentialite", "/tower"];
const memberPages = ["/", "/bienvenue", "/guide", "/ce-soir", "/jouer-maintenant", "/sessions", `/sessions/${firstSession.id}`, `/sessions/${doneSession.id}/resultats`, "/tournois", `/tournois/${tournaments[0].id}`, "/tournois/equipes", `/tournois/equipes/${tournaments[1].id}`,
  "/tower", "/tower/palmares", "/tower/forums", "/tower/propositions", "/ascension", "/saisons", "/classement", "/equipes", "/equipes/candidatures", "/equipes/gestion", `/equipes/${team.id}/rivalites`, "/joueurs", "/potes", `/potes/${pote.id}`, "/bibliotheque", "/bibliotheque/plateformes", "/bibliotheque/suggestions", "/wishlist", "/calendrier", "/disponibilites", "/notifications", "/projets", `/projets/${project.id}`, "/soutiens", "/profil", "/profil/parametres", "/profil/personnalisation", "/profil/badges", "/profil/boutique", "/profil/lore", "/profil/saisons", "/profil/historique", "/roulette", "/jeux-gratuits", "/serveurs", "/tierlist", `/jeux/${game.id}`, "/sessions/sondages"];
const adminPages = ["/admin", "/admin/tableau-de-bord", "/admin/tower-appeals", "/admin/tower-irregular", "/admin/tower-propositions", "/admin/tower-layout", "/admin/tower-palmares", "/admin/sante", "/admin/messages", "/admin/jeux-stats", "/admin/jeux-gratuits", "/admin/tower-archive", "/admin/tower-content-audit", "/admin/superlatifs", "/admin/voice-presence"];
const errorPages = [["actif", "/sessions/inconnu"], ["actif", "/tournois/inconnu"], ["actif", "/potes/inconnu"], ["actif", "/admin"], ["actif", "/admin/tableau-de-bord"], ["nouveau", "/admin"], ["visiteur", "/profil"], ["visiteur", "/sessions"], ["actif", "/page-qui-n-existe-pas"]];

const plan = [];
for (const path of publicPages) plan.push(["visiteur", path, "vide"]);
for (const path of memberPages) { plan.push(["nouveau", path, "vide"]); plan.push(["actif", path, "rempli"]); }
for (const path of adminPages) plan.push(["admin", path, "rempli"]);
for (const [persona, path] of errorPages) plan.push([persona, path, "erreur"]);

const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const slugOf = path => (path.replace(/[a-z0-9]{20,}/g, "id").replace(/^\/$/, "accueil").replace(/^\//, "").replace(/\//g, "_").replace(/[^a-zA-Z0-9_-]/g, "-") || "accueil");

async function compress(buffer, file) {
  for (const colours of [128, 64, 32, 16]) {
    const data = await sharp(buffer).png({ palette: true, colours, compressionLevel: 9, effort: 8 }).toBuffer();
    if (data.length <= 290_000) { writeFileSync(file, data); return data.length; }
  }
  const meta = await sharp(buffer).metadata();
  const data = await sharp(buffer).resize({ width: Math.round(meta.width * 0.7) }).png({ palette: true, colours: 32, compressionLevel: 9, effort: 8 }).toBuffer();
  writeFileSync(file, data);
  return data.length;
}

const manifest = [];
const browser = await chromium.launch();
try {
  const contexts = {};
  for (const [name, user] of Object.entries(personas)) {
    for (const [vpName, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "fr-FR", timezoneId: "Europe/Paris" });
      await context.route("**/*", route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
      if (user) {
        const cookie = "authjs.session-token";
        const value = await encode({ secret, salt: cookie, maxAge: 7200, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
        await context.addCookies([{ name: cookie, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
        // Le nouveau joueur voit l'invite d'onboarding ; les autres la repoussent.
        if (name !== "nouveau") await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
      }
      contexts[`${name}:${vpName}`] = context;
    }
  }
  for (const [persona, path, state] of plan) {
    if (only && !only.test(`${persona} ${path}`)) continue;
    for (const vpName of Object.keys(viewports)) {
      const context = contexts[`${persona}:${vpName}`];
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(String(error.message).slice(0, 200)));
      page.on("console", message => { if (message.type() === "error") errors.push(String(message.text()).slice(0, 200)); });
      const started = Date.now();
      let status = 0;
      let finalPath = path;
      try {
        const response = await page.goto(origin + path, { waitUntil: "load", timeout: 120_000 });
        status = response?.status() ?? 0;
        await page.waitForTimeout(700);
        finalPath = new URL(page.url()).pathname;
        const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n");
        const title = await page.title();
        const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? "");
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        const file = `${out}/${persona}-${vpName}-${slugOf(path)}.png`;
        const png = await page.screenshot({ fullPage: true, clip: undefined, ...(height > 3200 ? { fullPage: false } : {}) });
        const size = await compress(png, file);
        manifest.push({ persona, viewport: vpName, path, state, status, finalPath, title, h1, scrollHeight: height, file, bytes: size, errors, ms: Date.now() - started, text: text.slice(0, 2500) });
        console.log(persona, vpName, path, status, finalPath !== path ? `→ ${finalPath}` : "", `${Math.round(size / 1000)} ko`, errors.length ? `${errors.length} err` : "");
      } catch (error) {
        manifest.push({ persona, viewport: vpName, path, state, status: -1, error: String(error.message).slice(0, 200) });
        console.log("ÉCHEC", persona, vpName, path, String(error.message).slice(0, 100));
      } finally { await page.close(); }
    }
  }
} finally {
  await browser.close();
  await db.$disconnect();
  const previous = (() => { try { return JSON.parse(readFileSync(`${out}/manifeste.json`, "utf8")); } catch { return []; } })();
  const merged = [...previous.filter(old => !manifest.some(item => item.file === old.file && item.persona === old.persona && item.viewport === old.viewport && item.path === old.path)), ...manifest];
  writeFileSync(`${out}/manifeste.json`, JSON.stringify(merged, null, 1));
}
