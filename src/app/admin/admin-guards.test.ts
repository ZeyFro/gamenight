import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Garde « l'administration est réservée aux administrateurs » (audit de la production du 23/11/2026 : un onglet de /admin
 * affichait « tout le monde peut gérer cette liste »). Le texte était faux (toutes les actions passent par `requireAdmin`),
 * mais rien ne le verrouillait : ces tests le verrouillent.
 * 1. Chaque fonction exportée des actions d'administration appelle `requireAdmin` AVANT toute lecture ou écriture.
 * 2. La page `/admin` et chacun de ses onglets sont rendus APRÈS `requireAdmin` (un non-admin est renvoyé à l'accueil).
 * 3. Aucun texte d'administration ne prétend que tout le monde peut gérer une liste.
 */
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n").filter(Boolean);
const ACTION_FILES = files.filter((file) => /^src\/app\/admin\/(badges|communautes|jeux-gratuits|jeux-stats|joueurs|messages|nettoyage|reglages|superlatifs)\/actions\.ts$/.test(file));

function exportedFunctions(source: string): { name: string; body: string }[] {
  return source.split(/(?=^export (?:async )?function )/m).flatMap((part) => {
    const match = part.match(/^export (?:async )?function (\w+)/);
    return match ? [{ name: match[1], body: part }] : [];
  });
}

describe("actions d'administration : requireAdmin avant tout accès aux données", () => {
  it("les neuf fichiers d'actions existent", () => {
    expect(ACTION_FILES).toHaveLength(9);
  });
  for (const file of ACTION_FILES) {
    it(`${file} : chaque action appelle requireAdmin avant prisma ou toute écriture`, () => {
      const source = readFileSync(file, "utf8");
      const functions = exportedFunctions(source);
      expect(functions.length).toBeGreaterThan(0);
      for (const { name, body } of functions) {
        const guard = body.indexOf("requireAdmin(");
        expect(guard, `${name} : requireAdmin absent`).toBeGreaterThan(-1);
        const firstAccess = [body.indexOf("prisma."), body.indexOf("formData.get(")].filter((index) => index >= 0);
        for (const index of firstAccess) expect(guard, `${name} lit ou écrit avant requireAdmin`).toBeLessThan(index);
      }
    });
  }
});

describe("page /admin", () => {
  it("n'affiche aucun onglet avant requireAdmin, et renvoie un non-admin à l'accueil", () => {
    const page = readFileSync("src/app/admin/page.tsx", "utf8");
    const guard = page.indexOf("await requireAdmin()");
    expect(guard).toBeGreaterThan(-1);
    expect(page.slice(guard, guard + 200)).toMatch(/if \(!user\) redirect\("\/"\)/);
    expect(guard).toBeLessThan(page.indexOf("<MessagesTab"));
    expect(guard).toBeLessThan(page.indexOf("<BadgesTab"));
    expect(guard).toBeLessThan(page.indexOf("<SuperlativesTab"));
  });
});

describe("textes d'administration", () => {
  it("aucun ne prétend que tout le monde peut gérer une liste", () => {
    const texts = files.filter((file) => /^src\/(components\/admin|app\/admin)\/.*\.tsx$/.test(file));
    for (const file of texts) expect(readFileSync(file, "utf8").replace(/\s+/g, " "), file).not.toMatch(/tout le monde peut gérer|Pas de rôle admin dédié/i);
  });
});
