import { describe, expect, it } from "vitest";
import { assertExpectedPending, RefusalError } from "./db-migrate-lib.mjs";

const migration325 = "20261019190000_separate_xp_balance";
const migration370 = "20261104140000_tower_team_membership_policy";
const migration406 = "20261105120000_tower_launch_channels_appeals_matchmaking";

describe("db-migrate : ordre chronologique", () => {
  it("refuse une migration ancienne ajoutée après une plus récente déjà appliquée", () => {
    const pending = [migration325];
    expect(() => assertExpectedPending({
      absentFromCheckout: [],
      inProgress: [],
      pending,
      finished: [migration370, migration406],
    }, pending)).toThrow(/Migration ancienne ajoutée hors ordre/);
  });

  it("accepte les migrations en attente sur une base sans migration terminée", () => {
    const pending = [migration325];
    expect(assertExpectedPending({
      absentFromCheckout: [],
      inProgress: [],
      pending,
      finished: [],
    }, pending)).toEqual(pending);
  });

  it("accepte les migrations plus récentes après les migrations antérieures appliquées", () => {
    const pending = [migration370, migration406];
    expect(assertExpectedPending({
      absentFromCheckout: [],
      inProgress: [],
      pending,
      finished: [migration325],
    }, pending)).toEqual(pending);
  });

  it("continue de refuser une liste --expect dans le mauvais ordre", () => {
    const pending = [migration370, migration406];
    expect(() => assertExpectedPending({
      absentFromCheckout: [],
      inProgress: [],
      pending,
      finished: [],
    }, [...pending].reverse())).toThrow(/Ordre de --expect/);
  });

  it("continue de refuser une migration inachevée", () => {
    expect(() => assertExpectedPending({
      absentFromCheckout: [],
      inProgress: [migration370],
      pending: [migration406],
      finished: [],
    }, [migration406])).toThrow(/inachevée ou en échec/);
  });

  it("expose le refus comme un échec de précontrôle", () => {
    try {
      assertExpectedPending({
        absentFromCheckout: [],
        inProgress: [],
        pending: [migration325],
        finished: [migration370],
      }, [migration325]);
      throw new Error("Expected out-of-order migration to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(RefusalError);
      expect(error.exitCode).toBe(2);
    }
  });
});
