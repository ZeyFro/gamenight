import { describe, expect, it } from "vitest";
import { BOT_CHANNEL_PERMISSIONS, channelPermissions, missingSetupPermissions } from "./discord-setup-permissions";

describe("permissions effectives du bot", () => {
  it("nomme précisément les permissions manquantes, y compris les bits de fils >32", () => {
    expect(missingSetupPermissions(BOT_CHANNEL_PERMISSIONS & ~(BigInt(1) << BigInt(36)))).toEqual(["Créer des fils privés"]);
    expect(missingSetupPermissions(BigInt(8))).toEqual([]);
  });
  it("combine les rôles puis applique l'overwrite du membre bot en dernier", () => {
    const result = channelPermissions(BOT_CHANNEL_PERMISSIONS, "111", "999", ["777", "888"], [
      { id: "111", type: 0, deny: "1024", allow: "0" },
      { id: "777", type: 0, deny: "2048", allow: "1024" },
      { id: "888", type: 0, deny: "0", allow: "2048" },
      { id: "999", type: 1, deny: String(BigInt(1) << BigInt(36)), allow: "0" },
      { id: "unrelated", type: 0, deny: "1024", allow: "0" },
    ]);
    expect(missingSetupPermissions(result)).toEqual(["Créer des fils privés"]);
  });
  it("Administrateur ignore les overwrites", () => {
    expect(channelPermissions(BigInt(8), "111", "999", [], [{ id: "999", type: 1, deny: BOT_CHANNEL_PERMISSIONS.toString(), allow: "0" }])).toBe(BigInt(8));
  });
});
