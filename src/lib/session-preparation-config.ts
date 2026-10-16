export const isSessionPreparationEnabled = () => process.env.SESSION_PREPARATION_ENABLED === "true";
export const preparationLabels = {
  installed: "Installé",
  updated: "Mis à jour",
  microphone: "Micro testé",
  lobby: "Lobby prêt",
} as const;
