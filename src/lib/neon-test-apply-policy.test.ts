import { describe, expect, it } from "vitest";
import { authorize, checkHistory, sequence } from "../../scripts/neon-test/apply-policy.mjs";
const base = { first: "a", second: "b" };
const rows = () => Object.entries(base).map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: "done", rolled_back_at: null }));
describe("application Neon Test fermée par défaut", () => {
  it("autorise seulement la validation sans accord d'application", () => {
    expect(() => authorize({ operation: "validate", ref: "refs/heads/main" })).not.toThrow();
    expect(() => authorize({ operation: "apply", ref: "refs/heads/main" })).toThrow();
  });
  it("refuse une autre branche ou une opération inconnue", () => {
    expect(() => authorize({ operation: "validate", ref: "refs/heads/other" })).toThrow();
    expect(() => authorize({ operation: "other", ref: "refs/heads/main" })).toThrow();
  });
  it("refuse une autorisation sans preuve de restauration", () => {
    expect(() => authorize({ operation: "apply", ref: "refs/heads/main", activation: "370-406-test-only", confirmation: "APPLY-370-406-ON-TEST" })).toThrow();
  });
  it("accepte l'historique exact avec ses checksums", () => expect(() => checkHistory(rows(), base)).not.toThrow());
  it.each(["extra", "checksum", "unfinished", "rolledback", "duplicate"])("refuse l'historique %s", variant => {
    const data = rows();
    if (variant === "extra") data.push({ ...data[0], migration_name: "third" });
    if (variant === "checksum") data[0].checksum = "changed";
    if (variant === "unfinished") data[0].finished_at = "";
    if (variant === "rolledback") data[0].rolled_back_at = "rollback" as never;
    if (variant === "duplicate") data[1] = data[0];
    expect(() => checkHistory(data, base)).toThrow();
  });
  it("applique chaque migration seule avec contrôle avant et après", async () => {
    const events: string[] = [];
    await sequence("apply", { check: async (n: number) => { events.push("check" + n); }, run: async (n: number, execute: boolean) => { events.push((execute ? "apply" : "dry") + n); }, addSecond: async () => { events.push("add120"); } });
    expect(events).toEqual(["check118", "dry119", "check118", "apply119", "check119", "add120", "dry120", "check119", "apply120", "check120"]);
  });
  it("n'ajoute jamais #406 si le contrôle après #370 échoue", async () => {
    const events: string[] = [];
    await expect(sequence("apply", { check: async (n: number) => { if (n === 119) throw Error("integrity"); }, run: async (n: number) => { events.push("run" + n); }, addSecond: async () => { events.push("add120"); } })).rejects.toThrow();
    expect(events).not.toContain("add120");
    expect(events).not.toContain("run120");
  });
  it("la validation seule ne fait aucun execute ni ajout de #406", async () => {
    const events: string[] = [];
    await sequence("validate", { check: async () => {}, run: async (_: number, execute: boolean) => { events.push(String(execute)); }, addSecond: async () => { events.push("add"); } });
    expect(events).toEqual(["false"]);
  });
});
