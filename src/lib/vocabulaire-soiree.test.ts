import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Vocabulaire (mission du 24/11/2026) : un joueur lit « soirée » (ou « partie » pour une partie de jeu), jamais « session ». Garde sur une
 * LISTE CIBLÉE de fichiers qui portent des textes affichés ; les identifiants (`session.id`), les routes (`/sessions`), les noms de modèles
 * et les commentaires sont ignorés. Ajouter ici tout nouveau fichier de texte visible.
 */
const VISIBLE_TEXT_FILES = [
  "src/app/sessions/page.tsx",
  "src/app/jouer-maintenant/page.tsx",
  "src/app/disponibilites/page.tsx",
  "src/components/jouer-maintenant/EndInstantSessionDialog.tsx",
  "src/components/jouer-maintenant/InstantSessionDetail.tsx",
  "src/components/admin/MessagesTab.tsx",
  "src/lib/guide-sections.ts",
  "src/lib/instant-session-announce.ts",
  "src/lib/instant-session-interest.ts",
  "src/lib/notification-preferences.ts",
  "src/lib/player-matching-rules.ts",
  "src/lib/session-schedule.ts",
  "src/lib/tower-challenge-categories.ts",
  "src/lib/tower-challenge-starter-catalogue.ts",
  "src/lib/tower-s1-solo-catalogue.ts",
  "src/lib/tower-s1-team-catalogue.ts",
  "src/lib/tower-team-challenge-starter-catalogue.ts",
];

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Littéraux de chaîne, sans les expressions `${…}` ni les routes (`/sessions…`). */
function stringLiterals(code: string): string[] {
  const clean = withoutComments(code);
  return [...clean.matchAll(/"([^"\n\\]*(?:\\.[^"\n\\]*)*)"|'([^'\n\\]*(?:\\.[^'\n\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? "")
    .map((s) => s.replace(/\$\{[^}]*\}/g, "").replace(/\/sessions\S*/g, ""));
}

/** Texte JSX entre balises, sans les expressions `{…}`. */
function jsxTexts(code: string): string[] {
  const clean = withoutComments(code);
  return [...clean.matchAll(/>([^<>{}"]+)</g)].map((m) => m[1]);
}

/** Un texte affiché contient une phrase (au moins une espace) ou est le libellé « Session(s) » ; les identifiants, imports et clés ne comptent pas. */
const SESSION_WORD = /\bsessions?\b/i;
const isVisibleText = (text: string) => SESSION_WORD.test(text) && (/\s/.test(text.trim()) || /^Sessions?$/.test(text.trim()));

describe("vocabulaire visible : « soirée », jamais « session »", () => {
  it.each(VISIBLE_TEXT_FILES)("%s : aucun texte affiché ne dit « session »", (file) => {
    const code = readFileSync(file, "utf8");
    const hits = [...stringLiterals(code), ...jsxTexts(code)].filter(isVisibleText).map((s) => s.trim().slice(0, 80));
    expect(hits).toEqual([]);
  });

  it("les options de « Fin des votes » disent « avant la soirée »", () => {
    const page = readFileSync("src/app/sessions/page.tsx", "utf8");
    const options = [...page.matchAll(/<option value="[\d.]+">([^<]*avant la [^<]*)<\/option>/g)].map((m) => m[1]);
    expect(options).toEqual(["30 min avant la soirée", "1h avant la soirée", "2h avant la soirée", "6h avant la soirée", "12h avant la soirée", "24h avant la soirée", "48h avant la soirée"]);
  });
});
