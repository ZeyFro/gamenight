import { afterEach, describe, expect, it, vi } from "vitest";
import { instantSessionRsvpComponents, parseInstantSessionRsvpId } from "@/lib/instant-session-rsvp-components";

describe("instant session Discord RSVP components", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders join and leave controls only when signed interactions are configured", () => {
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "a".repeat(64));
    vi.stubEnv("DISCORD_CLIENT_ID", "123456");
    expect(instantSessionRsvpComponents("session_1")[0].components.map(button => button.custom_id)).toEqual([
      "gn:instant:join:session_1", "gn:instant:leave:session_1",
    ]);
    vi.stubEnv("DISCORD_CLIENT_ID", "");
    expect(instantSessionRsvpComponents("session_1")).toEqual([]);
  });

  it("parses only bounded join/leave IDs", () => {
    expect(parseInstantSessionRsvpId("gn:instant:join:session_1")).toEqual({ kind: "join", sessionId: "session_1" });
    expect(parseInstantSessionRsvpId("gn:instant:delete:session_1")).toBeNull();
    expect(parseInstantSessionRsvpId(`gn:instant:join:${"x".repeat(65)}`)).toBeNull();
  });
});
