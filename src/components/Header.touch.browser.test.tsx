import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { LocalChromium } from "@/test-utils/local-chromium";

// Seules les entrées serveur/routage sont fictives : Header, Sidebar, ChatPanel,
// NotificationBell, leur markup et le vrai globals.css/Tailwind sont conservés.
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: "fixture", discordName: "Recette", discordAvatar: null, color: "blue", xpTotal: 100 }) }));
vi.mock("@/lib/notifications", () => ({ getUnreadNotificationCount: async () => 12, listRecentNotifications: async () => [], groupNotifications: async () => [] }));
vi.mock("@/lib/chat", () => ({ getChatMessages: async () => [] }));
vi.mock("@/lib/community-picker", () => ({ isCommunityPickerEnabled: () => false }));
vi.mock("@/lib/community-read-context", () => ({ withCommunityReadContext: (render: () => unknown) => render() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({}) }));
vi.mock("@/app/notifications-actions", () => ({ markAllNotificationsReadAction: vi.fn() }));
vi.mock("@/app/chat/actions", () => ({ getChatMessagesAction: vi.fn(), sendChatMessageAction: vi.fn(), toggleReactionAction: vi.fn() }));
vi.mock("@/app/serveurs/actions", () => ({ changeCommunityAction: vi.fn() }));
import { Header } from "./Header";

let browser: LocalChromium;
let html: string;
beforeAll(async () => {
  const file = resolve("src/app/globals.css");
  const css = await postcss([tailwind({ base: process.cwd() })]).process(readFileSync(file, "utf8"), { from: file });
  const markup = renderToStaticMarkup(await Header());
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body>${markup}</body></html>`;
  browser = await LocalChromium.open();
}, 30000);
afterAll(async () => { await browser?.close(); });

type Measurement = { coarse: boolean; gap: number; widths: number[]; misses: string[]; overflow: boolean };
async function measure(width: number, touch: boolean) {
  await browser.render(html, width, touch);
  const result = await browser.evaluate<Measurement & { taps: { x: number; y: number; expected: string }[] }>(`(() => {
    const labels = ['Chat', 'Notifications'];
    const buttons = labels.map(label => document.querySelector('header button[aria-label="'+label+'"]'));
    if (buttons.some(button => !button)) throw Error('Vrais boutons du header absents');
    const rects = buttons.map(button => button.getBoundingClientRect());
    const misses = [];
    buttons.forEach((button,index) => {
      const rect = rects[index];
      const offsets = ${touch ? "[-21,0,21]" : "[0]"};
      for (const dx of offsets) for (const dy of offsets) {
        const hit = document.elementFromPoint(rect.x+rect.width/2+dx,rect.y+rect.height/2+dy)?.closest('button');
        if (hit !== button) misses.push(labels[index]+' -> '+(hit?.getAttribute('aria-label') ?? 'aucune cible'));
      }
    });
    const taps = rects.map((rect,index) => ({x:rect.x+rect.width/2+(${touch ? 21 : 0})*(index===0?1:-1),y:rect.y+rect.height/2,expected:labels[index]}));
    return {coarse:matchMedia('(pointer:coarse)').matches,gap:rects[1].left-rects[0].right,widths:rects.map(r=>r.width),misses,overflow:document.documentElement.scrollWidth>innerWidth,taps};
  })()`);
  for (const point of result.taps) {
    await browser.evaluate(`window.__headerClickPromise = new Promise(resolve => {
      const timer = setTimeout(() => resolve('aucun événement reçu'), 1500);
      document.addEventListener('${touch ? "pointerdown" : "click"}', event => {
        clearTimeout(timer);
        resolve(event.target.closest('button')?.getAttribute('aria-label') ?? null);
      }, {once:true});
    }); void 0`);
    if (touch) {
      await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
      await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await browser.command("Input.synthesizeTapGesture", { x: point.x, y: point.y, gestureSourceType: "mouse" });
    }
    expect(await browser.evaluate("window.__headerClickPromise")).toBe(point.expected);
  }
  return result;
}

it.each([320, 360, 390, 640, 768])("atteint les bons boutons du vrai header sur toute leur cible tactile à %ipx", async width => {
  const result = await measure(width, true);
  expect(result.coarse).toBe(true);
  expect(result.gap).toBe(width >= 640 ? 12 : 8);
  expect(result.misses).toEqual([]);
  expect(result.widths).toEqual([36, 36]);
  expect(result.overflow).toBe(false);
});
it("préserve les boîtes et l'espacement desktop avec une souris", async () => {
  const result = await measure(1366, false);
  expect(result.coarse).toBe(false);
  expect(result.widths).toEqual([36, 36]);
  expect(result.gap).toBe(12);
  expect(result.misses).toEqual([]);
  expect(result.overflow).toBe(false);
});
