import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TONIGHT_MESSAGE_PREFIX,
  buildTonightMessage,
  groupTonightByGame,
  isTonightEnabled,
  isTonightMessage,
  parseTonightForm,
  tonightExpiresAt,
  tonightNote,
  tonightSessionWindow,
} from "./tonight-rules";

// Dates figées (horloge murale représentée en UTC, comme `wallClockNow`).
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 15, hour, minute));
const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};

describe("isTonightEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("OFF par défaut, ON seulement pour exactement \"true\"", () => {
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "");
    expect(isTonightEnabled()).toBe(false);
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "TRUE");
    expect(isTonightEnabled()).toBe(false);
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "true");
    expect(isTonightEnabled()).toBe(true);
  });
});

describe("tonightExpiresAt", () => {
  it("en soirée : le lendemain à 4 h", () => {
    expect(tonightExpiresAt(at(20, 30))).toEqual(new Date(Date.UTC(2026, 0, 16, 4)));
  });
  it("après minuit mais avant 4 h : le jour même à 4 h", () => {
    expect(tonightExpiresAt(at(1, 15))).toEqual(new Date(Date.UTC(2026, 0, 15, 4)));
  });
  it("à 4 h pile : le lendemain, jamais une échéance déjà passée", () => {
    expect(tonightExpiresAt(at(4))).toEqual(new Date(Date.UTC(2026, 0, 16, 4)));
  });
  it("toujours dans le futur et au plus 24 h plus tard", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = at(hour, 7);
      const delta = tonightExpiresAt(now).getTime() - now.getTime();
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
  it("change de mois correctement", () => {
    expect(tonightExpiresAt(new Date(Date.UTC(2026, 0, 31, 22)))).toEqual(new Date(Date.UTC(2026, 1, 1, 4)));
  });
});

describe("tonightSessionWindow", () => {
  it("inclut les soirées commencées depuis 3 h et s'arrête à la fin de la nuit", () => {
    expect(tonightSessionWindow(at(21))).toEqual({ from: at(18), to: new Date(Date.UTC(2026, 0, 16, 4)) });
  });
});

describe("parseTonightForm", () => {
  it("accepte 1 à 3 jeux, ignore les champs vides, note facultative", () => {
    const parsed = parseTonightForm(form([["gameId", "a"], ["gameId", ""], ["gameId", "b"], ["note", "  vers 21h "]]));
    expect(parsed.success && parsed.data).toEqual({ gameIds: ["a", "b"], note: "vers 21h" });
  });
  it("refuse aucun jeu, plus de 3 jeux et les doublons", () => {
    expect(parseTonightForm(form([])).success).toBe(false);
    expect(parseTonightForm(form([["gameId", "a"], ["gameId", "b"], ["gameId", "c"], ["gameId", "d"]])).success).toBe(false);
    expect(parseTonightForm(form([["gameId", "a"], ["gameId", "a"]])).success).toBe(false);
  });
  it("refuse une note trop longue pour tenir dans une annonce de 240 caractères", () => {
    expect(parseTonightForm(form([["gameId", "a"], ["note", "x".repeat(240)]])).success).toBe(false);
    const ok = parseTonightForm(form([["gameId", "a"], ["note", "x".repeat(200)]]));
    expect(ok.success && buildTonightMessage(ok.data.note).length).toBeLessThanOrEqual(240);
  });
});

describe("message et note", () => {
  it("préfixe reconnaissable, note relue sans le préfixe", () => {
    const message = buildTonightMessage("vers 21h");
    expect(message).toBe(`${TONIGHT_MESSAGE_PREFIX} — vers 21h`);
    expect(isTonightMessage(message)).toBe(true);
    expect(tonightNote(message)).toBe("vers 21h");
    expect(tonightNote(buildTonightMessage())).toBe("");
    expect(isTonightMessage("Il manque un quatrième")).toBe(false);
  });
});

describe("groupTonightByGame", () => {
  const listing = (game: string, id: string, message = buildTonightMessage()) => ({
    message,
    game: { name: game },
    createdBy: { id, discordName: id },
  });

  it("regroupe par jeu, plus demandés d'abord, ignore les annonces ordinaires et les doublons", () => {
    const groups = groupTonightByGame([
      listing("Valheim", "alice"),
      listing("Among Us", "bob"),
      listing("Among Us", "carol", buildTonightMessage("dès 22h")),
      listing("Among Us", "bob"),
      listing("Valheim", "dave", "Il manque un quatrième"),
    ]);
    expect(groups).toEqual([
      { game: "Among Us", players: [{ id: "bob", discordName: "bob", note: "" }, { id: "carol", discordName: "carol", note: "dès 22h" }] },
      { game: "Valheim", players: [{ id: "alice", discordName: "alice", note: "" }] },
    ]);
  });
});
