// Contrôles du lot A1 sur la production : GET en lecture seule, sans compte, aucun envoi de formulaire.
// Usage : node controle-lot-a1.mjs <dossier de sortie>
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = "https://gamenight-zeyfro.vercel.app";
const out = process.argv[2] ?? "lot-a1";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
async function visit(label, path, device) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const t0 = Date.now();
  const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => ({ error: String(e) }));
  const ms = Date.now() - t0;
  const info = {
    label, path, device: device ?? "bureau", status: res?.status?.() ?? null, finalUrl: page.url().replace(BASE, "") || "/",
    title: await page.title(), ms,
    h1: (await page.locator("h1").first().textContent({ timeout: 2000 }).catch(() => null))?.trim() ?? null,
    bodyHas: {},
    youtube: requests.filter((u) => /youtube|ytimg/.test(u)).length,
  };
  const text = await page.locator("body").innerText().catch(() => "");
  info.bodyText = text.slice(0, 1200);
  const file = `${out}/${label}.png`;
  await page.screenshot({ path: file, fullPage: false });
  info.screenshot = file;
  report.push(info);
  await ctx.close();
  return info;
}
for (const [label, path] of [["accueil", "/"], ["sessions", "/sessions"], ["tower", "/tower"], ["ascension", "/ascension"], ["guide", "/guide"], ["classement", "/classement"], ["jeux-inconnu", "/jeux/inexistant"], ["connexion", "/connexion"], ["mentions", "/mentions-legales"]]) {
  await visit(`bureau-${label}`, path);
}
await visit("mobile-accueil", "/", "iPhone 13");
await visit("mobile-guide", "/guide", "iPhone 13");
await visit("mobile-tower", "/tower", "iPhone 13");
writeFileSync(`${out}/resultats.json`, JSON.stringify(report, null, 2));
await browser.close();
for (const r of report) console.log(`${r.label.padEnd(22)} ${String(r.status).padEnd(4)} ${r.finalUrl.padEnd(22)} | ${r.title} | h1=${r.h1} | ${r.ms}ms`);
