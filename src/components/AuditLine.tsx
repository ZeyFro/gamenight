import { Avatar } from "@/components/ui/Avatar";
import { formatDateTimeFr } from "@/lib/wallclock";

/**
 * Ligne d'audit discrète "Modifié par {avatar} {pseudo} le {date}" —
 * réutilisée sur /admin/messages et /admin/jeux-stats. Affichage seul,
 * aucun blocage de modification : sert juste à dissuader/tracer un abus
 * (ex. quelqu'un qui truque un superlatif pour se farmer de l'XP), pas à
 * l'empêcher — pas de rôle admin dédié dans ce MVP.
 */
export function AuditLine({
  discordName,
  discordAvatar,
  date,
  compact = false,
}: {
  discordName: string;
  discordAvatar: string | null;
  date: Date;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className="flex items-center gap-1 text-[11px] text-faint"
        title={`Modifié par ${discordName} le ${formatDateTimeFr(date)}`}
      >
        <Avatar src={discordAvatar} alt={discordName} size={16} />
        {formatDateTimeFr(date)}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-faint">
      <Avatar src={discordAvatar} alt={discordName} size={18} />
      Modifié par {discordName} le {formatDateTimeFr(date)}
    </span>
  );
}
