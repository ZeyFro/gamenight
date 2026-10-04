import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive : chaque variable citée dans la section « Switches
 * d'environnement » de CLAUDE.md doit exister dans `.env.example` (active ou
 * commentée). Sans lui, la doc des drapeaux dérive du code.
 */

function switchesSection(): string {
  const md = readFileSync("CLAUDE.md", "utf8");
  const start = md.indexOf("## Switches d'environnement");
  if (start === -1) return "";
  const rest = md.slice(start + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

const documentedVars = new Set(
  [...readFileSync(".env.example", "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
);

const cited = new Set(
  [...switchesSection().matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1])
);

describe("CLAUDE.md « Switches d'environnement » ↔ .env.example", () => {
  it("trouve bien des variables dans la section (garde contre un scan vide)", () => {
    expect(cited.size).toBeGreaterThan(10);
  });

  it("chaque variable citée existe dans .env.example", () => {
    const missing = [...cited].filter((v) => !documentedVars.has(v)).sort();
    expect(missing, `Absentes de .env.example : ${missing.join(", ")}`).toEqual([]);
  });
});
