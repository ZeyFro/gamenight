import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { LocalChromium } from "@/test-utils/local-chromium";

// Seul le routage est fictif : le vrai composant, le vrai globals.css et le
// vrai Tailwind sont rendus dans un Chrome local.
vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque" }));

import { BottomNav } from "./BottomNav";

let browser: LocalChromium;
let html: string;
beforeAll(async () => {
  const file = resolve("src/app/globals.css");
  const css = await postcss([tailwind({ base: process.cwd() })]).process(readFileSync(file, "utf8"), { from: file });
  const markup = renderToStaticMarkup(<BottomNav />);
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body class="gn-authenticated"><main class="gn-main">${markup}</main></body></html>`;
  browser = await LocalChromium.open();
}, 60000);
afterAll(async () => { await browser?.close(); });

type Item = { text: string; width: number; height: number; labelWidth: number; labelOutside: boolean; tapHitsSelf: boolean };
type Measurement = { items: Item[]; overlaps: string[]; docOverflow: number; navWidth: number };

const SCRIPT = `(() => {
  const nav = document.querySelector('nav[aria-label="Navigation principale"]');
  if (!nav) return { items: [], overlaps: [], docOverflow: 0, navWidth: 0 };
  const labels = [];
  const items = [...nav.querySelectorAll('a')].map(a => {
    const r = a.getBoundingClientRect();
    // Le libellé visible est dans son propre span ; le span sr-only qui
    // complète le nom accessible ne doit pas fausser la largeur mesurée.
    const labelSpan = a.querySelector('[data-nav-label]');
    const textNode = [...labelSpan.childNodes].find(n => n.nodeType === 3);
    const range = document.createRange(); range.selectNodeContents(textNode);
    const lr = range.getBoundingClientRect();
    labels.push({ text: (a.textContent || '').trim(), left: lr.left, right: lr.right });
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      text: (a.textContent || '').trim(),
      width: +r.width.toFixed(1),
      height: +r.height.toFixed(1),
      labelWidth: +lr.width.toFixed(1),
      labelOutside: lr.left < r.left - 0.5 || lr.right > r.right + 0.5,
      tapHitsSelf: hit?.closest('a') === a,
    };
  });
  const overlaps = [];
  for (let i = 1; i < labels.length; i++) if (labels[i].left < labels[i - 1].right - 0.5) overlaps.push(labels[i - 1].text + ' / ' + labels[i].text);
  return { items, overlaps, docOverflow: document.documentElement.scrollWidth - innerWidth, navWidth: +nav.getBoundingClientRect().width.toFixed(1) };
})()`;

async function measure(width: number, touch: boolean) {
  await browser.render(html, width, touch);
  return browser.evaluate<Measurement>(SCRIPT);
}

it.each([320, 360, 390, 414])( "tient dans la largeur et reste touchable à %ipx", async (width) => {
  const result = await measure(width, true);
  expect(result.docOverflow).toBe(0);
  expect(result.items).toHaveLength(6);
  expect(result.items.map((item) => item.text)).toEqual([
    "Accueil",
    "Soirées",
    "Jeux, Bibliothèque",
    "Calendrier",
    "Potes",
    "Profil",
  ]);
  expect(result.overlaps).toEqual([]);
  for (const item of result.items) {
    expect(item.width).toBeGreaterThanOrEqual(44);
    expect(item.height).toBeGreaterThanOrEqual(56);
    expect(item.labelOutside).toBe(false);
    expect(item.tapHitsSelf).toBe(true);
  }
});

it("affiche la page courante sans agrandir la cible et se masque sur ordinateur", async () => {
  const mobile = await measure(390, true);
  expect(mobile.navWidth).toBe(390);
  const desktop = await measure(1280, false);
  expect(desktop.navWidth).toBe(0);
});
