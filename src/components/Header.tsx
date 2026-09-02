import Link from "next/link";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { getUnreadNotificationCount, listRecentNotifications, notificationHref } from "@/lib/notifications";
import { Logo } from "@/components/Logo";
import { HeaderNavLinks } from "@/components/HeaderNavLinks";
import { NotificationBell, type NotificationItem } from "@/components/NotificationBell";

export async function Header() {
  const session = await auth();

  // Cloche de notifications (Sprint 2 PR-C, U3) — dans le header plutôt
  // que la BottomNav mobile (dont la grille à 6 cases est dédiée aux
  // routes principales) : le header sticky reste visible en haut sur
  // toutes les tailles d'écran, contrairement aux liens de nav desktop
  // juste en dessous (`hidden sm:flex`).
  let unreadCount = 0;
  let notifications: NotificationItem[] = [];
  if (session?.user) {
    const user = await getCurrentUser();
    if (user) {
      const [count, recent] = await Promise.all([
        getUnreadNotificationCount(user.id),
        listRecentNotifications(user.id, 20),
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
            <NotificationBell initialUnreadCount={unreadCount} notifications={notifications} />
          </div>
        )}
      </div>
    </header>
  );
}
