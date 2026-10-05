import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive : chaque `page.tsx` d'`src/app` doit exporter un titre
 * d'onglet (`pageMetadata`, `generateMetadata` ou `metadata`), sinon la page
 * garde le « GameNight » du layout racine sans que personne ne s'en aperçoive
 * (suite de PAGE_TITLES_ENABLED).
 */

/** Pages volontairement sans titre propre : le titre par défaut du layout convient. */
const WITHOUT_TITLE = new Set(["src/app/page.tsx"]);

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path.replaceAll("\\", "/")] : [];
  });
}

const HAS_TITLE =
  /export\s+(?:async\s+)?function\s+generateMetadata\b|export\s+const\s+(?:metadata|generateMetadata)\b|\b(?:pageMetadata|dynamicPageMetadata)\(/;

const pages = pageFiles("src/app");

describe("titres de page", () => {
  it("trouve bien des pages (garde contre un scan vide)", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it("chaque page.tsx exporte un titre", () => {
    const missing = pages
      .filter((f) => !WITHOUT_TITLE.has(f) && !HAS_TITLE.test(readFileSync(f, "utf8")))
      .sort();
    expect(missing, `Pages sans titre : ${missing.join(", ")}`).toEqual([]);
  });

  it("la liste des exceptions n'est pas périmée", () => {
    const stale = [...WITHOUT_TITLE].filter((f) => !pages.includes(f) || HAS_TITLE.test(readFileSync(f, "utf8")));
    expect(stale, `À retirer de WITHOUT_TITLE : ${stale.join(", ")}`).toEqual([]);
  });
});
