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

  it("offers upload and deletion to an authorized community moderator", () => {
    render(<SessionGallery sessionId="session-1" canManage images={media} storageReady videosEnabled />);
    expect(screen.getByLabelText("Ajouter un média")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Supprimer" })).toHaveLength(2);
  });
});
