// Mêmes contrôles que le lot A1, sur un serveur LOCAL (main + les 7 interrupteurs du lot) avec des sessions de test
// (jeton Auth.js signé avec un secret éphémère). Sortie réseau bloquée hors 127.0.0.1. Usage : node ... <dossier>
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const out = process.argv[2] ?? "local";
mkdirSync(out, { recursive: true });
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const game = await db.game.findFirstOrThrow({ orderBy: { name: "asc" } });
const browser = await chromium.launch();
const results = [];
async function session(discordId, device) {
  const user = await db.user.findUniqueOrThrow({ where: { discordId } });
  const ctx = await browser.newContext(device ? { ...devices[device], locale: "fr-FR" } : { viewport: { width: 1280, height: 800 }, locale: "fr-FR" });
  await ctx.route("**/*", (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await ctx.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 7200, token: { discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
  await ctx.addInitScript((id) => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
  return ctx;
}
async function go(page, path) {
  const res = await page.goto(origin + path, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(1200);
  return { status: res.status(), url: new URL(page.url()).pathname, title: await page.title(), main: ((await page.locator("main").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ") };
}
const rec = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "OK" : "KO"}  ${id} — ${detail}`); };

const member = await session("p-1");
const page = await member.newPage();
const home = await go(page, "/");
rec("titre accueil", home.title.length > 0, `« ${home.title} »`);
await page.screenshot({ path: `${out}/bureau-accueil.png` });
const s = await go(page, "/sessions");
rec("titre /sessions", s.title === "Soirées · GameNight", `« ${s.title} »`);
await page.screenshot({ path: `${out}/bureau-sessions.png` });
const t = await go(page, "/tower");
rec("titre /tower", /· GameNight$/.test(t.title) && !/^GameNight$/.test(t.title), `« ${t.title} »`);
rec("/tower s'affiche", t.status === 200 && t.url === "/tower", `HTTP ${t.status}, ${t.url}`);
rec("/tower phrase étages", /étages Tower repartent de zéro/.test(await page.locator("body").innerText()), "phrase « …tes étages Tower repartent de zéro »");
await page.screenshot({ path: `${out}/bureau-tower.png` });
const a = await go(page, "/ascension");
rec("/ascension s'affiche", a.status === 200 && a.url === "/ascension", `HTTP ${a.status}, titre « ${a.title} »`);
rec("/ascension phrase étages", /étages Tower repartent de zéro/.test(await page.locator("body").innerText()), "phrase sur les étages");
await page.screenshot({ path: `${out}/bureau-ascension.png` });
const g = await go(page, "/guide");
rec("titre /guide", /^Guide · GameNight$/.test(g.title) || /· GameNight$/.test(g.title), `« ${g.title} »`);
const body = await page.locator("body").innerText();
rec("/guide « Jouer maintenant »", /Jouer maintenant/.test(body), "section présente");
rec("/guide « Tournois »", /Tournois/.test(body), "section présente");
await page.screenshot({ path: `${out}/bureau-guide.png`, fullPage: true });
const j = await go(page, `/jeux/${game.id}`);
rec("titre dynamique fiche jeu", j.title === `${game.name} · GameNight`, `« ${j.title} » (attendu « ${game.name} · GameNight »)`);
await page.screenshot({ path: `${out}/bureau-fiche-jeu.png` });
await go(page, "/sessions");
const side = await page.locator("a[href='/tower']").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));
rec("menu ordinateur « The Tower »", side.some((x) => /The Tower/.test(x)), `liens visibles : ${JSON.stringify(side)}`);
await member.close();

const mob = await session("p-1", "iPhone 13");
const mp = await mob.newPage();
await go(mp, "/sessions");
const bar = await mp.locator("a[href='/tower']").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));
const opener = mp.getByRole("button", { name: /menu/i }).first();
if (await opener.count()) { await opener.click().catch(() => {}); await mp.waitForTimeout(800); }
const drawer = await mp.locator("a[href='/tower']").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()));
rec("menu mobile « The Tower »", [...bar, ...drawer].some((x) => /The Tower/.test(x)), `barre : ${JSON.stringify(bar)} ; tiroir : ${JSON.stringify(drawer)}`);
await mp.screenshot({ path: `${out}/mobile-menu.png` });
await go(mp, "/tower"); await mp.screenshot({ path: `${out}/mobile-tower.png` });
await go(mp, "/guide"); await mp.screenshot({ path: `${out}/mobile-guide.png` });
await mob.close();

const adm = await session("p-admin");
const ap = await adm.newPage();
const d = await go(ap, "/admin/tableau-de-bord");
rec("/admin/tableau-de-bord (admin)", d.status === 200 && d.url === "/admin/tableau-de-bord", `HTTP ${d.status}, ${d.url}, titre « ${d.title} »`);
await ap.screenshot({ path: `${out}/bureau-tableau-de-bord.png` });
await adm.close();
const mem2 = await session("p-1");
const mp2 = await mem2.newPage();
const d2 = await go(mp2, "/admin/tableau-de-bord");
rec("/admin/tableau-de-bord (membre)", d2.url === "/" || d2.status === 404, `non-admin : ${d2.url} (HTTP ${d2.status})`);
await mem2.close();
writeFileSync(`${out}/resultats.json`, JSON.stringify(results, null, 2));
await browser.close(); await db.$disconnect();
