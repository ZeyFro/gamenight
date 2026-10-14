import { describe, it, expect, vi } from "vitest";
import {
  detectBannerImageSignature,
  isOwnBlobUrl,
  extractBlobPathname,
  isUserOwnedBannerPathname,
  canDeleteBannerBlob,
  shouldDeleteOldBanner,
  safelyDeleteOldBannerBlob,
  cleanupOrphanedBannerUpload,
} from "./banner-blob";

const OWN_HOST = "https://abc123.public.blob.vercel-storage.com";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("detectBannerImageSignature", () => {
  it("reconnaît un JPEG à sa signature", () => {
    expect(detectBannerImageSignature(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
  });

  it("reconnaît un PNG à sa signature", () => {
    expect(
      detectBannerImageSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    ).toBe("image/png");
  });

  it("reconnaît un GIF87a et un GIF89a à leur signature", () => {
    expect(detectBannerImageSignature(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe(
      "image/gif"
    );
    expect(detectBannerImageSignature(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(
      "image/gif"
    );
  });

  it("reconnaît un WebP à sa signature RIFF….WEBP", () => {
    const webp = bytes(
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // taille (ignorée)
      0x57, 0x45, 0x42, 0x50 // WEBP
    );
    expect(detectBannerImageSignature(webp)).toBe("image/webp");
  });

  it("ne modifie jamais le buffer passé (lecture seule, GIF non retouché)", () => {
    const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xde, 0xad, 0xbe, 0xef);
    const copy = gif.slice();
    detectBannerImageSignature(gif);
    expect(gif).toEqual(copy);
  });

  it("refuse un buffer vide, tronqué, ou d'un format non supporté", () => {
    expect(detectBannerImageSignature(bytes())).toBeNull();
    expect(detectBannerImageSignature(bytes(0xff, 0xd8))).toBeNull();
    // en-tête PDF ("%PDF")
    expect(detectBannerImageSignature(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
    // en-tête HTML déguisé en image
    expect(
      detectBannerImageSignature(new TextEncoder().encode("<html><script>"))
    ).toBeNull();
  });
});

describe("isOwnBlobUrl / extractBlobPathname", () => {
  it("reconnaît le hostname des blobs publics Vercel Blob", () => {
    expect(isOwnBlobUrl(`${OWN_HOST}/banners/user1/123.jpg`)).toBe(true);
  });

  it("refuse toute URL externe, sans distinction", () => {
    expect(isOwnBlobUrl("https://klipy.com/banniere.gif")).toBe(false);
    expect(isOwnBlobUrl("https://imgur.com/x.png")).toBe(false);
    expect(isOwnBlobUrl("not-a-url")).toBe(false);
  });

  it("extrait le pathname sans le slash de tête", () => {
    expect(extractBlobPathname(`${OWN_HOST}/banners/user1/123.jpg`)).toBe(
      "banners/user1/123.jpg"
    );
  });

  it("renvoie null pour une URL invalide", () => {
    expect(extractBlobPathname("not-a-url")).toBeNull();
  });
});

describe("isUserOwnedBannerPathname", () => {
  it("accepte un pathname namespacé pour le bon user", () => {
    expect(isUserOwnedBannerPathname("banners/user1/123.jpg", "user1")).toBe(true);
  });

  it("refuse le pathname namespacé d'un autre user", () => {
    expect(isUserOwnedBannerPathname("banners/user2/123.jpg", "user1")).toBe(false);
  });

  it("refuse l'ancien format pré-namespace (id concaténé sans séparateur fiable)", () => {
    expect(isUserOwnedBannerPathname("banners/user1-1699999999999.jpg", "user1")).toBe(false);
  });

  it("refuse un pathname null", () => {
    expect(isUserOwnedBannerPathname(null, "user1")).toBe(false);
  });
});

describe("canDeleteBannerBlob — décision pure, sans appel réseau", () => {
  it("autorise un blob namespacé appartenant au même utilisateur", () => {
    expect(canDeleteBannerBlob(`${OWN_HOST}/banners/user1/123.jpg`, "user1")).toBe(true);
  });

  it("refuse un blob namespacé d'un autre utilisateur, même store", () => {
    expect(canDeleteBannerBlob(`${OWN_HOST}/banners/user2/123.jpg`, "user1")).toBe(false);
  });

  it("refuse une URL externe", () => {
    expect(canDeleteBannerBlob("https://klipy.com/banniere.gif", "user1")).toBe(false);
  });

  it("refuse un ancien blob sans namespace vérifiable", () => {
    expect(canDeleteBannerBlob(`${OWN_HOST}/banners/user1-1699999999999.jpg`, "user1")).toBe(
      false
    );
  });
});

describe("shouldDeleteOldBanner", () => {
  it("ne supprime rien si l'ancienne et la nouvelle URL sont identiques", () => {
    const url = `${OWN_HOST}/banners/user1/123.jpg`;
    expect(shouldDeleteOldBanner(url, url, "user1")).toBe(false);
  });

  it("ne supprime rien s'il n'y avait pas d'ancienne bannière", () => {
    expect(shouldDeleteOldBanner(null, `${OWN_HOST}/banners/user1/999.jpg`, "user1")).toBe(
      false
    );
  });

  it("autorise la suppression si l'ancienne bannière est un blob à nous et diffère de la nouvelle", () => {
    expect(
      shouldDeleteOldBanner(
        `${OWN_HOST}/banners/user1/123.jpg`,
        `${OWN_HOST}/banners/user1/999.jpg`,
        "user1"
      )
    ).toBe(true);
  });

  it("refuse si l'ancienne bannière appartient à un autre utilisateur", () => {
    expect(
      shouldDeleteOldBanner(
        `${OWN_HOST}/banners/user2/123.jpg`,
        "https://exemple.com/nouvelle.jpg",
        "user1"
      )
    ).toBe(false);
  });
});

describe("safelyDeleteOldBannerBlob — orchestration best-effort, ops injectées", () => {
  it("appelle head() puis del() quand le blob appartient au même utilisateur", async () => {
    const head = vi.fn().mockResolvedValue({});
    const del = vi.fn().mockResolvedValue(undefined);
    await safelyDeleteOldBannerBlob(
      `${OWN_HOST}/banners/user1/123.jpg`,
      `${OWN_HOST}/banners/user1/999.jpg`,
      "user1",
      { head, del }
    );
    expect(head).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("n'appelle ni head() ni del() pour le blob d'un autre utilisateur (aucun appel réseau)", async () => {
    const head = vi.fn();
    const del = vi.fn();
    await safelyDeleteOldBannerBlob(
      `${OWN_HOST}/banners/user2/123.jpg`,
      "https://exemple.com/nouvelle.jpg",
      "user1",
      { head, del }
    );
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("n'appelle ni head() ni del() pour une URL externe", async () => {
    const head = vi.fn();
    const del = vi.fn();
    await safelyDeleteOldBannerBlob("https://klipy.com/banniere.gif", "", "user1", {
      head,
      del,
    });
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("n'appelle ni head() ni del() si l'ancienne et la nouvelle URL sont identiques", async () => {
    const head = vi.fn();
    const del = vi.fn();
    const url = `${OWN_HOST}/banners/user1/123.jpg`;
    await safelyDeleteOldBannerBlob(url, url, "user1", { head, del });
    expect(head).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("n'appelle jamais del() si head() rejette (blob d'un autre store)", async () => {
    const head = vi.fn().mockRejectedValue(new Error("not found"));
    const del = vi.fn();
    await safelyDeleteOldBannerBlob(
      `${OWN_HOST}/banners/user1/123.jpg`,
      `${OWN_HOST}/banners/user1/999.jpg`,
      "user1",
      { head, del }
    );
    expect(head).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  it("n'échoue jamais si del() rejette après un head() réussi (best-effort)", async () => {
    const head = vi.fn().mockResolvedValue({});
    const del = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      safelyDeleteOldBannerBlob(
        `${OWN_HOST}/banners/user1/123.jpg`,
        `${OWN_HOST}/banners/user1/999.jpg`,
        "user1",
        { head, del }
      )
    ).resolves.toBeUndefined();
  });
});

describe("cleanupOrphanedBannerUpload — nettoyage best-effort après échec Prisma", () => {
  it("supprime le blob qui vient d'être créé", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    await cleanupOrphanedBannerUpload(`${OWN_HOST}/banners/user1/123.jpg`, { del });
    expect(del).toHaveBeenCalledWith(`${OWN_HOST}/banners/user1/123.jpg`);
  });

  it("n'échoue jamais si del() rejette (best-effort)", async () => {
    const del = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      cleanupOrphanedBannerUpload(`${OWN_HOST}/banners/user1/123.jpg`, { del })
    ).resolves.toBeUndefined();
  });
});
