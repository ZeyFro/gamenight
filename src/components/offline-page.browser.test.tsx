import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { LocalChromium } from "@/test-utils/local-chromium";

let browser: LocalChromium;
let html: string;
beforeAll(async () => {
  html = readFileSync(resolve("public/offline.html"), "utf8");
  browser = await LocalChromium.open();
}, 60000);
afterAll(async () => { await browser?.close(); });

type Measurement = {
  dataOnline: string;
  status: string;
  homeHidden: boolean;
  retryHeight: number;
  retryWidth: number;
  tapHitsRetry: boolean;
  overflow: number;
  heading: string;
  location: string;
};

const SCRIPT = `(() => {
  const retry = document.getElementById('retry');
  const home = document.getElementById('home');
  const status = document.getElementById('status');
  const box = retry.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    dataOnline: document.body.dataset.online,
    status: (status.textContent || '').trim(),
    homeHidden: home.hidden,
    retryHeight: +box.height.toFixed(1),
    retryWidth: +box.width.toFixed(1),
    tapHitsRetry: hit === retry || retry.contains(hit),
    overflow: document.documentElement.scrollWidth - innerWidth,
    heading: (document.querySelector('h1')?.textContent || '').trim(),
    location: location.pathname,
  };
})()`;

async function setNetwork(offline: boolean) {
  await browser.command("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

it.each([390, 1280])("affiche une page hors ligne exploitable à %ipx", async (width) => {
  await setNetwork(true);
  await browser.render(html, width, true);
  const page = await browser.evaluate<Measurement>(SCRIPT);
  expect(page.heading).toBe("Hors connexion");
  expect(page.dataOnline).toBe("false");
  expect(page.status).toBe("En attente de la connexion…");
  expect(page.homeHidden).toBe(true);
  expect(page.retryHeight).toBeGreaterThanOrEqual(44);
  expect(page.retryWidth).toBeGreaterThanOrEqual(44);
  expect(page.tapHitsRetry).toBe(true);
  expect(page.overflow).toBe(0);
});

it("propose le retour à l'accueil seulement au retour du réseau, sans navigation automatique", async () => {
  await setNetwork(true);
  await browser.render(html, 390, true);
  expect(await browser.evaluate<Measurement>(SCRIPT).then((page) => page.homeHidden)).toBe(true);

  await setNetwork(false);
  await browser.evaluate("window.dispatchEvent(new Event('online')); true");
  const page = await browser.evaluate<Measurement>(SCRIPT);
  expect(page.dataOnline).toBe("true");
  expect(page.homeHidden).toBe(false);
  expect(page.status).toContain("Connexion retrouvée");
  // Aucune navigation déclenchée par le retour du réseau.
  expect(page.location).not.toBe("/");
});
