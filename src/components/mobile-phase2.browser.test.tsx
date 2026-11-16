import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { LocalChromium } from "@/test-utils/local-chromium";

vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque" }));
vi.mock("@/app/actions", () => ({ removeUserGame: vi.fn(), toggleGameCoop: vi.fn() }));
vi.mock("./EditGameDialog", () => ({ EditGameDialog: () => null }));

import { SegmentedControl } from "./ui/SegmentedControl";
import { LibraryTabs } from "./LibraryTabs";
import { BibliothequeGrid } from "./BibliothequeGrid";
import { SessionRow, type SessionRowData } from "./sessions/SessionRow";

/**
 * Recette responsive des composants mobile de la phase 2, dans Chrome réel.
 * Les pages `/sessions`, `/tournois` et `/bibliotheque` demandent une session
 * Discord : elles ne sont pas affichables ici. On mesure donc les composants
 * réels qu'elles rendent, à 320/360/390/414 px.
 */
let browser: LocalChromium;
let css = "";

beforeAll(async () => {
  const file = resolve("src/app/globals.css");
  const out = await postcss([tailwind({ base: process.cwd() })]).process(readFileSync(file, "utf8"), { from: file });
  css = out.css;
  browser = await LocalChromium.open();
}, 120000);
afterAll(async () => { await browser?.close(); });

const GAMES = [
  { id: "g1", name: "Deep Rock Galactic", coverUrl: null, source: "STEAM", isCoop: true, minPlayers: 1, maxPlayers: 4 },
  { id: "g2", name: "The Legend of Zelda : Breath of the Wild", coverUrl: null, source: "MANUAL", isCoop: false, minPlayers: 1, maxPlayers: 1 },
  { id: "g3", name: "It Takes Two", coverUrl: null, source: "STEAM", isCoop: true, minPlayers: 2, maxPlayers: 2 },
  { id: "g4", name: "Super Mario Party Jamboree", coverUrl: null, source: "IGDB", isCoop: false, minPlayers: 2, maxPlayers: 4 },
];

const SESSION = {
  id: "s1",
  status: "SCHEDULED",
  date: new Date("2026-11-21T20:00:00.000Z"),
  decidedGameId: "g1",
  decidedGame: { id: "g1", name: "Deep Rock Galactic" },
  communityTeam: { name: "Les Nains de la Forge" },
  _count: { proposals: 2 },
  proposals: [
    {
      gameId: "g1",
      votes: ["Maxime", "Léa", "Nico", "Sam", "Jo", "Alex"].map((name, index) => ({
        userId: `u${index}`,
        user: { discordName: name, discordAvatar: null, color: "blue" },
      })),
    },
  ],
} as unknown as SessionRowData;

const TOURNOIS_OPTIONS = [
  { key: "en-cours", label: "En cours", href: "#" },
  { key: "a-venir", label: "À venir", href: "#" },
  { key: "termines", label: "Terminés", href: "#" },
  { key: "annules", label: "Annulés", href: "#" },
];

function page(body: string) {
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="gn-authenticated"><main class="gn-main">${body}</main></body></html>`;
}

const SHELL = "mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8";

type SegmentedPage = {
  overflow: number;
  scrollable: boolean;
  lastReachableAfterScroll: boolean;
  pills: Array<{ text: string; height: number; labelHeight: number; lineHeight: number }>;
};

const SEGMENTED = `(() => {
  const group = document.querySelector('.gn-scroll-x');
  const pills = [...group.querySelectorAll('a, button')].map((node) => {
    // Premier span = pastille d'accent en position absolue ; le libellé est le dernier.
    const label = [...node.querySelectorAll('span')].pop();
    const style = getComputedStyle(label);
    return {
      text: (label.textContent || '').trim(),
      height: +node.getBoundingClientRect().height.toFixed(1),
      labelHeight: +label.getBoundingClientRect().height.toFixed(1),
      lineHeight: parseFloat(style.lineHeight) || 20,
    };
  });
  const scrollable = group.scrollWidth - group.clientWidth > 1;
  group.scrollLeft = group.scrollWidth;
  const last = group.querySelectorAll('a, button');
  const lastBox = last[last.length - 1].getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    scrollable,
    lastReachableAfterScroll: lastBox.right <= innerWidth + 1 && lastBox.left >= 0,
    pills,
  };
})()`;

it.each([320, 360, 390, 414])("onglets tournois utilisables à %ipx", async (width) => {
  await browser.render(
    page(`<div class="${SHELL}">${renderToStaticMarkup(<SegmentedControl groupId="t" activeKey="en-cours" options={TOURNOIS_OPTIONS} />)}</div>`),
    width,
    true,
  );
  const result = await browser.evaluate<SegmentedPage>(SEGMENTED);
  expect(result.overflow).toBe(0);
  expect(result.pills).toHaveLength(4);
  for (const pill of result.pills) {
    // 44 px minimum, et libellé sur une seule ligne (2 lignes = 2 × line-height).
    expect(pill.height).toBeGreaterThanOrEqual(44);
    expect(pill.labelHeight).toBeLessThan(pill.lineHeight * 1.5);
  }
  // Quand les quatre options ne tiennent pas, le groupe défile au lieu de
  // comprimer le texte ; la dernière option reste atteignable.
  if (result.scrollable) expect(result.lastReachableAfterScroll).toBe(true);
});

type TabsPage = {
  overflow: number;
  navLabel: string | null;
  scrollable: boolean;
  lastReachableAfterScroll: boolean;
  heights: number[];
};

const TABS = `(() => {
  const nav = document.querySelector('nav');
  const tabs = [...nav.querySelectorAll('a')];
  const scrollable = nav.scrollWidth - nav.clientWidth > 1;
  nav.scrollLeft = nav.scrollWidth;
  const lastBox = tabs[tabs.length - 1].getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    navLabel: nav.getAttribute('aria-label'),
    scrollable,
    lastReachableAfterScroll: lastBox.right <= innerWidth + 1 && lastBox.left >= 0,
    heights: tabs.map((node) => +node.getBoundingClientRect().height.toFixed(1)),
  };
})()`;

it.each([320, 360])("onglets bibliothèque atteignables à %ipx", async (width) => {
  await browser.render(
    page(`<div class="${SHELL}">${renderToStaticMarkup(<LibraryTabs active="perso" toVerifyCount={3} />)}</div>`),
    width,
    true,
  );
  const result = await browser.evaluate<TabsPage>(TABS);
  expect(result.overflow).toBe(0);
  expect(result.navLabel).toBe("Vues de la bibliothèque");
  expect(result.heights).toHaveLength(6);
  for (const height of result.heights) expect(height).toBeGreaterThanOrEqual(44);
  expect(result.scrollable).toBe(true);
  expect(result.lastReachableAfterScroll).toBe(true);
});

type RowPage = {
  overflow: number;
  dateClipped: boolean;
  dateLines: number;
  dateText: string;
  cardHeight: number;
};

const ROW = `(() => {
  const date = document.querySelector('main p');
  const card = document.querySelector('main a');
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    dateClipped: date.scrollWidth - date.clientWidth > 1,
    dateLines: Math.round(date.getBoundingClientRect().height / (parseFloat(getComputedStyle(date).lineHeight) || 20)),
    dateText: (date.textContent || '').trim(),
    cardHeight: +card.getBoundingClientRect().height.toFixed(1),
  };
})()`;

it.each([320, 360, 390, 414])("carte de soirée lisible à %ipx", async (width) => {
  await browser.render(
    page(`<div class="${SHELL}">${renderToStaticMarkup(<SessionRow session={SESSION} needsSuperlativeVote={false} />)}</div>`),
    width,
    true,
  );
  const result = await browser.evaluate<RowPage>(ROW);
  expect(result.overflow).toBe(0);
  // La date n'est plus tronquée : elle passe à la ligne, l'heure reste visible.
  expect(result.dateClipped).toBe(false);
  expect(result.dateText).toMatch(/20:00/);
  expect(result.dateText).not.toMatch(/Novembre/);
  if (width === 320) expect(result.dateLines).toBeGreaterThan(1);
  expect(result.cardHeight).toBeGreaterThanOrEqual(88);
});

type GridPage = {
  overflow: number;
  chips: Array<{ text: string; fontSize: number; height: number }>;
};

const GRID = `(() => {
  const chips = [...document.querySelectorAll('form button[type="submit"]')].filter((node) => /coop/i.test(node.textContent || '')).map((node) => ({
    text: (node.textContent || '').trim(),
    fontSize: parseFloat(getComputedStyle(node).fontSize),
    height: +node.getBoundingClientRect().height.toFixed(1),
  }));
  return { overflow: document.documentElement.scrollWidth - innerWidth, chips };
})()`;

it.each([320, 390])("actions de la bibliothèque lisibles à %ipx", async (width) => {
  await browser.render(
    page(`<div class="${SHELL}">${renderToStaticMarkup(<BibliothequeGrid games={GAMES} />)}</div>`),
    width,
    true,
  );
  const result = await browser.evaluate<GridPage>(GRID);
  expect(result.overflow).toBe(0);
  expect(result.chips).toHaveLength(4);
  for (const chip of result.chips) {
    expect(chip.text).toMatch(/coop/);
    expect(chip.fontSize).toBeGreaterThanOrEqual(12);
    expect(chip.height).toBeGreaterThanOrEqual(32);
  }
});
