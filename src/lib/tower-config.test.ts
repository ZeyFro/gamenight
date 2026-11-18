import { describe, expect, it } from "vitest";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";

const GUILD = "553922938101825536";
const OWNER = "699223334046531636";

describe("towerGuildId", () => {
  it("retrouve la valeur historique sans variable, vide ou malformée (comportement inchangé)", () => {
    for (const value of [undefined, "", "   ", "abc", "123", "55392293810182553x", "5539229381018255360000"]) {
      expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: value }), String(value)).toBe(GUILD);
    }
  });

  it("suit TOWER_DISCORD_GUILD_ID quand elle contient un identifiant Discord valide", () => {
    expect(towerGuildId({ TOWER_DISCORD_GUILD_ID: " 123456789012345678 " })).toBe("123456789012345678");
  });
});

describe("isTowerOwner (garde d'accès : fail-closed)", () => {
  it("accepte uniquement le propriétaire", () => {
    expect(isTowerOwner(OWNER)).toBe(true);
  });

  it("refuse tout autre compte, y compris vide ou absent", () => {
    for (const value of [undefined, null, "", " ", GUILD, `${OWNER} `, ` ${OWNER}`, "699223334046531637"]) {
      expect(isTowerOwner(value), String(value)).toBe(false);
    }
  });

  it("n'est pas élargi par ADMIN_DISCORD_IDS ni par une variable d'environnement", () => {
    const previous = process.env.ADMIN_DISCORD_IDS;
    process.env.ADMIN_DISCORD_IDS = "111111111111111111,222222222222222222";
    try {
      expect(isTowerOwner("111111111111111111")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_DISCORD_IDS;
      else process.env.ADMIN_DISCORD_IDS = previous;
    }
  });
});
