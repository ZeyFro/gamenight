import { createRequire } from "node:module";import { readFileSync } from "node:fs";import { PrismaClient } from "@prisma/client";import { encode } from "next-auth/jwt";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const origin = "http://127.0.0.1:3102";
const [persona, device, ...paths] = process.argv.slice(2);
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
const user = await db.user.findUniqueOrThrow({ where: { discordId: persona } });
const secret = readFileSync("/tmp/preuves-auth-secret", "utf8").trim();
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices[device], locale: "fr-FR" });
await context.route("**/*", route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
await context.addCookies([{ name: "authjs.session-token", value: await encode({ secret, salt: "authjs.session-token", maxAge: 7200, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } }), url: origin, httpOnly: true, sameSite: "Lax" }]);
await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
const page = await context.newPage();
for (const path of paths) {
  const response = await page.goto(origin + path, { waitUntil: "load", timeout: 90_000 }); await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({ title: document.title, h1: document.querySelector("h1")?.textContent?.trim(), h2: [...document.querySelectorAll("main h2")].map(h => h.textContent.trim()).slice(0, 3), url: location.pathname, tabs: [...document.querySelectorAll("[role=tab],nav[aria-label*=rofil] a")].map(a => a.textContent.trim()).slice(0, 8), main: (document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 160) }));
  console.log(response.status(), path, "→", JSON.stringify(info));
}
await browser.close(); await db.$disconnect();
