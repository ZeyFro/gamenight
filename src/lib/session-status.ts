import type { SessionStatus } from "@prisma/client";

export const SESSION_STATUS_LABELS: Record<
  SessionStatus,
  { label: string; className: string }
> = {
  VOTING: { label: "Vote en cours", className: "bg-accent/15 text-accent" },
  SCHEDULED: {
    label: "Prévue",
    className: "bg-accent text-accent-foreground",
  },
  DONE: { label: "Terminée", className: "bg-white/5 text-muted" },
  CANCELLED: {
    label: "Annulée",
    className: "bg-destructive/15 text-destructive",
  },
};
