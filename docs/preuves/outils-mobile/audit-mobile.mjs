// Audit téléphone (iPhone 13 et Pixel 7) de toutes les pages de l'application, en LOCAL (serveur Next de développement,
// base jetable peuplée, sessions de test signées avec un secret éphémère, sortie réseau bloquée hors 127.0.0.1).
// Par page : capture, débordement horizontal, texte coupé, cibles tactiles trop petites ou recouvertes, temps de chargement.
// Usage : node audit-mobile.mjs <dossier de sortie> [filtre de chemin]
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const out = process.argv[2] ?? "mobile";
const only = process.argv[3] ?? "";
mkdirSync(out, { recursive: true });
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const routes = readFileSync("/tmp/claude-0/routes.txt", "utf8").split("\n").filter(Boolean);

const pick = async (model, args = {}) => { try { return (await db[model].findFirst({ select: { id: true }, ...args }))?.id ?? null; } catch { return null; } };
const me = await db.user.findUniqueOrThrow({ where: { discordId: "p-1" } });
const ids = {
  session: await pick("session", { orderBy: { date: "desc" } }),
  doneSession: await pick("session", { where: { status: "DONE" } }),
  tournament: await pick("tournament"),
  game: await pick("game"),
  pote: (await db.user.findFirst({ where: { id: { not: me.id }, discordId: { startsWith: "p-" } }, select: { id: true } }))?.id ?? null,
  team: await pick("communityTeam"),
  roulette: await pick("roulette"),
  instant: await pick("instantSession"),
  poll: await pick("sessionAvailabilityPoll"),
  project: await pick("project"),
};
const resolve = (route) => {
  const t = (id, sub = "") => (id ? route.replace(/\[[^\]]+\]/, id) : null);
  if (route.startsWith("/sessions/[id]/resultats") || route.startsWith("/sessions/[id]/vote-superlatifs")) return t(ids.doneSession ?? ids.session);
  if (route.startsWith("/sessions/[id]")) return t(ids.session);
  if (route.startsWith("/sessions/sondages/[id]")) return t(ids.poll);
  if (route.startsWith("/tournois/")) return t(ids.tournament);
  if (route.startsWith("/jeux/[id]") || route.startsWith("/admin/jeux-stats/[gameId]")) return t(ids.game);
  if (route.startsWith("/potes/[id]")) return t(ids.pote);
  if (route.startsWith("/equipes/[id]")) return t(ids.team);
  if (route.startsWith("/roulette/[id]")) return t(ids.roulette);
  if (route.startsWith("/jouer-maintenant/[id]")) return t(ids.instant);
  if (route.startsWith("/projets/[id]")) return t(ids.project);
  if (route.startsWith("/admin/voice-presence/[sessionId]")) return t(ids.session);
  if (route.startsWith("/recap/[year]/[month]")) return "/recap/2026/11";
  return null;
};
const pages = [];
const unresolved = [];
for (const route of routes) {
  if (!route.includes("[")) { pages.push({ route, path: route }); continue; }
  const path = resolve(route);
  if (path) pages.push({ route, path }); else unresolved.push(route);
}
const todo = pages.filter((p) => p.path.includes(only));

async function context(browser, device, discordId) {
  const user = await db.user.findUniqueOrThrow({ where: { discordId } });
  const ctx = await browser.newContext({ ...devices[device], locale: "fr-FR" });
  await ctx.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await ctx.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 14400, token: { discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
  await ctx.addInitScript((id) => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
  return ctx;
}

/** Mesures dans la page (exécutées dans le navigateur). */
function measure() {
  const vw = window.innerWidth;
  const describe = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} « ${(el.innerText || el.getAttribute("aria-label") || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40)} »`;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - vw;
  const overflowers = [];
  if (overflowX > 1) {
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && visible(el) && !el.closest("[aria-hidden=true]")) {
        // ignorer les éléments dans un conteneur qui défile horizontalement exprès
        let p = el.parentElement, scrolls = false;
        while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") { scrolls = true; break; } p = p.parentElement; }
        if (!scrolls) { overflowers.push(describe(el)); if (overflowers.length >= 5) break; }
      }
    }
  }
  const clipped = [];
  const ellipsis = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!el.childElementCount && (el.innerText || "").trim() && visible(el)) {
      const s = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && (s.overflowX === "hidden" || s.overflowX === "clip")) (s.textOverflow === "ellipsis" ? ellipsis : clipped).push(describe(el));
    }
  }
  const small = [];
  const covered = [];
  const offscreen = [];
  const smallSevere = [];
  for (const el of document.querySelectorAll("a[href],button,[role=button],input:not([type=hidden]),select,textarea,summary,[role=tab]")) {
    if (!visible(el) || el.closest("[aria-hidden=true],[inert]")) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.left >= vw) { offscreen.push(describe(el)); continue; }
    const inlineText = el.tagName === "A" && el.closest("p,li,span:not([class*=badge])") && getComputedStyle(el).display === "inline";
    if (!inlineText && (r.width < 44 || r.height < 44)) { (r.width < 32 || r.height < 32 ? smallSevere : small).push(`${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`); }
    if (r.top >= 0 && r.bottom <= window.innerHeight) {
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.push(`${describe(el)} recouvert par ${describe(top)}`);
    }
  }
  const nav = performance.getEntriesByType("navigation")[0];
  return {
    overflowX: Math.max(0, overflowX), overflowers,
    clipped: clipped.slice(0, 6), clippedCount: clipped.length, ellipsisCount: ellipsis.length,
    smallCount: small.length + smallSevere.length, smallSevereCount: smallSevere.length, smallSevere: smallSevere.slice(0, 6), small: small.slice(0, 4),
    covered: covered.slice(0, 5), coveredCount: covered.length, offscreen: offscreen.slice(0, 5), offscreenCount: offscreen.length,
    loadMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
    h1: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 60), title: document.title,
    notFound: /rage quit|Introuvable/i.test(document.body.innerText) && !!document.querySelector("h1"),
  };
}

const browser = await chromium.launch();
const results = [];
for (const device of ["iPhone 13", "Pixel 7"]) {
  const tag = device.replace(/\s/g, "").toLowerCase();
  for (const persona of ["p-1", "p-admin"]) {
    const ctx = await context(browser, device, persona);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    for (const { route, path } of todo) {
      const isAdmin = path.startsWith("/admin");
      if ((persona === "p-admin") !== isAdmin) continue;
      const entry = { device, persona, route, path };
      try {
        errors.length = 0;
        let res = await page.goto(origin + path, { waitUntil: "load", timeout: 120000 }); // 1er passage : compilation du serveur de développement
        await page.waitForTimeout(700);
        const first = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? Math.round(n.loadEventEnd - n.startTime) : null; });
        res = await page.goto(origin + path, { waitUntil: "load", timeout: 60000 }); // 2e passage : chargement « à chaud », celui qui compte
        await page.waitForTimeout(900);
        entry.status = res.status(); entry.finalPath = new URL(page.url()).pathname; entry.firstLoadMs = first;
        Object.assign(entry, await page.evaluate(measure));
        entry.pageErrors = [...errors];
        const file = `${out}/${tag}/${path === "/" ? "accueil" : path.replace(/^\//, "").replace(/[\/?=&]/g, "_")}.png`;
        mkdirSync(`${out}/${tag}`, { recursive: true });
        await page.screenshot({ path: file });
        entry.screenshot = file;
      } catch (error) { entry.error = String(error).slice(0, 160); }
      results.push(entry);
      const flag = entry.error ? "ERREUR" : [entry.overflowX > 1 ? `débord ${entry.overflowX}px` : "", entry.smallSevereCount ? `${entry.smallSevereCount} cibles <32px` : "", entry.coveredCount ? `${entry.coveredCount} recouvertes` : "", entry.clippedCount ? `${entry.clippedCount} coupés` : "", entry.loadMs > 3000 ? `${entry.loadMs}ms` : ""].filter(Boolean).join(", ") || "ok";
      console.log(`${tag.padEnd(9)} ${path.padEnd(46)} ${String(entry.status ?? "-").padEnd(4)} ${flag}`);
      writeFileSync(`${out}/resultats.json`, JSON.stringify({ ids, unresolved, results }, null, 1));
    }
    await ctx.close();
  }
}
await browser.close(); await db.$disconnect();
console.log("FIN", results.length, "mesures ; non résolues :", unresolved.join(", "));
