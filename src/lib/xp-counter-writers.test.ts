import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Garde statique des deux compteurs (xpTotal = progression, xpBalance = solde dépensable) : toute écriture applicative de l'un
 * doit déclarer l'autre dans la MÊME opération, sinon un gain ou une pénalité ne toucherait qu'un compteur (XP perdu ou créé de
 * rien). Les PR Tower (#370, #406, #407, #408, #416, #417…) ne créditent aucune XP à ce jour ; cette garde protège leur intégration
 * future. Un nouvel écrivain légitime d'un seul compteur doit être ajouté à ALLOWED_SINGLE avec sa raison.
 */
const SRC = resolve("src");
const ALLOWED_SINGLE: Record<string, { only: "xpTotal" | "xpBalance"; why: string }> = {
  "src/lib/xp-shop.ts": { only: "xpBalance", why: "les achats de boutique débitent le solde seul ; la progression (xpTotal) est conservée" },
  "src/lib/seasons.ts": { only: "xpTotal", why: "décision A : le reset de saison remet la progression à zéro et conserve le solde de la boutique" },
};

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Contenu (accolades équilibrées) de chaque littéral qui suit `data:`. */
function dataBlocks(text: string) {
  const blocks: { body: string; line: number }[] = [];
  const re = /\bdata\s*:\s*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const c = text[i++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    blocks.push({ body: text.slice(start, i - 1), line: text.slice(0, m.index).split("\n").length });
  }
  return blocks;
}
const writes = (body: string, key: string) => new RegExp(`(^|[\\s,{])${key}\\s*:`).test(body);

describe("écrivains des compteurs XP", () => {
  const files = walk(SRC);

  it("toute écriture de xpTotal ou xpBalance (data: { … }) déclare les deux compteurs", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(resolve("."), file).replaceAll("\\", "/");
      for (const { body, line } of dataBlocks(readFileSync(file, "utf8"))) {
        const total = writes(body, "xpTotal");
        const balance = writes(body, "xpBalance");
        if (!total && !balance) continue;
        if (total && balance) continue;
        const allowed = ALLOWED_SINGLE[rel];
        if (allowed && (allowed.only === "xpBalance" ? !total && balance : total && !balance)) continue;
        offenders.push(`${rel}:${line} écrit ${total ? "xpTotal" : "xpBalance"} seul`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("aucun SQL brut applicatif n'écrit xpTotal ou xpBalance", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/SET\s+"?(xpTotal|xpBalance)"?\s*=/i.test(text)) offenders.push(relative(resolve("."), file).replaceAll("\\", "/"));
    }
    expect(offenders).toEqual([]);
  });

  it("les deux exceptions restent limitées : boutique = solde seul, reset de saison = progression seule", () => {
    for (const { body } of dataBlocks(readFileSync("src/lib/xp-shop.ts", "utf8"))) expect(writes(body, "xpTotal")).toBe(false);
    for (const { body } of dataBlocks(readFileSync("src/lib/seasons.ts", "utf8"))) expect(writes(body, "xpBalance")).toBe(false);
    expect(Object.keys(ALLOWED_SINGLE).sort()).toEqual(["src/lib/seasons.ts", "src/lib/xp-shop.ts"]);
  });

  it("détecte un écrivain à compteur unique (contre-test de la garde)", () => {
    const bad = `await db.communityMemberStats.update({ where: w, data: { xpTotal: { increment: 5 } } });`;
    const [{ body }] = dataBlocks(bad);
    expect(writes(body, "xpTotal")).toBe(true);
    expect(writes(body, "xpBalance")).toBe(false);
    const good = `await db.communityMemberStats.update({ where: w, data: { xpTotal: { increment: 5 }, xpBalance: { increment: 5 } } });`;
    const [{ body: goodBody }] = dataBlocks(good);
    expect(writes(goodBody, "xpTotal") && writes(goodBody, "xpBalance")).toBe(true);
  });
});
