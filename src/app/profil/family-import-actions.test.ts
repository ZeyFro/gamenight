import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, matchGameName } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  matchGameName: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/badges", () => ({ checkLibraryBadges: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/steam", () => ({ importSteamLibrary: vi.fn() }));
vi.mock("@/lib/family-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/family-import")>()),
  matchGameName,
}));

import { matchFamilyImportBatch } from "./family-import-actions";
import { FAMILY_IMPORT_BATCH_SIZE, FAMILY_IMPORT_MAX_NAME_LENGTH } from "@/lib/family-import";

describe("matchFamilyImportBatch — plafonds côté serveur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "u1" });
    matchGameName.mockResolvedValue({ status: "needsConfirmation", candidate: null, confidence: 0 });
  });

  it("lot plus grand que FAMILY_IMPORT_BATCH_SIZE → refusé, aucune recherche IGDB", async () => {
    const names = Array.from({ length: FAMILY_IMPORT_BATCH_SIZE + 1 }, (_, i) => `Jeu ${i}`);

    await expect(matchFamilyImportBatch(names)).rejects.toThrow();
    expect(matchGameName).not.toHaveBeenCalled();
  });

  it("lot de la taille maximale → traité", async () => {
    const names = Array.from({ length: FAMILY_IMPORT_BATCH_SIZE }, (_, i) => `Jeu ${i}`);

    const results = await matchFamilyImportBatch(names);

    expect(results).toHaveLength(FAMILY_IMPORT_BATCH_SIZE);
    expect(matchGameName).toHaveBeenCalledTimes(FAMILY_IMPORT_BATCH_SIZE);
  });

  it("nom trop long → needsConfirmation sans recherche IGDB", async () => {
    const tooLong = "x".repeat(FAMILY_IMPORT_MAX_NAME_LENGTH + 1);

    const results = await matchFamilyImportBatch([tooLong, "Portal"]);

    expect(results[0]).toMatchObject({ input: tooLong, outcome: "needsConfirmation", suggestion: null });
    expect(matchGameName).toHaveBeenCalledTimes(1);
    expect(matchGameName).toHaveBeenCalledWith("Portal");
  });

  it("entrée qui n'est pas un tableau de chaînes → refusée", async () => {
    await expect(matchFamilyImportBatch("Portal" as unknown as string[])).rejects.toThrow();
    await expect(matchFamilyImportBatch([42 as unknown as string])).rejects.toThrow();
    expect(matchGameName).not.toHaveBeenCalled();
  });
});
