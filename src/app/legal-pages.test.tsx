import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MentionsLegalesPage from "./mentions-legales/page";
import ConfidentialitePage from "./confidentialite/page";
import ConditionsPage from "./conditions/page";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { LoginLanding } from "@/components/app/LoginLanding";

const PAGES = [
  { name: "mentions légales", Page: MentionsLegalesPage, title: "Mentions légales" },
  { name: "confidentialité", Page: ConfidentialitePage, title: "Politique de confidentialité" },
  { name: "conditions", Page: ConditionsPage, title: "Conditions d’utilisation" },
];
const HREFS = ["/mentions-legales", "/confidentialite", "/conditions"];

afterEach(() => vi.unstubAllEnvs());

describe("pages légales (flag allumé)", () => {
  for (const { name, Page, title } of PAGES) {
    it(`${name} : se rend (200), avec la date de dernière mise à jour et sans bannière provisoire`, () => {
      vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
      const html = renderToStaticMarkup(createElement(Page));
      expect(html).toContain(`<h1`);
      expect(html).toContain(title);
      expect(html).toContain("Dernière mise à jour : 22 novembre 2026");
      expect(html).not.toContain("professionnel du droit");
      expect(html).not.toContain("Version provisoire");
      expect(html).not.toContain("<main");
      for (const href of HREFS) expect(html).toContain(`href="${href}"`);
    });
  }

  it("affiche les informations fournies et plus aucun champ manquant pour l'éditeur", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    vi.stubEnv("LEGAL_PUBLISHER", "Association Test, 1 rue Exemple");
    vi.stubEnv("LEGAL_PUBLICATION_DIRECTOR", "Responsable Test");
    vi.stubEnv("LEGAL_CONTACT_EMAIL", "contact@exemple.fr");
    vi.stubEnv("LEGAL_MIN_AGE", "15");
    const html = renderToStaticMarkup(createElement(MentionsLegalesPage));
    expect(html).toContain("Association Test, 1 rue Exemple");
    expect(html).toContain("Responsable Test");
    expect(html).toContain('href="mailto:contact@exemple.fr"');
    expect(html).not.toContain("À COMPLÉTER");
    expect(renderToStaticMarkup(createElement(ConditionsPage))).toContain("15 ans");
  });

  it("lien de contact : texte visible = nom de l'éditeur (« ZeyFro », décision Q13), adresse seulement dans le mailto", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    vi.stubEnv("LEGAL_PUBLISHER", "ZeyFro");
    vi.stubEnv("LEGAL_CONTACT_EMAIL", "contact@exemple.fr");
    for (const page of [MentionsLegalesPage, ConfidentialitePage, ConditionsPage]) {
      const html = renderToStaticMarkup(createElement(page));
      expect(html).toContain('href="mailto:contact@exemple.fr"');
      expect(html).toMatch(/<a href="mailto:contact@exemple\.fr"[^>]*>ZeyFro<\/a>/);
      expect(html.replace(/href="mailto:[^"]*"/g, "")).not.toContain("contact@exemple.fr");
    }
  });

  it("la politique cite les sous-traitants et leurs régions, et les droits RGPD", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    const html = renderToStaticMarkup(createElement(ConfidentialitePage));
    for (const word of ["Vercel", "Neon", "Discord", "Valve", "Francfort", "portabilité", "effacement", "CNIL", "cookies"]) expect(html).toContain(word);
  });

  it("l'export et la suppression en libre-service ne sont annoncés que si ACCOUNT_DELETION_ENABLED est « true »", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    expect(renderToStaticMarkup(createElement(ConfidentialitePage))).toContain("pas encore disponibles");
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    expect(renderToStaticMarkup(createElement(ConfidentialitePage))).toContain("supprimer ton compte toi-même");
  });
});

const FULL_ENV = {
  LEGAL_PAGES_ENABLED: "true",
  LEGAL_PUBLISHER: "Éditeur Test",
  LEGAL_PUBLICATION_DIRECTOR: "Directeur Test",
  LEGAL_CONTACT_EMAIL: "contact@exemple.fr",
  LEGAL_MIN_AGE: "15",
};

describe("pages légales : plus aucun « À COMPLÉTER » une fois les variables LEGAL_* posées", () => {
  for (const { name, Page } of PAGES) {
    it(`${name} : aucun « À COMPLÉTER » rendu`, () => {
      for (const [key, value] of Object.entries(FULL_ENV)) vi.stubEnv(key, value);
      const html = renderToStaticMarkup(createElement(Page));
      expect(html).not.toContain("À COMPLÉTER");
      expect(html).not.toContain('data-legal-missing="true"');
    });
  }

  it("aucun champ laissé vide en dur dans le code des trois pages", () => {
    for (const file of ["src/app/mentions-legales/page.tsx", "src/app/confidentialite/page.tsx", "src/app/conditions/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/value=\{null\}/);
      expect(source, file).not.toContain("À COMPLÉTER");
    }
  });

  it("les mentions légales donnent l'âge minimum, les conditions nomment l'éditeur ZeyFro", () => {
    for (const [key, value] of Object.entries(FULL_ENV)) vi.stubEnv(key, value);
    expect(renderToStaticMarkup(createElement(MentionsLegalesPage))).toContain("15 ans");
    const conditions = renderToStaticMarkup(createElement(ConditionsPage));
    expect(conditions).toContain("édité par ZeyFro");
    expect(conditions).toContain("22 novembre 2026");
  });

  it("sans variable, la valeur manquante reste signalée (jamais inventée)", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    expect(renderToStaticMarkup(createElement(MentionsLegalesPage))).toContain("À COMPLÉTER");
  });
});

describe("pages légales (flag éteint)", () => {
  for (const { name, Page } of PAGES) {
    it(`${name} : 404`, () => {
      vi.stubEnv("LEGAL_PAGES_ENABLED", "");
      expect(() => renderToStaticMarkup(createElement(Page))).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    });
  }
  it("le pied de page et la page de connexion n'affichent aucun lien", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "");
    expect(renderToStaticMarkup(createElement(LegalFooter))).toBe("");
    const login = renderToStaticMarkup(createElement(LoginLanding, null, "bouton"));
    for (const href of HREFS) expect(login).not.toContain(`href="${href}"`);
  });
});

describe("liens vers les pages légales", () => {
  it("le pied de page les contient (flag allumé)", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    const html = renderToStaticMarkup(createElement(LegalFooter));
    for (const href of HREFS) expect(html).toContain(`href="${href}"`);
  });
  it("la page de connexion les contient (flag allumé)", () => {
    vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
    const html = renderToStaticMarkup(createElement(LoginLanding, null, "bouton"));
    for (const href of HREFS) expect(html).toContain(`href="${href}"`);
  });
  it("le layout racine rend le pied de page sur chaque page", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toMatch(/<LegalFooter\b/);
  });
});
