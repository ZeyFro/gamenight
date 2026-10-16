import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSessionRsvpId, sessionRsvpComponents } from "./session-rsvp-components";
import { wallClockNow } from "./wallclock";

describe("boutons de présence Discord", () => {
  beforeEach(() => { vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32)); vi.stubEnv("DISCORD_CLIENT_ID", "555"); });
  afterEach(() => vi.unstubAllEnvs());
  const session = () => ({ id: "s", status: "SCHEDULED", attendanceCapacity: 2, date: new Date(wallClockNow().getTime() + 86_400_000) });
  it("deux boutons classiques, sans identité utilisateur dans l'id", () => {
    const buttons = sessionRsvpComponents(session())[0].components;
    expect(buttons.map(button => button.label)).toEqual(["Je viens", "Je viens pas"]);
    expect(buttons.map(button => parseSessionRsvpId(button.custom_id))).toEqual([{ kind: "join", sessionId: "s" }, { kind: "leave", sessionId: "s" }]);
    expect(buttons.every(button => button.custom_id.length <= 100)).toBe(true);
  });
  it("boutons aussi sans limite de places; aucun pendant le vote, après début/fin/annulation", () => {
    for (const status of ["VOTING", "DONE", "CANCELLED"]) expect(sessionRsvpComponents({ ...session(), status })).toEqual([]);
    expect(sessionRsvpComponents({ ...session(), attendanceCapacity: null })[0].components.map(button => button.label)).toEqual(["Je viens", "Je viens pas"]);
    expect(sessionRsvpComponents({ ...session(), date: new Date(0) })).toEqual([]);
  });
  it("endpoint non configuré : ne propose aucun bouton inutilisable", () => {
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", ""); expect(sessionRsvpComponents(session())).toEqual([]);
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab"); vi.stubEnv("DISCORD_CLIENT_ID", ""); expect(sessionRsvpComponents(session())).toEqual([]);
  });
  it("refuse les ids ou opérations non prévus et les ids trop longs", () => {
    for (const value of ["gn:seat:capacity:s", "gn:seat:join:", "gn:seat:join:s:other", "gn:seat:join:../s", `gn:seat:join:${"s".repeat(65)}`]) expect(parseSessionRsvpId(value)).toBeNull();
  });
});
