import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Client Prisma scopé par communauté (PR7). Les règles vivent dans la fonction
 * pure `scopeQueryArgs` (testée ici sans base) ; le câblage `$extends` est
 * couvert par le test d'intégration Postgres.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/community-isolation", async () => {
  const actual = await vi.importActual<typeof import("./community-isolation")>("./community-isolation");
  return { ...actual, getIsolationScope: vi.fn() };
});

import { COMMUNITY_SCOPED_MODELS, CommunityScopeError, scopeQueryArgs } from "./community-scoped-client";

const SCOPE = { communityIds: ["c1", "c2"], includesDefault: false };
const SCOPE_DEFAULT = { communityIds: ["c1"], includesDefault: true };
const EMPTY = { communityIds: [], includesDefault: false };
const FILTER = { OR: [{ communityId: { in: ["c1", "c2"] } }] };

describe("COMMUNITY_SCOPED_MODELS ↔ schema.prisma", () => {
  it("contient exactement les modèles qui portent `communityId` (hors Membership et salons)", () => {
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    const withColumn = [...schema.matchAll(/^model (\w+) \{\r?\n([\s\S]*?)^\}/gm)]
      .filter(([, name, body]) => /^\s+communityId\s+String\?/m.test(body) && !/^(Membership|CommunityChannelConfig)$/.test(name))
      .map(([, name]) => name)
      .sort();
    expect([...COMMUNITY_SCOPED_MODELS].sort()).toEqual(withColumn);
  });
});

describe("scopeQueryArgs — isolation éteinte ou modèle non scopé", () => {
  it("scope null : arguments inchangés (même référence), toute opération", () => {
    const args = { where: { id: "x" } };
    expect(scopeQueryArgs("Session", "findMany", args, null)).toBe(args);
    expect(scopeQueryArgs("Session", "create", { data: {} }, null)).toEqual({ data: {} });
    expect(scopeQueryArgs("Session", "findRaw", undefined, null)).toBeUndefined();
  });

  it("modèle sans `communityId` (User, Game, Membership…) : inchangé même avec un scope", () => {
    const args = { where: { id: "x" } };
    expect(scopeQueryArgs("User", "findMany", args, SCOPE)).toBe(args);
    expect(scopeQueryArgs("Game", "delete", args, SCOPE)).toBe(args);
  });
});

describe("scopeQueryArgs — lectures et écritures filtrées", () => {
  it.each([
    "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate",
    "groupBy", "updateMany", "deleteMany", "delete",
  ])("%s : le filtre est ajouté dans AND, sans toucher au where d'origine", (operation) => {
    const out = scopeQueryArgs("ChatMessage", operation, { where: { id: "m1" } }, SCOPE);
    expect(out).toEqual({ where: { id: "m1", AND: [FILTER] } });
  });

  it("sans where : un where ne contenant que le filtre", () => {
    expect(scopeQueryArgs("Debt", "findMany", undefined, SCOPE)).toEqual({ where: { AND: [FILTER] } });
    expect(scopeQueryArgs("Debt", "count", {}, SCOPE)).toEqual({ where: { AND: [FILTER] } });
  });

  it("conserve un AND existant (objet ou tableau) et un OR d'origine", () => {
    expect(scopeQueryArgs("Debt", "findMany", { where: { AND: { a: 1 }, OR: [{ b: 2 }] } }, SCOPE)).toEqual({
      where: { AND: [{ a: 1 }, FILTER], OR: [{ b: 2 }] },
    });
    expect(scopeQueryArgs("Debt", "findMany", { where: { AND: [{ a: 1 }] } }, SCOPE)).toEqual({
      where: { AND: [{ a: 1 }, FILTER] },
    });
  });

  it("ne mute pas les arguments de l'appelant", () => {
    const args = { where: { id: "m1" } };
    scopeQueryArgs("Debt", "findMany", args, SCOPE);
    expect(args).toEqual({ where: { id: "m1" } });
  });

  it("autres arguments (select, orderBy, take…) transmis tels quels", () => {
    const out = scopeQueryArgs("Roulette", "findMany", { select: { id: true }, orderBy: { id: "asc" }, take: 3 }, SCOPE);
    expect(out).toMatchObject({ select: { id: true }, orderBy: { id: "asc" }, take: 3 });
  });

  it("communauté par défaut dans le périmètre : les lignes `communityId = null` sont visibles", () => {
    expect(scopeQueryArgs("Debt", "findMany", {}, SCOPE_DEFAULT)).toEqual({
      where: { AND: [{ OR: [{ communityId: { in: ["c1"] } }, { communityId: null }] }] },
    });
  });

  it("périmètre vide : filtre `in: []` (rien de visible), jamais un filtre vide", () => {
    expect(scopeQueryArgs("Debt", "findMany", {}, EMPTY)).toEqual({
      where: { AND: [{ OR: [{ communityId: { in: [] } }] }] },
    });
  });

  it("upsert : where filtré ET create validé", () => {
    const out = scopeQueryArgs(
      "GameWishlist",
      "upsert",
      { where: { gameId: "g" }, create: { gameId: "g", communityId: "c1" }, update: { note: "x" } },
      SCOPE
    );
    expect(out).toMatchObject({ where: { gameId: "g", AND: [FILTER] }, create: { communityId: "c1" } });
  });
});

describe("scopeQueryArgs — créations", () => {
  it("communauté du périmètre : acceptée, arguments inchangés", () => {
    const args = { data: { text: "yo", communityId: "c2" } };
    expect(scopeQueryArgs("ChatMessage", "create", args, SCOPE)).toEqual(args);
  });

  it.each(["create", "createMany", "createManyAndReturn"])("%s sans communityId : refusé", (operation) => {
    const data = operation === "create" ? { text: "yo" } : [{ text: "yo", communityId: "c1" }, { text: "oups" }];
    expect(() => scopeQueryArgs("ChatMessage", operation, { data }, SCOPE)).toThrow(CommunityScopeError);
  });

  it("communauté étrangère : refusée (une seule ligne hors périmètre fait échouer le lot)", () => {
    expect(() => scopeQueryArgs("Debt", "create", { data: { communityId: "autre" } }, SCOPE)).toThrow(/hors du périmètre/);
    expect(() =>
      scopeQueryArgs("Debt", "createMany", { data: [{ communityId: "c1" }, { communityId: "autre" }] }, SCOPE)
    ).toThrow(CommunityScopeError);
  });

  it("`communityId: null` : seulement si la communauté par défaut est dans le périmètre", () => {
    expect(() => scopeQueryArgs("Debt", "create", { data: { communityId: null } }, SCOPE)).toThrow(CommunityScopeError);
    expect(scopeQueryArgs("Debt", "create", { data: { communityId: null } }, SCOPE_DEFAULT)).toEqual({
      data: { communityId: null },
    });
  });

  it("périmètre vide : toute création refusée", () => {
    expect(() => scopeQueryArgs("Debt", "create", { data: { communityId: "c1" } }, EMPTY)).toThrow(CommunityScopeError);
  });

  it("la relation `community: { connect }` ne contourne pas la règle", () => {
    expect(() =>
      scopeQueryArgs("Debt", "create", { data: { community: { connect: { id: "autre" } }, communityId: "c1" } }, SCOPE)
    ).toThrow(/scalaire/);
    expect(() =>
      scopeQueryArgs("Debt", "create", { data: { community: { connect: { id: "c1" } } } }, SCOPE)
    ).toThrow(CommunityScopeError);
  });
});

describe("scopeQueryArgs — une ligne ne change pas de communauté", () => {
  it.each(["update", "updateMany", "updateManyAndReturn"])("%s avec communityId ou community dans data : refusé", (operation) => {
    expect(() => scopeQueryArgs("Debt", operation, { where: {}, data: { communityId: "c2" } }, SCOPE)).toThrow(
      CommunityScopeError
    );
    expect(() =>
      scopeQueryArgs("Debt", operation, { where: {}, data: { community: { connect: { id: "c2" } } } }, SCOPE)
    ).toThrow(CommunityScopeError);
  });

  it("update sans communityId : filtré normalement", () => {
    expect(scopeQueryArgs("Debt", "update", { where: { id: "d" }, data: { paid: true } }, SCOPE)).toEqual({
      where: { id: "d", AND: [FILTER] },
      data: { paid: true },
    });
  });

  it("upsert : update avec communityId refusé", () => {
    expect(() =>
      scopeQueryArgs(
        "Debt",
        "upsert",
        { where: { id: "d" }, create: { communityId: "c1" }, update: { communityId: "c2" } },
        SCOPE
      )
    ).toThrow(CommunityScopeError);
  });
});

describe("scopeQueryArgs — fail-closed", () => {
  it("opération inconnue sur un modèle scopé : refusée", () => {
    expect(() => scopeQueryArgs("Session", "findRaw", {}, SCOPE)).toThrow(/non prise en charge/);
  });
});
