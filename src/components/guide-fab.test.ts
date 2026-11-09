import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/GuideFab.tsx"), "utf8");
const className = /className="([^"]+)"/.exec(source)?.[1] ?? "";

describe("GuideFab : position du bouton « ? » sur mobile", () => {
  it("reste au-dessus de la barre basse en tenant compte de la zone de sécurité (encoche)", () => {
    expect(className).toContain("bottom-[calc(5rem+env(safe-area-inset-bottom))]");
    expect(className.split(/\s+/)).not.toContain("bottom-20");
  });

  it("garde la position desktop historique", () => {
    expect(className.split(/\s+/)).toContain("lg:bottom-6");
  });
});
