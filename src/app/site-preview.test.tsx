import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alt, contentType, size } from "@/app/opengraph-image";
import { resolveAppOrigin } from "@/lib/app-url";
import { SITE_DESCRIPTION, SITE_NAME, siteMetadata } from "@/lib/site-metadata";

/** Audit du 23/11/2026, constats 3.1 à 3.3 et 3.7 : aperçu du lien du site partagé dans Discord. */
describe("métadonnées d'aperçu du site", () => {
  const metadata = siteMetadata("https://gamenight.example");
  it("Open Graph : site, titre, description française, langue fr_FR", () => {
    expect(metadata.openGraph).toMatchObject({ type: "website", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, locale: "fr_FR" });
    expect(SITE_DESCRIPTION).toContain("The Tower");
    expect(SITE_DESCRIPTION).toContain("Connexion avec Discord");
  });
  it("Twitter : grande carte avec titre et description", () => {
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION });
  });
  it("titre par défaut « GameNight » et gabarit « %s · GameNight » conservés", () => {
    expect(metadata.title).toEqual({ default: "GameNight", template: "%s · GameNight" });
  });
  it("metadataBase vient de l'origine fournie, et est omise sans elle (dev local)", () => {
    expect(String(metadata.metadataBase)).toBe("https://gamenight.example/");
    expect("metadataBase" in siteMetadata(null)).toBe(false);
    expect(resolveAppOrigin({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "gn.vercel.app" })).toBe("https://gn.vercel.app");
  });
  it("le layout utilise siteMetadata, sans domaine codé en dur ni generateMetadata (pas de titre de soirée privée dans un aperçu)", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("siteMetadata(resolveAppOrigin(");
    expect(layout).toContain("process.env.VERCEL_PROJECT_PRODUCTION_URL");
    expect(layout).not.toMatch(/new URL\("https?:/);
    expect(layout).not.toMatch(/export (async )?function generateMetadata/);
  });
});

describe("favicon.ico (constat 3.7)", () => {
  it("fichier ICO valide qui embarque l'icône PNG existante de l'application", () => {
    const ico = readFileSync("src/app/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1); // type icône
    expect(ico.readUInt16LE(4)).toBe(1); // une image
    const length = ico.readUInt32LE(14);
    const offset = ico.readUInt32LE(18);
    expect(offset + length).toBe(ico.length);
    expect(ico.subarray(offset, ico.length).equals(readFileSync("public/icon-192.png"))).toBe(true);
  });
});

describe("image d'aperçu", () => {
  it("1200×630, PNG, texte alternatif renseigné", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("GameNight");
  });
  it("la route produit une image PNG sans réseau", async () => {
    const { default: image } = await import("@/app/opengraph-image");
    const response = image();
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30000);
});
