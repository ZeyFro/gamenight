import { INPUT_DEVICES, PLAYER_PLATFORMS, type PlayerEquipmentData } from "@/lib/player-equipment";

/** L'appelant autorise le profil avant de charger ces données. */
export function PlayerEquipment({ user }: { user: PlayerEquipmentData }) {
  const devices = INPUT_DEVICES.filter(option => user.inputDevices.includes(option.key)).map(option => option.label);
  const platforms = PLAYER_PLATFORMS.filter(option => user.availablePlatforms.includes(option.key)).map(option => option.label);
  if (!devices.length && !platforms.length && user.microphoneAvailable === null) return null;
  return (
    <section aria-label="Matériel de jeu" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">Matériel de jeu</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Commandes disponibles</dt><dd>{devices.join(", ") || "Non renseignées"}</dd></div>
        <div><dt className="text-xs text-muted">Plateformes disponibles</dt><dd>{platforms.join(", ") || "Non renseignées"}</dd></div>
        <div><dt className="text-xs text-muted">Micro</dt><dd>{user.microphoneAvailable === null ? "Non renseigné" : user.microphoneAvailable ? "Disponible" : "Non disponible"}</dd></div>
      </dl>
    </section>
  );
}
