import Link from "next/link";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { getUnreadNotificationCount, listRecentNotifications, notificationHref } from "@/lib/notifications";
import { getChatMessages } from "@/lib/chat";
import { Logo } from "@/components/Logo";
import { HeaderNavLinks } from "@/components/HeaderNavLinks";
import { NotificationBell, type NotificationItem } from "@/components/NotificationBell";
import { ChatPanel } from "@/components/chat/ChatPanel";

export async function Header() {
  const session = await auth();

  // Cloche de notifications (Sprint 2 PR-C, U3) — dans le header plutôt
  // que la BottomNav mobile (dont la grille à 6 cases est dédiée aux
  // routes principales) : le header sticky reste visible en haut sur
  // toutes les tailles d'écran, contrairement aux liens de nav desktop
  // juste en dessous (`hidden sm:flex`).
  let unreadCount = 0;
  let notifications: NotificationItem[] = [];
  let currentUser: { id: string; discordName: string; discordAvatar: string | null; color: string } | null =
    null;
  let initialChatMessages: Awaited<ReturnType<typeof getChatMessages>> = [];
  if (session?.user) {
    const user = await getCurrentUser();
    if (user) {
      currentUser = {
        id: user.id,
        discordName: user.discordName,
        discordAvatar: user.discordAvatar,
        color: user.color,
      };
      const [count, recent, chatMessages] = await Promise.all([
        getUnreadNotificationCount(user.id),
        listRecentNotifications(user.id, 20),
        getChatMessages(null),
      ]);
      unreadCount = count;
      notifications = recent.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAtIso: n.createdAt.toISOString(),
        href: notificationHref(n),
      }));
      initialChatMessages = chatMessages;
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        {session?.user && (
          <div className="flex items-center gap-1">
            <nav className="hidden items-center gap-1 sm:flex">
              <HeaderNavLinks />
            </nav>
            {currentUser && (
              <ChatPanel
                currentUserId={currentUser.id}
                currentUserName={currentUser.discordName}
                currentUserAvatar={currentUser.discordAvatar}
                currentUserColor={currentUser.color}
                initialMessages={initialChatMessages}
              />
            )}
            <NotificationBell initialUnreadCount={unreadCount} notifications={notifications} />
          </div>
        )}
      </div>
    </header>
  );
}
