import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Audit du 23/11/2026 : des anglicismes restaient dans les textes affichés aux joueurs (« Level up ! », « deadline »). Garde sur le
 * code source : aucun littéral de chaîne ne les contient. Les commentaires et les identifiants (`deadline` sans guillemets) sont ignorés.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function stringLiterals(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  return [...noComments.matchAll(/"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
}

describe("vocabulaire visible : pas d'anglicisme dans les textes affichés", () => {
  const files = sources("src");
  it("aucun littéral ne contient « Level up »", () => {
    const hits = files.flatMap((f) => stringLiterals(readFileSync(f, "utf8")).filter((s) => /\blevel up\b/i.test(s)).map((s) => `${f} : ${s.slice(0, 60)}`));
    expect(hits).toEqual([]);
  });
  it("aucune phrase ne dit « deadline » (« date limite » ou « fin des votes »)", () => {
    const hits = files.flatMap((f) => stringLiterals(readFileSync(f, "utf8")).filter((s) => /[ ’'](deadline)[ s.,!?’']/i.test(` ${s} `) && s.includes(" ")).map((s) => `${f} : ${s.slice(0, 60)}`));
    expect(hits).toEqual([]);
  });
  it("le formulaire de tournoi ne pré-coche personne dans « Qui prévenir ? »", () => {
    const form = readFileSync("src/components/tournois/TournamentCreateForm.tsx", "utf8");
    expect(form).toMatch(/Qui prévenir de l'ouverture des inscriptions \?" defaultSelection="none"/);
  });
});
