import { INPUT_DEVICES, PLAYER_PLATFORMS, type PlayerEquipmentData } from "@/lib/player-equipment";
import { updatePlayerEquipmentAction } from "@/app/profil/player-equipment-actions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const FEEDBACK: Record<string, string> = {
  ok: "Ton matériel de jeu a été enregistré.",
  invalide: "Choisis les options proposées pour ton matériel et tes plateformes.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

export function PlayerEquipmentForm({ user, feedback }: { user: PlayerEquipmentData; feedback?: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Mon matériel de jeu</h2>
      <p className="text-sm text-muted">Partage les commandes et plateformes que tu peux utiliser, ainsi que la disponibilité de ton micro. Ces informations sont visibles par les membres autorisés à consulter ta fiche et ne filtrent pas automatiquement les jeux.</p>
      {feedback && FEEDBACK[feedback] && <p role={feedback === "ok" ? "status" : "alert"} className="text-sm">{FEEDBACK[feedback]}</p>}
      <form action={updatePlayerEquipmentAction} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Commandes disponibles</legend>
          {INPUT_DEVICES.map(option => <label key={option.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inputDevices" value={option.key} defaultChecked={user.inputDevices.includes(option.key)} />{option.label}
          </label>)}
        </fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Plateformes disponibles</legend>
          {PLAYER_PLATFORMS.map(option => <label key={option.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="availablePlatforms" value={option.key} defaultChecked={user.availablePlatforms.includes(option.key)} />{option.label}
          </label>)}
        </fieldset>
        <div>
          <label htmlFor="player-microphone" className="mb-1 block text-sm font-medium">Micro disponible</label>
          <select id="player-microphone" name="microphoneAvailable" defaultValue={user.microphoneAvailable === null ? "" : user.microphoneAvailable ? "yes" : "no"} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
            <option value="">Non renseigné</option><option value="yes">Oui</option><option value="no">Non</option>
          </select>
        </div>
        <p className="text-sm text-muted">Décoche les options et choisis « Non renseigné » pour effacer ces informations.</p>
        <Button type="submit" variant="primary">Enregistrer mon matériel</Button>
      </form>
    </Card>
  );
}
