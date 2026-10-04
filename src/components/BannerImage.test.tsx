// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BannerImage } from "./BannerImage";

afterEach(() => {
  cleanup();
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalHeight;
});

/** Simule l'état de chargement d'un `<img>` au moment du montage (jsdom ne charge jamais d'image). */
function stubImageState(state: { complete: boolean; width: number; height: number }) {
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => state.complete });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => state.width });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => state.height });
}

const COLOR = "#8b5cf6";
const render_ = (url: string | null, className = "h-24 w-full") =>
  render(<BannerImage url={url} color={COLOR} className={className} />);

describe("BannerImage — rendu de repli sûr (GIF klipy bloqué par CORP/CORS)", () => {
  it("sans URL : dégradé de secours, aucune image", () => {
    const { container } = render_(null);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild?.className).toContain("h-24");
  });

  it.each([
    "https://klipy.com/gifs/chat-qui-danse",
    "https://www.klipy.com/gifs/x",
    "https://tenor.com/view/abc-123",
    "https://giphy.com/gifs/abc",
  ])("lien de PAGE connu (%s) : dégradé tout de suite, aucune image ni requête", (url) => {
    const { container } = render_(url);
    expect(container.querySelector("img")).toBeNull();
  });

  it("lien d'image klipy (static.klipy.com) : chargé normalement, sans Referer", () => {
    const { container } = render_("https://static.klipy.com/ii/abc/gif.gif");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://static.klipy.com/ii/abc/gif.gif");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.className).toContain("object-cover");
  });

  it("ancienne bannière sur un hôte hors liste blanche : affichée comme avant", () => {
    const { container } = render_("https://ancien-hebergeur.example/banniere.png");
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("échec APRÈS l'hydratation (événement error) : bascule sur le dégradé de secours", () => {
    stubImageState({ complete: false, width: 0, height: 0 });
    const { container } = render_("https://static.klipy.com/ii/bloque.gif");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild?.className).toContain("h-24");
  });

  it("échec AVANT l'hydratation (événement error perdu, image déjà terminée sans dimension) : rattrapé au montage", () => {
    stubImageState({ complete: true, width: 0, height: 0 });
    const { container } = render_("https://static.klipy.com/ii/bloque.gif");
    expect(container.querySelector("img")).toBeNull();
  });

  it("image déjà chargée avant l'hydratation (dimensions réelles) : jamais remplacée", () => {
    stubImageState({ complete: true, width: 480, height: 200 });
    const { container } = render_("https://static.klipy.com/ii/ok.gif");
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("image encore en cours de chargement : jamais prise pour un échec", () => {
    stubImageState({ complete: false, width: 0, height: 0 });
    const { container } = render_("https://static.klipy.com/ii/lent.gif");
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("nouvelle URL après un échec (composant resté monté) : la nouvelle image est tentée, pas condamnée au dégradé", () => {
    stubImageState({ complete: false, width: 0, height: 0 });
    const { container, rerender } = render_("https://static.klipy.com/ii/bloque.gif");
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();

    rerender(<BannerImage url="https://static.klipy.com/ii/autre.gif" color={COLOR} className="h-24 w-full" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://static.klipy.com/ii/autre.gif");
  });

  it("revenir à la même URL après un échec : toujours le dégradé (échec mémorisé pour cette URL)", () => {
    stubImageState({ complete: false, width: 0, height: 0 });
    const { container, rerender } = render_("https://static.klipy.com/ii/bloque.gif");
    fireEvent.error(container.querySelector("img")!);
    rerender(<BannerImage url="https://static.klipy.com/ii/bloque.gif" color={COLOR} className="h-24 w-full" />);
    expect(container.querySelector("img")).toBeNull();
  });
});
