import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkHistory, checkHistoryWithDiagnostics, sequence } from "../../scripts/neon-test/apply-policy.mjs";

const names = [
  "20261026180000_community_teams",
  "20261026190000_session_community_team",
  "20261026210000_tower_levels_per_floor",
  "20261026220000_community_team_game_restrict",
  "20261028140000_tower_challenges",
  "20261028230000_tower_season_vote",
  "20261029061000_tower_team_challenges",
];
const baseline = JSON.parse(readFileSync(new URL("../../scripts/neon-test/baseline.json", import.meta.url), "utf8")) as Record<string, string>;
const sql = (name: string) => readFileSync(new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const crlf = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const entry = (name: string, checksum = digest(crlf(sql(name)))) => ({ migration_name: name, checksum, finished_at: "done", rolled_back_at: null as string | null });

describe("sept empreintes Tower historiques CRLF prouvées", () => {
  it.each(names)("reconnaît uniquement la variante scellée LF/CRLF de %s", name => {
    const expected = { [name]: baseline[name] };
    expect(digest(sql(name))).toBe(expected[name]);
    expect(() => checkHistory([entry(name, expected[name])], expected)).not.toThrow();
    expect(() => checkHistory([entry(name)], expected)).not.toThrow();
  });

  it("accepte les 118 lignes avec seulement les sept variantes et ne les réécrit pas", () => {
    const rows = Object.entries(baseline).map(([name, hash]) => entry(name, names.includes(name) ? digest(crlf(sql(name))) : hash));
    const before = JSON.stringify({ rows, baseline });
    expect(() => checkHistory(rows, baseline)).not.toThrow();
    expect(JSON.stringify({ rows, baseline })).toBe(before);
    expect(JSON.parse(readFileSync(new URL("../../scripts/neon-test/baseline.json", import.meta.url), "utf8"))).toEqual(baseline);
  });

  it("refuse une vraie modification du SQL même dans les sept migrations", () => {
    const name = names[0];
    expect(() => checkHistory([entry(name, digest(crlf(sql(name) + "\n-- SQL modifié\n")))], { [name]: baseline[name] })).toThrow("NEON_TEST_HISTORY_MISMATCH");
  });

  it("refuse d'utiliser l'empreinte CRLF d'une autre migration", () => {
    expect(() => checkHistory([entry(names[0], digest(crlf(sql(names[1]))))], { [names[0]]: baseline[names[0]] })).toThrow("NEON_TEST_HISTORY_MISMATCH");
  });

  it("refuse la variante connue lorsque la référence canonique attendue est altérée", () => {
    expect(() => checkHistory([entry(names[0])], { [names[0]]: "f".repeat(64) })).toThrow("NEON_TEST_HISTORY_MISMATCH");
  });

  it("ne généralise pas cette reconnaissance aux 111 autres migrations", () => {
    for (const name of Object.keys(baseline).filter(name => !names.includes(name))) {
      expect(digest(crlf(sql(name)))).not.toBe(baseline[name]);
      expect(() => checkHistory([entry(name)], { [name]: baseline[name] })).toThrow("NEON_TEST_HISTORY_MISMATCH");
    }
  });

  it.each(["20261104140000_tower_team_membership_policy", "20261105120000_tower_launch_channels_appeals_matchmaking", "20261106150000_tower_fixed_arbiter"])("ne crée aucune exception pour %s", name => {
    expect(() => checkHistory([entry(names[0], "b".repeat(64))].map(r => ({ ...r, migration_name: name })), { [name]: "a".repeat(64) })).toThrow("NEON_TEST_HISTORY_MISMATCH");
  });

  it.each(["missing", "duplicate", "unfinished", "rolled_back", "unexpected"])("conserve le refus %s avec un checksum CRLF valide", variant => {
    const row = entry(names[0]);
    if (variant === "unfinished") row.finished_at = "";
    if (variant === "rolled_back") row.rolled_back_at = "rollback";
    if (variant === "unexpected") row.migration_name = "20260101000000_unknown";
    const rows = variant === "missing" ? [] : variant === "duplicate" ? [row, row] : [row];
    expect(() => checkHistory(rows, { [names[0]]: baseline[names[0]] })).toThrow(/^NEON_TEST_HISTORY_/);
  });

  it("ne signale pas un faux défaut checksum lorsque seul le statut est invalide", () => {
    const reports: Array<{ details: Array<{ reasons: string[] }> }> = [];
    expect(() => checkHistoryWithDiagnostics([{ ...entry(names[0]), rolled_back_at: "rollback" }], { [names[0]]: baseline[names[0]] }, (r: (typeof reports)[number]) => reports.push(r))).toThrow("NEON_TEST_HISTORY_MISMATCH");
    expect(reports[0].details[0].reasons).toEqual(["rolled_back"]);
  });

  it("arrête toujours validate avant le runner pour un SQL réellement divergent", async () => {
    const events: string[] = [];
    await expect(sequence("validate", {
      check: async () => checkHistory([entry(names[0], "b".repeat(64))], { [names[0]]: baseline[names[0]] }),
      run: async () => { events.push("run"); },
      addSecond: async () => { events.push("addSecond"); },
    })).rejects.toThrow("NEON_TEST_HISTORY_MISMATCH");
    expect(events).toEqual([]);
  });
});
