import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cahier C094 (docs/PROCEDURES_PREUVES.md) : aucune IA ne valide une preuve. La validation est humaine (votes) ou mesurée (compteurs
 * Steam). Garde simple et sans réseau : aucune dépendance ni aucun appel à un service d'IA générative dans l'application. Un ajout
 * légitime futur (hors validation de preuve) devra modifier ce test en connaissance de cause, et dire pourquoi dans la PR.
 */
const AI_PACKAGES = /^(openai|@anthropic-ai\/.+|@ai-sdk\/.+|ai|@google\/generative-ai|@google-ai\/.+|langchain|@langchain\/.+|cohere-ai|@mistralai\/.+|replicate|ollama)$/;
const AI_HOSTS = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(ai|com)|api-inference\.huggingface\.co/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("aucune IA générative ne valide une preuve", () => {
  it("package.json ne déclare aucune dépendance d'IA générative", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string> | undefined>;
    const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})];
    expect(declared.filter((name) => AI_PACKAGES.test(name))).toEqual([]);
  });

  it("le code de l'application n'appelle aucun service d'IA générative", () => {
    const hits = sources("src").filter((file) => AI_HOSTS.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  it("le code de l'application n'importe aucun paquet d'IA générative", () => {
    const importRe = /from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
    const hits = sources("src").flatMap((file) => {
      const code = readFileSync(file, "utf8");
      return [...code.matchAll(importRe)].map((m) => m[1] ?? m[2]).filter((name) => AI_PACKAGES.test(name)).map((name) => `${file} : ${name}`);
    });
    expect(hits).toEqual([]);
  });
});
