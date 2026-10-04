import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { translateToFrench } from "./deepl";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DEEPL_API_KEY", "cle-test:fx");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("translateToFrench", () => {
  it("renvoie null sans clé, sans appeler le réseau", async () => {
    vi.stubEnv("DEEPL_API_KEY", "   ");
    expect(await translateToFrench("Hello")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("renvoie null pour un texte vide, sans appeler le réseau", async () => {
    expect(await translateToFrench("  ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("appelle l'endpoint Free avec la clé et la langue cible FR", async () => {
    fetchMock.mockResolvedValue(ok({ translations: [{ text: "Bonjour" }] }));
    expect(await translateToFrench("Hello")).toBe("Bonjour");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("DeepL-Auth-Key cle-test:fx");
    expect(init.body.get("target_lang")).toBe("FR");
    expect(init.body.get("text")).toBe("Hello");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("avertit si la clé n'a pas le suffixe :fx mais appelle quand même", async () => {
    vi.stubEnv("DEEPL_API_KEY", "cle-pro");
    fetchMock.mockResolvedValue(ok({ translations: [{ text: "Salut" }] }));
    expect(await translateToFrench("Hi")).toBe("Salut");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("renvoie null et logue une erreur sur réponse non-ok (403)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" });
    expect(await translateToFrench("Hello")).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it("renvoie null sur erreur réseau, sans exception", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    expect(await translateToFrench("Hello")).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it("renvoie null si la réponse 200 n'a aucune traduction", async () => {
    fetchMock.mockResolvedValue(ok({ translations: [] }));
    expect(await translateToFrench("Hello")).toBeNull();
  });
});
