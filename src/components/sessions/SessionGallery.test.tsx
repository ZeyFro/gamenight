// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/sessions/actions/gallery", () => ({
  deleteSessionGalleryImageAction: vi.fn(),
  uploadSessionGalleryImageAction: vi.fn(),
}));

import { SessionGallery } from "./SessionGallery";

const media = [
  { id: "photo-1", uploadedById: "member-1", mimeType: "image/jpeg", createdAt: new Date() },
  { id: "clip-1", uploadedById: "member-1", mimeType: "video/mp4", createdAt: new Date() },
];

describe("session gallery video clips", () => {
  afterEach(cleanup);

  it("shows private MP4 controls and a download fallback only when videos are enabled", () => {
    render(<SessionGallery sessionId="session-1" canManage images={media} storageReady videosEnabled />);

    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("controls")).not.toBeNull();
    expect(video?.getAttribute("playsinline")).not.toBeNull();
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.querySelector("source")?.getAttribute("src")).toBe("/api/sessions/session-1/media/clip-1");
    expect(screen.getByRole("link", { name: "Télécharger le clip" }).getAttribute("href")).toBe("/api/sessions/session-1/media/clip-1");
    expect((screen.getByLabelText("Ajouter un média") as HTMLInputElement).accept).toContain("video/mp4");
  });

  it("keeps the photo-only UI while videos are disabled", () => {
    render(<SessionGallery sessionId="session-1" canManage images={media} storageReady videosEnabled={false} />);

    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByText(/Les clips vidéo sont désactivés pour le moment/)).toBeTruthy();
    expect((screen.getByLabelText("Ajouter une photo") as HTMLInputElement).accept).not.toContain("video/mp4");
  });

  it("does not offer gallery management to an invited member", () => {
    render(<SessionGallery sessionId="session-1" canManage={false} images={media} storageReady videosEnabled />);

    expect(screen.queryByLabelText("Ajouter un média")).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();
  });

  describe("MEDIA_PRIVACY_ENABLED", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("flag éteint : une seule case de consentement, markup du formulaire inchangé", () => {
      vi.stubEnv("MEDIA_PRIVACY_ENABLED", "");
      const { container } = render(<SessionGallery sessionId="session-1" canManage images={[]} storageReady videosEnabled />);
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
      expect(container.querySelector('input[name="consentPeople"]')).toBeNull();
      expect(container.textContent).not.toContain("personnes reconnaissables");
      expect(container.textContent).not.toContain("retrait");
    });

    it("flag allumé : case obligatoire des personnes reconnaissables et rappel du retrait", () => {
      vi.stubEnv("MEDIA_PRIVACY_ENABLED", "true");
      const { container } = render(<SessionGallery sessionId="session-1" canManage images={[]} storageReady videosEnabled />);
      const people = container.querySelector('input[name="consentPeople"]') as HTMLInputElement;
      expect(people.type).toBe("checkbox");
      expect(people.required).toBe(true);
      expect((container.querySelector('input[name="consent"]') as HTMLInputElement).required).toBe(true);
      expect(container.textContent).toContain(
        "Je confirme avoir l’accord des personnes reconnaissables ou audibles ; elles peuvent demander le retrait du média.",
      );
      expect(container.textContent).toContain("créateur de la soirée ou à un administrateur");
      expect(container.querySelector('a[href="/mentions-legales"]')).toBeNull();
    });

    it("flag allumé et pages légales actives : lien vers les mentions légales", () => {
      vi.stubEnv("MEDIA_PRIVACY_ENABLED", "true");
      vi.stubEnv("LEGAL_PAGES_ENABLED", "true");
      const { container } = render(<SessionGallery sessionId="session-1" canManage images={[]} storageReady videosEnabled />);
      expect(container.querySelector('a[href="/mentions-legales"]')).not.toBeNull();
    });
  });

  it("offers upload and deletion to an authorized community moderator", () => {
    render(<SessionGallery sessionId="session-1" canManage images={media} storageReady videosEnabled />);
    expect(screen.getByLabelText("Ajouter un média")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Supprimer" })).toHaveLength(2);
  });

  // V3-18 : sans stockage configuré, le message technique n'est conservé que flag éteint.
  it("keeps the historical storage message while plainTexts is off", () => {
    render(<SessionGallery sessionId="session-1" canManage images={[]} storageReady={false} videosEnabled={false} />);
    expect(screen.getByText("Le stockage Blob privé n’est pas configuré.")).toBeTruthy();
  });

  it("replaces the storage jargon with a plain sentence when plainTexts is on", () => {
    render(<SessionGallery sessionId="session-1" canManage images={[]} storageReady={false} videosEnabled={false} plainTexts />);
    expect(screen.getByText("Les photos ne sont pas encore disponibles.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Blob/);
  });
});
