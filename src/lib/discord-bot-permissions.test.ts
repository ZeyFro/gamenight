import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { botGuildPermissions, GAMENIGHT_BOT_PERMISSION_MASK, MENTION_EVERYONE_BIT, missingBotPermissions } from "./discord-bot-permissions";

const MENTION_EVERYONE = BigInt(1) << MENTION_EVERYONE_BIT;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("permissions du bot GameNight", () => {
  it("le masque d'invitation garde « Mentionner @everyone, @here et tous les rôles » (rôles du serveur non mentionnables)", () => {
    expect(GAMENIGHT_BOT_PERMISSION_MASK).toBe(BigInt("395408788496"));
    expect(GAMENIGHT_BOT_PERMISSION_MASK & MENTION_EVERYONE).toBe(MENTION_EVERYONE);
    expect(GAMENIGHT_BOT_PERMISSION_MASK & BigInt(8)).toBe(BigInt(0)); // jamais Administrateur
  });

  it("la documentation donne le même masque", () => {
    for (const doc of ["docs/PERMISSIONS_BOTS.md", "docs/PHASE_TEST.md"]) {
      expect(readFileSync(doc, "utf8"), doc).toContain(GAMENIGHT_BOT_PERMISSION_MASK.toString());
    }
  });

  it("signale l'absence du droit de mention ; Administrateur couvre tout", () => {
    const withoutMention = GAMENIGHT_BOT_PERMISSION_MASK & ~MENTION_EVERYONE;
    expect(missingBotPermissions(withoutMention)).toEqual(["Mentionner @everyone, @here et tous les rôles"]);
    expect(missingBotPermissions(GAMENIGHT_BOT_PERMISSION_MASK)).toEqual([]);
    expect(missingBotPermissions(BigInt(8))).toEqual([]);
  });

  it("cumule @everyone et les rôles du bot, ignore les autres", () => {
    const roles = [{ id: "g", permissions: "1024" }, { id: "bot", permissions: "131072" }, { id: "autre", permissions: "8" }, { id: "x", permissions: "??" }];
    expect(botGuildPermissions("g", ["bot", "x"], roles)).toBe(BigInt(1024 + 131072));
  });

  it("les seuls pings de rôle possibles passent par buildGameRolePing (notification-policy.ts), jamais @everyone/@here", () => {
    const offenders = sources("src").filter(file => {
      if (file.endsWith("notification-policy.ts")) return false;
      const text = readFileSync(file, "utf8");
      return /<@&\$\{/.test(text) || /parse:\s*\[[^\]]*["']everyone["']/.test(text);
    });
    expect(offenders, `mention de rôle ou @everyone hors notification-policy.ts : ${offenders.join(", ")}`).toEqual([]);
  });
});
