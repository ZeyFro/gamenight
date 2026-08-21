import type { SessionStatus } from "@prisma/client";

export const SESSION_STATUS_LABELS: Record<
  SessionStatus,
  { label: string; className: string }
> = {
  VOTING: {
    label: "Vote en cours",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  },
  SCHEDULED: {
    label: "Prévue",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  DONE: {
    label: "Terminée",
    className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  CANCELLED: {
    label: "Annulée",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
};
