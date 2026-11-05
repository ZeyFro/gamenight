import { describe, expect, it } from "vitest";
import { healthFlagStates } from "./admin-health-summary";
describe("admin health flags", () => {
  it("returns only on/off states, never environment values", () => {
    const secret = "private-cookie-token-email@example.com";
    const result = healthFlagStates({
      TOWER_CHALLENGES_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: secret,
    });
    expect(result.find(x => x.name === "TOWER_CHALLENGES_ENABLED")?.enabled).toBe(true);
    expect(result.find(x => x.name === "NOTIFICATION_EXECUTOR_ENABLED")?.enabled).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
