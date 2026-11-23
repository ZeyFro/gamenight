// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushSettings } from "./WebPushSettings";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const getRegistration = vi.fn();
const register = vi.fn();

function browser({ ua = DESKTOP, standalone = false, push = true, subscription = null as unknown, permission = "default" as NotificationPermission } = {}) {
  vi.stubGlobal("navigator", { userAgent: ua, platform: "Win32", maxTouchPoints: 0, standalone, serviceWorker: { getRegistration, register } });
  if (push) vi.stubGlobal("PushManager", class {}); else delete (window as unknown as Record<string, unknown>).PushManager;
  vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission, requestPermission: vi.fn(async () => permission) }));
  getRegistration.mockResolvedValue({ pushManager: { getSubscription: async () => subscription } });
  register.mockResolvedValue({ pushManager: { getSubscription: async () => subscription, subscribe: vi.fn() } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WebPushSettings : iPhone et navigateurs sans push", () => {
  it("iPhone hors écran d'accueil : le guide remplace le bouton", () => {
    browser({ ua: IPHONE, push: false });
    render(<WebPushSettings publicKey="AAAA" />);
    expect(screen.getByText("Pour recevoir les notifications sur iPhone")).toBeTruthy();
    expect(screen.getByText(/Sur l’écran d’accueil/)).toBeTruthy();
    expect(screen.getByText("Il faut iOS 16.4 ou plus récent.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("iPhone avec l'application installée : le bouton est là, pas de guide", () => {
    browser({ ua: IPHONE, standalone: true });
    render(<WebPushSettings publicKey="AAAA" />);
    expect(screen.getByRole("button", { name: "Activer sur cet appareil" })).toBeTruthy();
    expect(screen.queryByText("Pour recevoir les notifications sur iPhone")).toBeNull();
  });
  it("PushManager absent hors iOS : message clair, pas de bouton", () => {
    browser({ push: false });
    render(<WebPushSettings publicKey="AAAA" />);
    expect(screen.getByText("Cet appareil ou ce navigateur ne prend pas en charge les notifications.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("permission refusée : explique où l'autoriser", async () => {
    browser({ permission: "denied" });
    render(<WebPushSettings publicKey="AAAA" />);
    await userEvent.click(screen.getByRole("button", { name: "Activer sur cet appareil" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Réglages, Notifications, GameNight/));
  });
});

describe("WebPushSettings : abonnement existant (constat 2.4)", () => {
  it("cherche le service worker sous /service-worker.js et affiche « Désactiver » après un rechargement", async () => {
    browser({ subscription: { endpoint: "https://push.example/abc" } });
    render(<WebPushSettings publicKey="AAAA" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Désactiver sur cet appareil" })).toBeTruthy());
    expect(getRegistration).toHaveBeenCalledWith("/service-worker.js");
  });
  it("sans clé publique : aucun guide ni bouton, seulement le message administrateur", () => {
    browser({ ua: IPHONE, push: false });
    render(<WebPushSettings publicKey={null} />);
    expect(screen.queryByText("Pour recevoir les notifications sur iPhone")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/désactivées par l’administrateur/)).toBeTruthy();
  });
});
