// Crawl des liens internes de l'application (mission 3) : parcours en largeur depuis l'accueil, en LOCAL (serveur de
// développement, base jetable, sessions de test, sortie réseau bloquée hors 127.0.0.1). Lecture seule : uniquement des GET
// de pages, aucun formulaire envoyé, jamais un lien de déconnexion ni /api/*. Personas : visiteur, membre, administrateur.
// Usage : node crawl-liens.mjs <dossier de sortie>
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const out = process.argv[2] ?? "liens";
mkdirSync(out, { recursive: true });
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const CAP_PER_PREFIX = 3; // pages « identifiant » d'un même type visitées au plus 3 fois
const MAX_PAGES = 260;

async function context(browser, discordId) {
  const ctx = await browser.newContext({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, locale: "fr-FR" });
  await ctx.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  if (discordId) {
    const user = await db.user.findUniqueOrThrow({ where: { discordId } });
    await ctx.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 14400, token: { discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
    await ctx.addInitScript((id) => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
  }
  return ctx;
}
const norm = (href, base) => {
  try {
    const url = new URL(href, base);
    if (url.origin !== origin) return null;
    if (/^\/(api|_next)\b/.test(url.pathname) || /signout|logout|deconnexion/i.test(url.pathname)) return null;
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch { return null; }
};
const family = (path) => path.replace(/\/[a-z0-9]{20,}(?=\/|$)/gi, "/[id]").replace(/\/(\d{4})\/(\d{1,2})$/, "/[a]/[m]");

const browser = await chromium.launch();
const report = {};
for (const persona of [null, "p-1", "p-admin"]) {
  const name = persona ?? "visiteur";
  const ctx = await context(browser, persona);
  const page = await ctx.newPage();
  const seen = new Map(); // chemin -> résultat
  const familyCount = new Map();
  const queue = persona === "p-admin" ? ["/admin", "/"] : ["/"];
  const sources = new Map(); // chemin -> [{from, text}]
  while (queue.length && seen.size < MAX_PAGES) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    const fam = family(path);
    const n = (familyCount.get(fam) ?? 0) + 1;
    familyCount.set(fam, n);
    if (fam !== path && n > CAP_PER_PREFIX) continue;
    const result = { path, status: null, finalPath: null, h1: null, notFound: false, error: null };
    try {
      const res = await page.goto(origin + path, { waitUntil: "load", timeout: 90000 });
      await page.waitForTimeout(500);
      result.status = res.status();
      result.finalPath = new URL(page.url()).pathname.replace(/\/+$/, "") || "/";
      result.h1 = (await page.locator("h1").first().textContent({ timeout: 1500 }).catch(() => null))?.trim().slice(0, 70) ?? null;
      result.notFound = /rage quit/i.test(await page.locator("body").innerText().catch(() => ""));
      const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50) })));
      for (const link of links) {
        const target = norm(link.href, page.url());
        if (!target) continue;
        if (!sources.has(target)) sources.set(target, []);
        if (sources.get(target).length < 3) sources.get(target).push({ from: path, text: link.text });
        if (!seen.has(target) && !queue.includes(target)) queue.push(target);
      }
    } catch (error) { result.error = String(error).slice(0, 140); }
    seen.set(path, result);
    process.stdout.write(`${name.padEnd(9)} ${path.padEnd(50)} ${result.error ? "ERREUR" : result.status} ${result.finalPath !== path ? "→ " + result.finalPath : ""}\n`);
  }
  report[name] = { pages: [...seen.values()], sources: Object.fromEntries(sources), skippedInQueue: queue.length };
  await ctx.close();
}
await browser.close(); await db.$disconnect();
writeFileSync(`${out}/liens.json`, JSON.stringify(report, null, 1));
console.log("FIN");
