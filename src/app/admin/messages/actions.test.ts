import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { messageTemplate: { create: mocks.create, update: mocks.update } } }));

import { addMessageTemplate, updateMessageTemplate } from "./actions";
import { MAX_MESSAGE_TEXT_LENGTH } from "@/lib/message-templates";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("phrases Discord personnalisables : actions /admin/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
  });

  it("refuse l'accès à un non-admin (aucune écriture)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    await expect(addMessageTemplate(form({ text: "Salut {date}", "category-SESSION_CREATED": "on" }))).rejects.toThrow("redirect");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("enregistre un message valide avec les variables dérivées des catégories cochées", async () => {
    await addMessageTemplate(form({ text: "  Soirée le {date} à {heure} !  ", "category-SESSION_CREATED": "on" }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ text: "Soirée le {date} à {heure} !", categories: ["SESSION_CREATED"], createdById: "admin-1" }),
    });
  });

  it("refuse une variable non disponible pour une catégorie cochée (ajout et modification)", async () => {
    await addMessageTemplate(form({ text: "Rappel {jeu}", "category-SESSION_CREATED": "on" }));
    await updateMessageTemplate(form({ id: "t1", text: "Rappel {jeu}", "category-SESSION_CREATED": "on" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("la borne est exactement MAX_MESSAGE_TEXT_LENGTH : 1500 accepté, 1501 refusé (ajout et modification)", async () => {
    const categories = { "category-SESSION_CREATED": "on" };
    await addMessageTemplate(form({ text: "a".repeat(MAX_MESSAGE_TEXT_LENGTH), ...categories }));
    await updateMessageTemplate(form({ id: "t1", text: "a".repeat(MAX_MESSAGE_TEXT_LENGTH), ...categories }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await addMessageTemplate(form({ text: "a".repeat(MAX_MESSAGE_TEXT_LENGTH + 1), ...categories }));
    await updateMessageTemplate(form({ id: "t1", text: "a".repeat(MAX_MESSAGE_TEXT_LENGTH + 1), ...categories }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("les fins de ligne CRLF du navigateur comptent pour 1 caractère, comme dans le formulaire", async () => {
    // 21 lignes de 70 caractères séparées par CRLF : 1510 brut (> limite), 1490 une fois les sauts comptés pour 1.
    const lines = Array.from({ length: 21 }, () => "a".repeat(70)).join("\r\n");
    expect(lines.length).toBeGreaterThan(MAX_MESSAGE_TEXT_LENGTH);
    await addMessageTemplate(form({ text: lines, "category-SESSION_CREATED": "on" }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ text: lines.replace(/\r\n/g, "\n") }),
    });
  });

  it("refuse un texte plus long que la limite d'un message Discord (ajout et modification)", async () => {
    const text = "a".repeat(2001);
    await addMessageTemplate(form({ text, "category-SESSION_CREATED": "on" }));
    await updateMessageTemplate(form({ id: "t1", text, "category-SESSION_CREATED": "on" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("accepte un texte de 1000 caractères", async () => {
    await addMessageTemplate(form({ text: "a".repeat(1000), "category-SESSION_CREATED": "on" }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
