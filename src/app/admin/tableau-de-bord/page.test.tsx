import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), load: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }), redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/admin-dashboard-v2", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin-dashboard-v2")>()), loadAdminDashboardV2: mocks.load }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import AdminDashboardV2Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin" });
  mocks.load.mockResolvedValue({
    generatedAt: new Date(),
    communities: [],
    failedOperations: [],
    roleCapacityAlerts: 0,
    totals: { pendingApplications: 0, openAppeals: 0, overdueAppeals: 0, archivedSpaces: 0, failedOperations: 0 },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("/admin/tableau-de-bord — accès", () => {
  it("drapeau éteint : 404 avant toute lecture", async () => {
    await expect(AdminDashboardV2Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("non-admin : redirection, aucune donnée chargée", async () => {
    vi.stubEnv("ADMIN_DASHBOARD_V2_ENABLED", "true");
    mocks.requireAdmin.mockResolvedValue(null);
    await expect(AdminDashboardV2Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("admin : charge le tableau de bord", async () => {
    vi.stubEnv("ADMIN_DASHBOARD_V2_ENABLED", "true");
    const element = await AdminDashboardV2Page();
    expect(element).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
});
