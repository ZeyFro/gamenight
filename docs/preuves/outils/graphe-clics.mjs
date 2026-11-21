// Plus court chemin en clics depuis l'accueil du nouveau joueur (profil neuf, bureau 1280 px) vers chaque page, par parcours en largeur des liens réels.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const user = await db.user.findUniqueOrThrow({ where: { discordId: "p-nouveau" } });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.route("**/*", route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
await context.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 7200, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
const norm = path => path.replace(/[a-z0-9]{20,}/g, ":id").replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/$/, "") || "/";
const dist = new Map([["/", { clicks: 0, via: [] }]]);
const queue = [{ key: "/", href: "/" }];
const page = await context.newPage();
const links = {};
const maxDepth = Number(process.env.PROFONDEUR ?? 3);
while (queue.length) {
  const { key: current, href: currentHref } = queue.shift();
  const { clicks, via } = dist.get(current);
  if (clicks >= maxDepth) continue;
    try { await page.goto(origin + currentHref, { waitUntil: "load", timeout: 60_000 }); } catch { continue; }
  const found = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map(a => ({ href: a.getAttribute("href"), text: (a.textContent || a.getAttribute("aria-label") || "").trim().slice(0, 50), nav: Boolean(a.closest("nav, aside, header")) })));
  links[current] = found.length;
  for (const link of found) {
    if (!link.href.startsWith("/") || link.href.startsWith("//") || link.href.startsWith("/api") || link.href.startsWith("/_next")) continue;
    const target = norm(link.href);
    if (!dist.has(target)) { dist.set(target, { clicks: clicks + 1, via: [...via, `${current} → « ${link.text || "(sans texte)"} »`] }); queue.push({ key: target, href: link.href.split("?")[0].split("#")[0] }); }
  }
}
await browser.close(); await db.$disconnect();
const result = Object.fromEntries([...dist.entries()].sort((a, b) => a[1].clicks - b[1].clicks));
writeFileSync("docs/preuves/graphe-clics.json", JSON.stringify({ depuis: "/", profil: "nouveau (sans donnée), bureau, invite d'onboarding repoussée", pages: result }, null, 1));
for (const [path, info] of Object.entries(result)) console.log(info.clicks, path, info.via.at(-1) ?? "");
