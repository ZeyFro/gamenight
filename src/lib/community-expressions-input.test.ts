import { describe, expect, it } from "vitest";
import { parseCommunityExpression } from "./community-expressions-input";
import * as m_p07 from "./community-expressions-input";

describe("expressions du serveur : saisie", () => {
  it("nettoie le texte et conserve les sauts de ligne", () => {
    expect(parseCommunityExpression("  Encore une ! ", " Sens\nlocal ")).toEqual({ title: "Encore une !", meaning: "Sens\nlocal" });
  });

  it.each([
    [null, "sens"], ["titre", new File([], "sens.txt")], [" ", "sens"], ["titre", " "],
    ["x".repeat(121), "sens"], ["titre", "x".repeat(2001)],
  ])("refuse une saisie invalide %s", (title, meaning) => {
    expect(parseCommunityExpression(title, meaning)).toBeNull();
  });

  it("accepte les bornes exactes", () => {
    expect(parseCommunityExpression("x".repeat(120), "x".repeat(2000))).not.toBeNull();
  });
});

// Tâche Qwen qwen-p07-expression-saisie — repris du test de preuve loop/checks (node:test) sous vitest.
describe("community-expressions-input · p07-expression-saisie", () => {
  it('le comportement existant est conserve', () => {
    expect(m_p07.parseCommunityExpression('Un gag', 'Son sens')).toEqual({ title: 'Un gag', meaning: 'Son sens' });
    expect(m_p07.parseCommunityExpression('', 'x')).toBe(null);
    expect(m_p07.parseCommunityExpression('x', '   ')).toBe(null);
    expect(m_p07.parseCommunityExpression(1, 'x')).toBe(null);
    expect(m_p07.parseCommunityExpression('a'.repeat(121), 'x')).toBe(null);
    expect(m_p07.parseCommunityExpression('a'.repeat(120), 'x')!.title.length).toBe(120);
  });
  it('le titre tient sur une ligne avec des espaces simples', () => {
    expect(m_p07.parseCommunityExpression('  Un   running\n gag  ', 'x')!.title).toBe('Un running gag');
  });
  it('le sens normalise les fins de ligne et limite les lignes vides', () => {
    expect(m_p07.parseCommunityExpression('t', 'Sens  du  gag\r\nligne 2   \r\n\r\n\r\n\r\nligne 3  ')!.meaning).toBe('Sens  du  gag\nligne 2\n\nligne 3');
  });
  it('la longueur du titre se mesure apres normalisation', () => {
    expect(m_p07.parseCommunityExpression('a' + ' '.repeat(150) + 'b', 'x')!.title).toBe('a b');
  });
});
