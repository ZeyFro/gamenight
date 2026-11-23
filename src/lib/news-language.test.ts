import { describe, expect, it } from "vitest";
import { isFrenchNewsTitle } from "./news-language";

describe("isFrenchNewsTitle", () => {
  it("accepte des titres français", () => {
    for (const title of [
      "Mise à jour 1.2 : les nouveautés de la saison",
      "Le patch de l'été arrive demain",
      "Événement spécial : rejoignez la fête",
      "Nouvelle extension disponible dès aujourd'hui",
      "Correctif 4.7 : équilibrage des classes",
      "Découvrez notre nouveau mode de jeu",
    ]) expect(isFrenchNewsTitle(title), title).toBe(true);
  });

  it("masque l'anglais", () => {
    for (const title of [
      "Patch Notes 1.2",
      "Summer Sale is live now",
      "New update available: the season is here",
      "Announcing our biggest update yet",
      "Hotfix 2.4.1 for the weekend event",
    ]) expect(isFrenchNewsTitle(title), title).toBe(false);
  });

  it("masque le russe et les autres alphabets", () => {
    for (const title of ["Обновление 1.2: новые карты", "Большое обновление уже доступно", "新版本更新公告", "تحديث جديد متاح"]) {
      expect(isFrenchNewsTitle(title), title).toBe(false);
    }
  });

  it("masque l'espagnol, l'allemand, l'italien et le portugais qui partagent des mots avec le français", () => {
    for (const title of ["Actualización de la temporada con nuevos mapas", "Das neue Update ist da und bringt viele Änderungen", "Il nuovo aggiornamento di stagione", "Nova atualização da temporada já disponível em português"]) {
      expect(isFrenchNewsTitle(title), title).toBe(false);
    }
  });

  it("masque un titre vide ou sans mot reconnaissable (dans le doute, on ne montre pas)", () => {
    for (const title of ["", "   ", "1.2.3", "Hades II"]) expect(isFrenchNewsTitle(title), JSON.stringify(title)).toBe(false);
  });

  it("un titre mixte où l'anglais domine reste masqué", () => {
    expect(isFrenchNewsTitle("Update 1.2 and the new season is live")).toBe(false);
  });
});
