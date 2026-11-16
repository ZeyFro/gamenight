import { describe, expect, it } from "vitest";
import {
  assignableByBot,
  canonicalRoleName,
  exactRoleMatches,
  isSensitiveRole,
  isSensitiveRoleName,
  normalizeRoleKey,
  planRoleGrant,
  profileTagName,
  queryKey,
  suggestRoleMatches,
  topRolePosition,
  type GuildRoleSummary,
} from "./discord-guild-roles";

const role = (id: string, name: string, position: number, extra: Partial<GuildRoleSummary> = {}): GuildRoleSummary => ({
  id,
  name,
  position,
  permissions: "0",
  managed: false,
  ...extra,
});

const ROLES: GuildRoleSummary[] = [
  role("1", "Deep Rock Galactic", 3),
  role("2", "The Legend of Zelda : Breath of the Wild", 4),
  role("3", "Admin", 9, { permissions: "8" }),
  role("4", "Bot Musique", 8, { managed: true }),
  role("5", "It Takes Two", 5),
  role("6", "@everyone", 0),
];

describe("normalisation des noms de rôle", () => {
  it("ignore casse, accents, ponctuation et espaces multiples", () => {
    expect(normalizeRoleKey("  Deep   Rock  Galactique ")).toBe("deep rock galactique");
    expect(normalizeRoleKey("Pokémon Écarlate")).toBe("pokemon ecarlate");
    expect(normalizeRoleKey("Zelda : Breath of the Wild")).toBe("zelda breath of the wild");
  });

  it("ignore le préfixe « jeu » pour comparer deux variantes", () => {
    expect(queryKey("Jeu Deep Rock")).toBe("deep rock");
    expect(exactRoleMatches(ROLES, "jeu deep rock galactic").map((r) => r.id)).toEqual(["1"]);
    expect(exactRoleMatches([role("7", "Jeu Deep Rock Galactic", 3)], "Deep Rock Galactic").map((r) => r.id)).toEqual(["7"]);
  });

  it("refuse une requête vide ou trop longue", () => {
    expect(queryKey("   ")).toBe("");
    expect(queryKey("a".repeat(61))).toBe("");
  });
});

describe("rôles techniques jamais attribués", () => {
  it("reconnaît les noms réservés", () => {
    for (const name of ["Admin", "Modérateur", "Le Staff", "Bot Musique", "Gérant", "Fondateur"]) {
      expect(isSensitiveRoleName(name), name).toBe(true);
    }
    expect(isSensitiveRoleName("Deep Rock Galactic")).toBe(false);
    expect(isSensitiveRoleName("The Legend of Zelda")).toBe(false);
  });

  it("reconnaît les permissions élevées, les rôles gérés et @everyone", () => {
    expect(isSensitiveRole(role("3", "Peu importe", 9, { permissions: "8" }))).toBe(true);
    expect(isSensitiveRole(role("3", "Peu importe", 9, { permissions: String(BigInt(1) << BigInt(28)) }))).toBe(true);
    expect(isSensitiveRole(role("4", "Jeu", 8, { managed: true }))).toBe(true);
    expect(isSensitiveRole(role("6", "@everyone", 0))).toBe(true);
    expect(isSensitiveRole(role("1", "Deep Rock Galactic", 3))).toBe(false);
  });

  it("ne suggère jamais un rôle technique", () => {
    const suggestions = suggestRoleMatches(ROLES, "admin");
    expect(suggestions).toEqual([]);
  });
});

describe("recherche et variantes", () => {
  it("propose les rôles proches sans les confondre avec une égalité", () => {
    expect(exactRoleMatches(ROLES, "zelda")).toEqual([]);
    expect(suggestRoleMatches(ROLES, "zelda").map((r) => r.name)).toEqual([
      "The Legend of Zelda : Breath of the Wild",
    ]);
  });

  it("trie les préfixes avant les inclusions", () => {
    const suggestions = suggestRoleMatches([role("a", "Rock Band", 2), role("b", "Deep Rock", 3)], "rock");
    expect(suggestions.map((r) => r.name)).toEqual(["Rock Band", "Deep Rock"]);
  });
});

describe("décision d'attribution", () => {
  const base = { roles: ROLES, botTopPosition: 7, canCreate: false, memberRoleIds: [] as string[] };

  it("attribue un rôle existant autorisé", () => {
    expect(planRoleGrant({ ...base, query: "deep rock galactic" })).toEqual({
      action: "assign",
      role: ROLES[0],
    });
  });

  it("ne réattribue pas un rôle déjà porté", () => {
    expect(planRoleGrant({ ...base, query: "Deep Rock Galactic", memberRoleIds: ["1"] })).toEqual({
      action: "already",
      role: ROLES[0],
    });
  });

  it("refuse un rôle au-dessus du rôle le plus haut du bot", () => {
    expect(planRoleGrant({ ...base, botTopPosition: 3, query: "It Takes Two" })).toEqual({
      action: "refuse",
      reason: "not_assignable",
      candidates: [],
    });
  });

  it("refuse les rôles sensibles même cités exactement", () => {
    expect(planRoleGrant({ ...base, query: "Admin" })).toMatchObject({ action: "refuse", reason: "sensitive" });
    expect(planRoleGrant({ ...base, query: "Bot Musique" })).toMatchObject({ action: "refuse", reason: "sensitive" });
  });

  it("propose les candidats au lieu de deviner", () => {
    const plan = planRoleGrant({ ...base, query: "zelda", canCreate: true });
    expect(plan).toMatchObject({ action: "refuse", reason: "ambiguous" });
    expect(plan.action === "refuse" && plan.candidates.map((r) => r.name)).toEqual([
      "The Legend of Zelda : Breath of the Wild",
    ]);
  });

  it("crée seulement si la création est permise et le plafond non atteint", () => {
    expect(planRoleGrant({ ...base, query: "Hades II", canCreate: true })).toEqual({ action: "create", name: "Hades II" });
    expect(planRoleGrant({ ...base, query: "Hades II", canCreate: false })).toMatchObject({
      action: "refuse",
      reason: "creation_forbidden",
    });
    expect(planRoleGrant({ ...base, query: "Hades II", canCreate: true, maxGuildRoles: ROLES.length })).toMatchObject({
      action: "refuse",
      reason: "guild_full",
    });
  });

  it("refuse un nom vide", () => {
    expect(planRoleGrant({ ...base, query: "  ", canCreate: true })).toMatchObject({ action: "refuse", reason: "invalid_name" });
  });
});

describe("hiérarchie et noms normalisés", () => {
  it("calcule le rôle le plus haut porté par le bot", () => {
    expect(topRolePosition(ROLES, ["1", "5"])).toBe(5);
    expect(topRolePosition(ROLES, [])).toBe(0);
  });

  it("n'attribue que les rôles strictement sous le rôle du bot", () => {
    expect(assignableByBot(role("1", "Jeu", 3), 4)).toBe(true);
    expect(assignableByBot(role("1", "Jeu", 4), 4)).toBe(false);
    expect(assignableByBot(role("1", "Jeu", 0), 4)).toBe(false);
  });

  it("borne le nom créé et le centre d'intérêt synchronisé", () => {
    expect(canonicalRoleName("  Deep   Rock  Galactic  ")).toBe("Deep Rock Galactic");
    expect(canonicalRoleName("x".repeat(140)).length).toBe(100);
    expect(profileTagName("y".repeat(140)).length).toBe(40);
  });
});
