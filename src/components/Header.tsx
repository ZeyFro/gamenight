import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getUnreadNotificationCount, listRecentNotifications, groupNotifications } from "@/lib/notifications";
import { getChatMessages } from "@/lib/chat";
import { Logo } from "@/components/Logo";
import { Sidebar } from "@/components/app/Sidebar";
import { Avatar } from "@/components/ui/Avatar";
import { levelForXp } from "@/lib/xp";
import { NotificationBell, type NotificationItem } from "@/components/NotificationBell";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CommunitySwitcher } from "@/components/CommunitySwitcher";
import { getActiveCommunityState, isCommunityPickerEnabled, listPickableCommunities } from "@/lib/community-picker";

export async function Header() {
  // Feature "forcer la reconnexion globale" (PR 75) — `getCurrentUser()`
  // est la seule source de vérité "vraiment connecté" (voir commentaire
  // dans `page.tsx`) ; le gate du header s'appuie dessus plutôt que sur
  // `auth()` seul, sinon les liens de nav/cloche resteraient visibles
  // par-dessus l'écran de connexion après un déclenchement.
  const user = await getCurrentUser();
  const pickerEnabled = user && isCommunityPickerEnabled();
  const communities = pickerEnabled ? await listPickableCommunities(user.id) : [];
  const state = pickerEnabled ? await getActiveCommunityState(user.id) : null;
  const communityId = state?.kind === "single" || state?.kind === "chosen" ? state.communityId : null;

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
      getChatMessages(null, user.id),
    ]);
    unreadCount = count;
    notifications = await groupNotifications(recent, user.id);
    initialChatMessages = chatMessages;
  }

  return (
    <header className={`gn-topbar ${user ? "gn-topbar-authenticated" : ""} ${pickerEnabled ? "gn-topbar-with-picker" : ""}`}>
      <div className="gn-topbar-inner">
        <div className="flex min-w-0 items-center gap-3">
          {user && <Sidebar user={{ name: user.discordName, avatar: user.discordAvatar, level: levelForXp(user.xpTotal), xp: user.xpTotal }} />}
          <Link href="/" className={`shrink-0 ${user ? "lg:hidden" : ""}`} aria-label="GameNight — accueil"><Logo /></Link>
          {pickerEnabled && <CommunitySwitcher communities={communities} currentId={communityId} />}
          {user && !pickerEnabled && <span className="gn-eyebrow hidden lg:block">Ton prochain bon moment</span>}
        </div>
        {user && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Link href="/profil" className="gn-header-xp hidden xl:flex">✦ Niveau {levelForXp(user.xpTotal)} <span className="text-muted">· {user.xpTotal.toLocaleString("fr-FR")} XP</span></Link>
            {currentUser && (
              <ChatPanel
                key={communityId ?? "none"}
                currentUserId={currentUser.id}
                currentUserName={currentUser.discordName}
                currentUserAvatar={currentUser.discordAvatar}
                currentUserColor={currentUser.color}
                initialMessages={initialChatMessages}
              />
            )}
            <NotificationBell key={communityId ?? "none"} initialUnreadCount={unreadCount} notifications={notifications} />
            <Link href="/profil" aria-label="Ouvrir mon profil" className="hidden sm:block"><Avatar src={user.discordAvatar} alt="" size={32} /></Link>
          </div>
        )}
      </div>
    </header>
  );
}
