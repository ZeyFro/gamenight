import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde « aucune page livrée sans lien d'accès » (audit téléphone et liens du 23/11/2026 : `/projets`, `/soutiens` et
 * `/bibliotheque/plateformes` existaient mais aucune page n'y menait). Toute page statique doit être CITÉE (lien, redirection,
 * constante de navigation) par un fichier source autre que son propre dossier, sauf exception ci-dessous AVEC sa raison.
 * Un lien derrière un interrupteur compte : la page est 404 tant que l'interrupteur est éteint, le lien l'est aussi.
 */
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
const pages = files.filter((file) => /^src\/app\/(?!api\/).*\/page\.tsx$/.test(file));
const routeOf = (file: string) => file.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "") || "/";
const staticRoutes = pages.map(routeOf).filter((route) => route !== "/" && !route.includes("["));
const sources = files.filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));

/** Pages volontairement sans lien d'accès direct. */
const SANS_LIEN: Record<string, string> = {
  "/accueil-v2": "page de comparaison facultative (HOME_V2_ENABLED), non destinée aux membres",
  "/admin/discord-commands": "console temporaire d’enregistrement des commandes, ouverte par son adresse puis éteinte (docs/SOIREE_ACTIVATION.md § 9 sexies)",
  "/admin/messages": "ancienne adresse conservée : redirige vers l’onglet correspondant de /admin",
  "/admin/superlatifs": "ancienne adresse conservée : redirige vers l’onglet correspondant de /admin",
  "/admin/tower-layout": "outil du propriétaire Tower, ouvert par son adresse ; écriture suspendue (audit V4-25)",
  "/admin/tower-onboarding-panel": "console du propriétaire Tower, sans lien membre ; publication manuelle protégée (C006)",
};

/** Un nom de page cité dans un commentaire n’est pas un lien. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function cited(route: string): string[] {
  const own = `src/app${route}/`;
  const pattern = new RegExp(`["'\`]${route.replace(/[/.-]/g, "\\$&")}(?=["'\`?#/]|\\$\\{)`);
  return sources.filter((file) => !file.startsWith(own) && pattern.test(withoutComments(readFileSync(file, "utf8"))));
}

describe("aucune page livrée sans lien d'accès", () => {
  it("chaque page statique est citée par un autre fichier, ou listée avec sa raison", () => {
    const orphans = staticRoutes.filter((route) => !(route in SANS_LIEN) && cited(route).length === 0);
    expect(orphans).toEqual([]);
  });
  it("une exception listée n'est jamais devenue inutile (page disparue ou désormais liée)", () => {
    for (const route of Object.keys(SANS_LIEN)) {
      expect(staticRoutes, `${route} n'existe plus : retirer l'exception`).toContain(route);
      expect(cited(route), `${route} est maintenant lié : retirer l'exception`).toEqual([]);
    }
  });
});
