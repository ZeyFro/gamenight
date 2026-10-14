"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateUserColor } from "@/app/profil/actions";
import {
  USER_COLOR_PALETTE,
  hexToRgb,
  isValidHexColor,
  rgbToHex,
  type Rgb,
} from "@/lib/user-color";

const RGB_CHANNELS: { key: keyof Rgb; label: string }[] = [
  { key: "r", label: "R" },
  { key: "g", label: "G" },
  { key: "b", label: "B" },
];

/**
 * "Ma couleur" sur `/profil/parametres` (PR 4/4, sous-PR 1) — deux
 * méthodes qui coexistent plutôt que de se remplacer :
 * - **Palette rapide** : boutons ronds, application immédiate au tap
 *   (même logique que les toggles rapides déjà établis dans l'app, ex.
 *   "Marquer comme coop" — pas besoin d'une étape de confirmation pour un
 *   choix parmi 10 couleurs pré-validées).
 * - **Couleur personnalisée** : input hex + 3 sliders RVB (avec valeur
 *   numérique éditable à côté de chacun, synchronisés entre eux et avec le
 *   champ hex), preview live, bouton "Appliquer" explicite — ici on laisse
 *   l'utilisateur affiner avant de valider, contrairement à la palette.
 */
export function ColorPickerField({ currentColor }: { currentColor: string }) {
  const [color, setColor] = useState(currentColor);
  const [isPending, startTransition] = useTransition();

  const initialRgb = hexToRgb(currentColor) ?? { r: 139, g: 92, b: 246 };
  const [rgb, setRgb] = useState<Rgb>(initialRgb);
  const [hexInput, setHexInput] = useState(currentColor.toUpperCase());

  function apply(next: string) {
    if (!isValidHexColor(next)) return;
    setColor(next);
    const formData = new FormData();
    formData.set("color", next);
    startTransition(async () => {
      await updateUserColor(formData);
      toast.success("Couleur mise à jour");
    });
  }

  function applyPalette(hex: string) {
    apply(hex);
    setRgb(hexToRgb(hex)!);
    setHexInput(hex.toUpperCase());
  }

  function handleHexInputChange(value: string) {
    setHexInput(value);
    if (isValidHexColor(value)) setRgb(hexToRgb(value)!);
  }

  function handleChannelChange(channel: keyof Rgb, raw: number) {
    const clamped = Number.isFinite(raw) ? Math.min(255, Math.max(0, Math.round(raw))) : 0;
    const nextRgb = { ...rgb, [channel]: clamped };
    setRgb(nextRgb);
    setHexInput(rgbToHex(nextRgb));
  }

  const draftHex = isValidHexColor(hexInput) ? hexInput : rgbToHex(rgb);

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-muted">Palette rapide</legend>
        <div className="flex flex-wrap gap-2">
          {USER_COLOR_PALETTE.map(({ hex, label }) => (
            <button
              key={hex}
              type="button"
              disabled={isPending}
              onClick={() => applyPalette(hex)}
              aria-label={`Choisir ${label}`}
              aria-pressed={color.toLowerCase() === hex.toLowerCase()}
              title={label}
              className={`h-9 w-9 shrink-0 rounded-full border-2 transition-transform disabled:opacity-50 ${
                color.toLowerCase() === hex.toLowerCase()
                  ? "scale-110 border-foreground"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
        <legend className="-mt-4 mb-1 bg-surface pr-2 text-xs font-medium text-muted">
          Couleur personnalisée
        </legend>

        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-full ring-2 ring-border"
            style={{ backgroundColor: draftHex }}
          />
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="color-hex" className="text-xs text-muted">
              Code hex
            </label>
            <input
              id="color-hex"
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              placeholder="#FFFFFF"
              maxLength={7}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {RGB_CHANNELS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-xs font-semibold text-muted">{label}</span>
              <input
                type="range"
                min={0}
                max={255}
                value={rgb[key]}
                aria-label={`Composante ${label} (0-255)`}
                onChange={(e) => handleChannelChange(key, Number(e.target.value))}
                className="w-full accent-accent"
              />
              <input
                type="number"
                min={0}
                max={255}
                value={rgb[key]}
                aria-label={`Valeur ${label} (0-255)`}
                onChange={(e) => handleChannelChange(key, Number(e.target.value))}
                className="w-16 shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={isPending || !isValidHexColor(draftHex)}
          onClick={() => apply(draftHex)}
          className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Appliquer
        </button>
      </fieldset>
    </div>
  );
}
