import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/calendar-feed", () => ({ readCalendarFeed: mocks.read }));
import { GET } from "./route";

describe("flux iCal privé", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renvoie un calendrier sans cache ni fuite du lien dans son contenu", async () => {
    mocks.read.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    const response = await GET(new Request("https://gamenight.test/api/calendrier/feed/secret"), { params: Promise.resolve({ token: "secret" }) });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("secret", "https://gamenight.test");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).not.toContain("secret");
  });

  it("rend indistinguables les liens inconnus, révoqués ou devenus inaccessibles", async () => {
    mocks.read.mockResolvedValue(null);
    const response = await GET(new Request("https://gamenight.test/api/calendrier/feed/secret"), { params: Promise.resolve({ token: "secret" }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });
});
