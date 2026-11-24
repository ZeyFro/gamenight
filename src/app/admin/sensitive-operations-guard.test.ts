import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SENSITIVE_OPERATIONS } from "@/lib/sensitive-operation-log";

/**
 * Cahier §19.1, C055 : « toute action d'administration qui écrit appelle `recordSensitiveOperation` » (liste fermée dans
 * `src/lib/sensitive-operation-log.ts`, lue sur `/admin/journal`). Même esprit que `admin-guards.test.ts` : une nouvelle action
 * d'administration oubliée du journal fait échouer ce test. Sont couverts : toutes les actions serveur de `src/app/admin/<onglet>/actions.ts`
 * et les gestionnaires POST/PUT/PATCH/DELETE de `src/app/api/admin/<route>/route.ts`. Une fonction est exemptée seulement si elle est
 * inerte (réponse 423 « suspendu », aucune écriture) et listée ci-dessous avec sa raison.
 */
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
const ACTION_FILES = files.filter((file) => /^src\/app\/admin\/[^/]+\/actions\.ts$/.test(file));
const ROUTE_FILES = files.filter((file) => /^src\/app\/api\/admin\/[^/]+\/route\.ts$/.test(file));

const INERT = new Set([
  "src/app/api/admin/tower-archive/route.ts#POST", // 423 : archivage suspendu, ne fait rien
  "src/app/api/admin/tower-layout/route.ts#POST", // 423 : réorganisation suspendue, ne fait rien
]);

function topLevelFunctions(source: string): { name: string; exported: boolean; body: string }[] {
  return source.split(/(?=^(?:export )?(?:async )?function )/m).flatMap((part) => {
    const match = part.match(/^(export )?(?:async )?function (\w+)/);
    return match ? [{ name: match[2], exported: Boolean(match[1]), body: part }] : [];
  });
}

/** La fonction journalise directement, ou appelle une fonction locale du même fichier qui journalise. */
function journals(fn: { body: string }, all: { name: string; body: string }[]): boolean {
  if (fn.body.includes("recordSensitiveOperation(")) return true;
  return all.some((other) => other.body.includes("recordSensitiveOperation(") && new RegExp(`\\b${other.name}\\(`).test(fn.body));
}

describe("journal des opérations sensibles : aucune action d'administration n'y échappe", () => {
  it("les fichiers d'actions et de routes d'administration sont bien trouvés", () => {
    expect(ACTION_FILES.length).toBeGreaterThanOrEqual(10);
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of ACTION_FILES) {
    it(`${file} : chaque action exportée journalise`, () => {
      const all = topLevelFunctions(readFileSync(file, "utf8"));
      const exported = all.filter((fn) => fn.exported);
      expect(exported.length).toBeGreaterThan(0);
      for (const fn of exported) expect(journals(fn, all), `${file} : ${fn.name} n'appelle pas recordSensitiveOperation`).toBe(true);
    });
  }

  for (const file of ROUTE_FILES) {
    it(`${file} : chaque méthode d'écriture journalise (ou est inerte et listée)`, () => {
      const all = topLevelFunctions(readFileSync(file, "utf8"));
      for (const fn of all.filter((candidate) => candidate.exported && /^(POST|PUT|PATCH|DELETE)$/.test(candidate.name))) {
        if (INERT.has(`${file}#${fn.name}`)) {
          expect(fn.body, `${file}#${fn.name} listée inerte mais écrit`).not.toMatch(/prisma\.|\$transaction|recordSensitiveOperation|trigger/);
          expect(fn.body).toContain("423");
          continue;
        }
        expect(journals(fn, all), `${file} : ${fn.name} n'appelle pas recordSensitiveOperation`).toBe(true);
      }
    });
  }

  it("la route de reconnexion forcée journalise le succès ET l'échec, sans acteur (secret dédié) ni texte libre", () => {
    const route = readFileSync("src/app/api/admin/force-relogin/route.ts", "utf8");
    expect(route).toContain('action: "auth.force_relogin", target: "route", outcome: "ok"');
    expect(route).toContain('action: "auth.force_relogin", target: "route", outcome: "server_error"');
  });

  it("la confirmation d'un participant par le capitaine (#580) est journalisée", () => {
    const source = readFileSync("src/lib/tower-challenges.ts", "utf8");
    expect(source).toContain('action: "tower.participant_confirm"');
  });

  it("chaque action de la liste fermée est utilisée quelque part dans le code (liste sans entrée morte)", () => {
    const code = files.filter((file) => /^src\/.*\.(ts|tsx)$/.test(file) && !/\.test\./.test(file) && file !== "src/lib/sensitive-operation-log.ts")
      .map((file) => readFileSync(file, "utf8")).join("\n");
    const unused = SENSITIVE_OPERATIONS.filter((action) => !code.includes(`"${action}"`));
    expect(unused).toEqual([]);
  });
});
