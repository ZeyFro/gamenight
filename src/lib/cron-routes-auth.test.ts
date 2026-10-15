import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : toute route `/api/cron/*` et `/api/backfill/*` doit passer par
 * `verifyCronRequest` / `checkCronAuth` (`src/lib/cron-auth.ts`), fail-closed
 * (503 sans `CRON_SECRET`), et l'appeler AVANT tout traitement. Une nouvelle
 * route copiée sans ce contrôle serait publique sans qu'aucun autre test
 * (tsc, lint, build) ne le voie.
 */

const ROOTS = ["src/app/api/cron", "src/app/api/backfill"];

function routeFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name, "route.ts").replaceAll("\\", "/"))
  );
}

/**
 * Code exécuté dans le handler AVANT le premier contrôle d'accès (hors
 * commentaires). Tout `await`, accès base, `after()` ou `fetch` à cet endroit
 * traiterait une requête non authentifiée. Heuristique : le handler est
 * supposé commencer à la dernière déclaration `function` avant l'appel.
 */
function workBeforeAuth(src: string): string | null {
  const call = /\b(?:verifyCronRequest|checkCronAuth)\(/.exec(src);
  if (!call) return "aucun appel";
  const head = src.slice(0, call.index);
  const start = Math.max(head.lastIndexOf("function "), 0);
  const code = head.slice(start).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  return /\bawait\b|\bprisma\b|\bafter\(|\bfetch\(/.exec(code)?.[0] ?? null;
}

describe("workBeforeAuth (analyse)", () => {
  const ok = "async function handle(r: Request) {\n  // await prisma\n  logger.info('x');\n  const auth = verifyCronRequest(r);\n  await prisma.x();\n}";
  it("accepte un appel en tête du handler (commentaires ignorés)", () => {
    expect(workBeforeAuth(ok)).toBeNull();
  });
  it("détecte un traitement avant le contrôle", () => {
    const bad = "async function handle(r: Request) {\n  await prisma.x();\n  const auth = verifyCronRequest(r);\n}";
    expect(workBeforeAuth(bad)).toBe("await");
    expect(workBeforeAuth("function h(r){ after(() => 1); checkCronAuth(r); }")).toBe("after(");
  });
});

describe("routes cron et backfill", () => {
  const files = routeFiles();

  it("en trouve au moins une par dossier", () => {
    expect(files.length).toBeGreaterThanOrEqual(ROOTS.length);
  });

  it.each(files)("%s vérifie l'accès via cron-auth", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/from\s+["']@\/lib\/cron-auth["']/);
    const call = /\b(?:verifyCronRequest|checkCronAuth)\(/.exec(src);
    expect(call, `${file} n'appelle pas verifyCronRequest/checkCronAuth`).not.toBeNull();
  });

  it.each(files)("%s vérifie l'accès avant tout traitement", (file) => {
    expect(workBeforeAuth(readFileSync(file, "utf8")), file).toBeNull();
  });

  it.each(files)("%s ne lit pas CRON_SECRET à la main", (file) => {
    // La comparaison maison (===) est ce que cron-auth remplace : pas de timing-safe, pas de 503.
    expect(readFileSync(file, "utf8")).not.toMatch(/authorization["']\)\s*[!=]==/i);
  });
});
