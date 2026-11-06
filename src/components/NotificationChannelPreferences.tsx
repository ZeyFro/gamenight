import type { UserNotificationCategory, UserNotificationChannel } from "@prisma/client";
import { updateNotificationChannelPreferenceAction } from "@/app/profil/notification-channel-actions";
import { AVAILABLE_NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_DETAILS } from "@/lib/notification-preferences";
import { availableChannelsForCategory } from "@/lib/notification-channel-preferences";
import { Button } from "@/components/ui/Button";

const CHANNEL_LABELS: Record<UserNotificationChannel, string> = {
  IN_APP: "Dans GameNight",
  WEB_PUSH: "Notification push",
  DISCORD_DM: "Message privé Discord",
  DISCORD_MENTION: "Mention dans un salon",
};

type StoredChannelPreference = {
  category: UserNotificationCategory;
  channel: UserNotificationChannel;
  enabled: boolean;
};

export function NotificationChannelPreferences({
  preferences,
}: {
  preferences: StoredChannelPreference[];
}) {
  return (
    <section aria-labelledby="notification-channels-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="notification-channels-heading" className="font-medium text-foreground">Choisir les canaux</h3>
        <p className="text-sm text-muted">
          Chaque canal reste activé par défaut. Un réglage de catégorie désactivé continue de tout couper pour cette catégorie.
          Les annonces collectives sans mention restent visibles dans leurs salons.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {AVAILABLE_NOTIFICATION_CATEGORIES.map((category) => {
          const channels = availableChannelsForCategory(category);
          return (
            <div key={category} className="flex flex-col gap-3 p-4">
              <div>
                <p className="font-medium text-foreground">{NOTIFICATION_CATEGORY_DETAILS[category].label}</p>
                <p className="text-xs text-muted">Réglage des canaux disponibles pour cette catégorie.</p>
              </div>
              <ul className="flex flex-col gap-2">
                {channels.map((channel) => {
                  const enabled = preferences.find((preference) =>
                    preference.category === category && preference.channel === channel
                  )?.enabled ?? true;
                  return (
                    <li key={channel} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">{CHANNEL_LABELS[channel]}</span>
                      <form action={updateNotificationChannelPreferenceAction}>
                        <input type="hidden" name="category" value={category} />
                        <input type="hidden" name="channel" value={channel} />
                        <input type="hidden" name="enabled" value={String(!enabled)} />
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          aria-label={`${enabled ? "Désactiver" : "Activer"} ${CHANNEL_LABELS[channel]} pour ${NOTIFICATION_CATEGORY_DETAILS[category].label}`}
                        >
                          {enabled ? "Désactiver" : "Activer"}
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
