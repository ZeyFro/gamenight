import { z } from "zod";

export const INPUT_DEVICES = [
  { key: "KEYBOARD_MOUSE", label: "Clavier et souris" },
  { key: "CONTROLLER", label: "Manette" },
] as const;

export const PLAYER_PLATFORMS = [
  { key: "WINDOWS", label: "Windows" },
  { key: "MACOS", label: "macOS" },
  { key: "LINUX", label: "Linux / Steam Deck" },
  { key: "PLAYSTATION", label: "PlayStation" },
  { key: "XBOX", label: "Xbox" },
  { key: "SWITCH", label: "Nintendo Switch" },
  { key: "ANDROID", label: "Android" },
  { key: "IOS", label: "iOS" },
] as const;

export const playerEquipmentSchema = z.object({
  inputDevices: z.array(z.enum(INPUT_DEVICES.map(option => option.key))).max(2).transform(values => [...new Set(values)]),
  availablePlatforms: z.array(z.enum(PLAYER_PLATFORMS.map(option => option.key))).max(8).transform(values => [...new Set(values)]),
  microphoneAvailable: z.enum(["", "yes", "no"]).transform(value => value === "" ? null : value === "yes"),
});

export interface PlayerEquipmentData {
  inputDevices: string[];
  availablePlatforms: string[];
  microphoneAvailable: boolean | null;
}
