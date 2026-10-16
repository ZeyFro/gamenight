import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTournamentRsvpId, tournamentRsvpComponents } from "@/lib/tournament-rsvp-components";

describe("tournament Discord RSVP components", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows the registration button only for configured open tournaments", () => {
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "a".repeat(64));
    vi.stubEnv("DISCORD_CLIENT_ID", "123456");
    expect(tournamentRsvpComponents("tour_1", true)[0].components[0].custom_id).toBe("gn:tournament:join:tour_1");
    expect(tournamentRsvpComponents("tour_1", false)).toEqual([]);
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "");
    expect(tournamentRsvpComponents("tour_1", true)).toEqual([]);
  });

  it("parses only the bounded join action", () => {
    expect(parseTournamentRsvpId("gn:tournament:join:tour_1")).toEqual({ tournamentId: "tour_1" });
    expect(parseTournamentRsvpId("gn:tournament:leave:tour_1")).toBeNull();
    expect(parseTournamentRsvpId(`gn:tournament:join:${"x".repeat(65)}`)).toBeNull();
  });
});
