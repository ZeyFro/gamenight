import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde « aucune migration implicite » : le build (Vercel Preview comme Production)
 * ne doit JAMAIS migrer la base. Les migrations sont une opération explicite
 * (scripts/db-migrate.mjs, après sauvegarde et accord), jamais un effet de bord de
 * `next build`, de `postinstall` ou d'un réglage `vercel.json`.
 *
 * Ce test vivait dans scripts/build.test.ts, que Vitest n'incluait pas
 * (`include: src/**`) : il ne s'exécutait donc nulle part, ni en local ni en CI.
 * Il est ici sous src/ pour être réellement exécuté. Le comportement est conservé,
 * avec des cas négatifs qui prouvent que la garde échoue quand la protection saute.
 */

const read = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

const MIGRATING = /migrate|db\s+push|db\s+execute|\bdeploy\b/i;

/** Contenu de `const steps = [...]` dans scripts/build.mjs, ou undefined. */
function buildSteps(source: string): string | undefined {
  return source.match(/const steps = \[([\s\S]*?)\];/)?.[1];
}

/** Problèmes de la liste d'étapes du build (vide = conforme). */
function buildStepProblems(source: string): string[] {
  const steps = buildSteps(source);
  if (steps === undefined) return ["liste `const steps = [...]` introuvable"];
  const problems: string[] = [];
  if (!steps.includes('"generate"')) problems.push("l'étape prisma generate manque");
  if (!steps.includes('"build"')) problems.push("l'étape next build manque");
  if (/"migrate"|"deploy"|prisma migrate deploy/.test(steps)) problems.push("une étape migre la base");
  return problems;
}

/** Problèmes de package.json (vide = conforme). */
function packageProblems(pkg: { scripts?: Record<string, string> }): string[] {
  const scripts = pkg.scripts ?? {};
  const problems: string[] = [];
  if (scripts.build !== "node scripts/build.mjs") problems.push("`build` ne passe plus par scripts/build.mjs");
  if (scripts.postinstall !== "prisma generate") problems.push("`postinstall` doit rester `prisma generate`");
  for (const [name, command] of Object.entries(scripts)) {
    if (MIGRATING.test(command)) problems.push(`le script npm « ${name} » migre la base`);
  }
  if ("vercel-build" in scripts) problems.push("un script `vercel-build` remplacerait le build");
  return problems;
}

/** Problèmes de vercel.json (vide = conforme). */
function vercelProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of ["buildCommand", "installCommand", "devCommand"]) {
    if (key in config) problems.push(`vercel.json redéfinit ${key}`);
  }
  return problems;
}

describe("Vercel build safety", () => {
  it("never applies database migrations during preview or production builds", () => {
    expect(buildStepProblems(read("scripts/build.mjs"))).toEqual([]);
  });

  it("package.json : build, postinstall et scripts npm ne migrent pas", () => {
    expect(packageProblems(JSON.parse(read("package.json")))).toEqual([]);
  });

  it("vercel.json ne redéfinit pas les commandes de build", () => {
    expect(vercelProblems(JSON.parse(read("vercel.json")))).toEqual([]);
  });
});

describe("la garde échoue quand la protection est retirée (cas négatifs)", () => {
  const real = read("scripts/build.mjs");

  it("étape « migrate deploy » ajoutée au build", () => {
    const mutated = real.replace(
      '["node_modules/next/dist/bin/next", "build"],',
      '["node_modules/next/dist/bin/next", "build"],\n  ["node_modules/prisma/build/index.js", "migrate", "deploy"],',
    );
    expect(mutated).not.toBe(real);
    expect(buildStepProblems(mutated)).toContain("une étape migre la base");
  });

  it("étape « deploy » seule, ou « migrate » seule", () => {
    for (const step of ['"deploy"', '"migrate"']) {
      const mutated = real.replace('"generate"', `"generate", ${step}`);
      expect(buildStepProblems(mutated)).toContain("une étape migre la base");
    }
  });

  it("liste d'étapes renommée : la garde refuse au lieu de passer à vide", () => {
    expect(buildStepProblems(real.replace("const steps", "const plan"))).toEqual(["liste `const steps = [...]` introuvable"]);
  });

  it("étapes generate / build retirées", () => {
    expect(buildStepProblems(real.replace('"generate"', '"noop"'))).toContain("l'étape prisma generate manque");
    expect(buildStepProblems(real.replace('"build"', '"noop"'))).toContain("l'étape next build manque");
  });

  it("package.json : build détourné, postinstall migrant, script npm migrant, vercel-build", () => {
    const base = { scripts: { build: "node scripts/build.mjs", postinstall: "prisma generate", test: "vitest run" } };
    expect(packageProblems(base)).toEqual([]);
    expect(packageProblems({ scripts: { ...base.scripts, build: "prisma migrate deploy && next build" } })).toContain("`build` ne passe plus par scripts/build.mjs");
    expect(packageProblems({ scripts: { ...base.scripts, postinstall: "prisma generate && prisma migrate deploy" } })).toContain("`postinstall` doit rester `prisma generate`");
    expect(packageProblems({ scripts: { ...base.scripts, "db:migrate": "node scripts/db-migrate.mjs --execute" } })).toContain("le script npm « db:migrate » migre la base");
    expect(packageProblems({ scripts: { ...base.scripts, seed: "prisma db push" } })).toContain("le script npm « seed » migre la base");
    expect(packageProblems({ scripts: { ...base.scripts, "vercel-build": "next build" } })).toContain("un script `vercel-build` remplacerait le build");
  });

  it("vercel.json : buildCommand ou installCommand redéfinis", () => {
    expect(vercelProblems({ regions: ["fra1"] })).toEqual([]);
    expect(vercelProblems({ buildCommand: "prisma migrate deploy && next build" })).toEqual(["vercel.json redéfinit buildCommand"]);
    expect(vercelProblems({ installCommand: "npm ci && prisma migrate deploy" })).toEqual(["vercel.json redéfinit installCommand"]);
  });
});
