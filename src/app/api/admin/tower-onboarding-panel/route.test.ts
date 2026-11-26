import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  isTowerOwner: vi.fn(),
  towerGuildId: vi.fn(),
  isVercelPreview: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  recordSensitiveOperation: vi.fn(),
  publishTowerWelcomePanel: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdmin: () => mocks.requireAdmin() }));
vi.mock("@/lib/tower-config", () => ({
  isTowerOwner: (id: string) => mocks.isTowerOwner(id),
  towerGuildId: () => mocks.towerGuildId(),
}));
vi.mock("@/lib/preview-safety", () => ({ isVercelPreview: () => mocks.isVercelPreview() }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit: (...args: unknown[]) => mocks.checkSharedRateLimit(...args) }));
vi.mock("@/lib/sensitive-operation-log", () => ({ recordSensitiveOperation: (...args: unknown[]) => mocks.recordSensitiveOperation(...args) }));
vi.mock("@/lib/tower-onboarding-panel", () => ({ publishTowerWelcomePanel: (...args: unknown[]) => mocks.publishTowerWelcomePanel(...args) }));

import { POST } from "./route";

const publishRequest = (confirm = "PUBLIER_PANNEAU_TOWER") => new Request("https://gamenight.test/api/admin/tower-onboarding-panel", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirm }),
});

describe("POST /api/admin/tower-onboarding-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TOWER_DISCORD_WELCOME_CHANNEL_ID", "553922938101825539");
    mocks.requireAdmin.mockResolvedValue({ id: "owner-user", discordId: "699223334046531636" });
    mocks.isTowerOwner.mockReturnValue(true);
    mocks.towerGuildId.mockReturnValue("553922938101825536");
    mocks.isVercelPreview.mockReturnValue(false);
    mocks.checkSharedRateLimit.mockResolvedValue(true);
    mocks.recordSensitiveOperation.mockResolvedValue(undefined);
    mocks.publishTowerWelcomePanel.mockResolvedValue({
      ok: true, data: { messageId: "900000000000000001", channelId: "553922938101825539", alreadyPublished: false },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuse Preview avant toute vérification ou écriture", async () => {
    mocks.isVercelPreview.mockReturnValue(true);
    const response = await POST(publishRequest());
    expect(response.status).toBe(503);
    expect(mocks.publishTowerWelcomePanel).not.toHaveBeenCalled();
  });

  it("refuse un compte non administrateur et un admin qui n'est pas le propriétaire", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    expect((await POST(publishRequest())).status).toBe(403);
    mocks.requireAdmin.mockResolvedValue({ id: "other", discordId: "111111111111111111" });
    mocks.isTowerOwner.mockReturnValue(false);
    expect((await POST(publishRequest())).status).toBe(403);
    expect(mocks.publishTowerWelcomePanel).not.toHaveBeenCalled();
  });

  it("exige la confirmation textuelle exacte", async () => {
    const response = await POST(publishRequest("oui"));
    expect(response.status).toBe(400);
    expect(mocks.publishTowerWelcomePanel).not.toHaveBeenCalled();
  });

  it("limite la publication à une tentative par minute", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue(false);
    const response = await POST(publishRequest());
    expect(response.status).toBe(429);
    expect(mocks.publishTowerWelcomePanel).not.toHaveBeenCalled();
  });

  it("appelle le publier uniquement après les gardes et journalise une création effective", async () => {
    const response = await POST(publishRequest());
    expect(response.status).toBe(201);
    expect(mocks.publishTowerWelcomePanel).toHaveBeenCalledWith({
      guildId: "553922938101825536",
      channelId: "553922938101825539",
      deadline: expect.any(Date),
    });
    expect(mocks.recordSensitiveOperation).toHaveBeenCalledWith({
      actorId: "owner-user",
      action: "discord.welcome_panel_publish",
      outcome: "published",
      target: "900000000000000001",
    });
  });

  it("renvoie le panneau existant sans journaliser une nouvelle publication", async () => {
    mocks.publishTowerWelcomePanel.mockResolvedValue({
      ok: true, data: { messageId: "900000000000000001", channelId: "553922938101825539", alreadyPublished: true },
    });
    const response = await POST(publishRequest());
    expect(response.status).toBe(200);
    expect(mocks.recordSensitiveOperation).not.toHaveBeenCalled();
  });

  it("ne journalise rien et ne publie pas si Discord ne confirme pas le destinataire", async () => {
    mocks.publishTowerWelcomePanel.mockResolvedValue({
      ok: false, kind: "destination_mismatch", message: "wrong channel", retryable: false,
    });
    const response = await POST(publishRequest());
    expect(response.status).toBe(409);
    expect(mocks.recordSensitiveOperation).not.toHaveBeenCalled();
  });
});
