import { isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: "fixture", discordName: "Recette", color: "blue", xpTotal: 0 }) }));
vi.mock("@/lib/notifications", () => ({ getUnreadNotificationCount: async () => 0, listRecentNotifications: async () => [], groupNotifications: async () => [] }));
vi.mock("@/lib/chat", () => ({ getChatMessages: async () => [] }));
vi.mock("@/lib/community-picker", () => ({ isCommunityPickerEnabled: () => false }));
vi.mock("@/lib/community-read-context", () => ({ withCommunityReadContext: (render: () => unknown) => render() }));
vi.mock("@/components/app/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/chat/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/CommunitySwitcher", () => ({ CommunitySwitcher: () => null }));

import { Header } from "./Header";

it("garde des clés distinctes entre widgets frères du header authentifié", async () => {
  function check(node: ReactNode): void {
    if (!isValidElement<{ children?: ReactNode }>(node)) return;
    const children = [node.props.children].flat(Infinity) as ReactNode[];
    const keys = children.filter(isValidElement).map(child => child.key).filter(key => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
    children.forEach(check);
  }
  check(await Header());
});
