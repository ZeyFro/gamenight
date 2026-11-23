import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Audit du 23/11/2026 (constat 2.7) : iOS attend une icône « apple-touch-icon » de 180×180, OPAQUE (il remplit la transparence en noir),
 * et le manifeste déclarait la même image « any maskable » : rognage possible. Icône Apple dédiée, icône maskable dédiée (motif dans la
 * zone sûre de 80 %), usages séparés.
 */
function png(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe("icônes de l'application installée", () => {
  it("apple-touch-icon : 180×180, RVB sans canal alpha (opaque)", () => {
    expect(png("public/apple-touch-icon.png")).toEqual({ width: 180, height: 180, colorType: 2 });
  });
  it("icône maskable dédiée : 512×512", () => {
    expect(png("public/icon-maskable-512.png")).toMatchObject({ width: 512, height: 512 });
  });
  it("le manifeste sépare « any » et « maskable » et ne déclare plus « any maskable »", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as { icons: { src: string; sizes: string; purpose: string }[] };
    expect(manifest.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
  it("le layout pointe l'icône Apple dédiée", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain('url: "/apple-touch-icon.png", sizes: "180x180"');
  });
});
