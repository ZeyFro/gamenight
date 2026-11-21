// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameTrailer } from "./GameTrailer";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("GameTrailer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("flag éteint : iframe immédiate, markup identique à l'historique", () => {
    vi.stubEnv("MEDIA_PRIVACY_ENABLED", "");
    expect(renderToStaticMarkup(<GameTrailer videoId={VIDEO_ID} gameName="Hades" />)).toBe(
      '<div class="aspect-video w-full overflow-hidden rounded-lg bg-surface-hover">' +
        `<iframe src="https://www.youtube-nocookie.com/embed/${VIDEO_ID}" title="Trailer de Hades"` +
        ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"' +
        ' allowFullScreen="" class="h-full w-full"></iframe></div>',
    );
  });

  it("flag différent de « true » : reste en iframe immédiate", () => {
    vi.stubEnv("MEDIA_PRIVACY_ENABLED", "1");
    expect(renderToStaticMarkup(<GameTrailer videoId={VIDEO_ID} gameName="Hades" />)).toContain("<iframe");
  });

  it("flag allumé : le rendu serveur initial n'a ni iframe ni URL YouTube, mais le bouton et l'information", () => {
    vi.stubEnv("MEDIA_PRIVACY_ENABLED", "true");
    const html = renderToStaticMarkup(<GameTrailer videoId={VIDEO_ID} gameName="Hades" />);
    expect(html).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("youtube-nocookie");
    expect(html.toLowerCase()).not.toContain("ytimg");
    expect(html).not.toContain(VIDEO_ID);
    expect(html).not.toContain("<img");
    expect(html).toContain("Afficher la vidéo");
    expect(html).toContain("Cette vidéo vient de YouTube (Google) ; ton adresse IP lui sera transmise.");
  });

  it("flag allumé : l'iframe n'apparaît qu'après le clic, sur youtube-nocookie.com", () => {
    vi.stubEnv("MEDIA_PRIVACY_ENABLED", "true");
    const { container } = render(<GameTrailer videoId={VIDEO_ID} gameName="Hades" />);
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Afficher la vidéo" }));

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(new URL(iframe!.getAttribute("src")!).origin).toBe("https://www.youtube-nocookie.com");
    expect(iframe!.getAttribute("src")).toContain(`/embed/${VIDEO_ID}`);
    expect(iframe!.getAttribute("loading")).toBe("lazy");
    expect(iframe!.getAttribute("title")).toBe("Trailer de Hades");
    expect(iframe!.getAttribute("allow")).toContain("encrypted-media");
    expect(iframe!.hasAttribute("allowfullscreen")).toBe(true);
    expect(screen.queryByRole("button", { name: "Afficher la vidéo" })).toBeNull();
  });
});
