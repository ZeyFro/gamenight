import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou d'accessibilité : le layout racine (`src/app/layout.tsx`) rend
 * déjà l'unique landmark `<main>` du document (cible du lien d'évitement,
 * stylé par `.gn-main`). Une page ou un composant qui rend à son tour un
 * `<main>` (ou `role="main"`) crée deux landmarks principaux imbriqués :
 * défaut WCAG (1.3.1 / 2.4.1) pour les lecteurs d'écran. Les pages utilisent
 * `<div>` ou `<section>`.
 */

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : listSourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const ROOT_LAYOUT = "src/app/layout.tsx";
const MAIN_LANDMARK = /<main[\s>]|role=["']main["']/;

/**
 * Exceptions explicites : fichiers sur une liste de fichiers réservés à un
 * autre chantier au moment de ce correctif. Chaque entrée DOIT encore
 * contenir un landmark (sinon le test échoue : retirer l'exception).
 */
const EXCEPTIONS: Record<string, string> = {
  "src/app/admin/tower-content-audit/page.tsx": "fichier réservé (chantier Tower), à corriger ensuite",
  "src/components/admin/TowerContentAuditClient.tsx": "fichier réservé (chantier Tower), à corriger ensuite",
  "src/app/equipes/page.tsx": "fichier réservé (chantier équipes), à corriger ensuite",
  "src/app/tower/page.tsx": "fichier réservé (chantier Tower), à corriger ensuite",
  "src/app/joueurs/page.tsx": "fichier réservé (chantier joueurs), à corriger ensuite",
};

const files = listSourceFiles("src").map((f) => f.replaceAll("\\", "/"));

describe("landmark <main> unique", () => {
  it("le layout racine fournit le <main> global", () => {
    expect(MAIN_LANDMARK.test(readFileSync(ROOT_LAYOUT, "utf8"))).toBe(true);
  });

  it("aucune page, layout imbriqué ni composant ne rend un second <main>", () => {
    const offenders = files.filter(
      (f) => f !== ROOT_LAYOUT && !(f in EXCEPTIONS) && MAIN_LANDMARK.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("chaque exception justifiée contient encore un <main> (liste à jour)", () => {
    const stale = Object.keys(EXCEPTIONS).filter((f) => !MAIN_LANDMARK.test(readFileSync(f, "utf8")));
    expect(stale).toEqual([]);
  });
});
