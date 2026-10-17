import { z } from "zod";

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine((value) => {
  const date = new Date(`${value}:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 16) === value;
}).transform((value) => new Date(`${value}:00.000Z`));

function isFrenchStoreUrl(store: "STEAM" | "EPIC", value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (store === "STEAM") {
      return url.hostname === "store.steampowered.com" && /^\/app\/\d+(?:\/|$)/.test(url.pathname) && url.searchParams.get("l") === "french";
    }
    return url.hostname === "store.epicgames.com" && url.pathname.startsWith("/fr/");
  } catch {
    return false;
  }
}

export const freeGameOfferSchema = z.object({
  store: z.enum(["STEAM", "EPIC"]),
  title: z.string().trim().min(1).max(120),
  storeUrl: z.string().url(),
  startsAt: localDateTime,
  endsAt: localDateTime,
}).superRefine((offer, ctx) => {
  if (!isFrenchStoreUrl(offer.store, offer.storeUrl)) {
    ctx.addIssue({ code: "custom", path: ["storeUrl"], message: "Lien de boutique FR non valide." });
  }
  if (offer.endsAt <= offer.startsAt) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La fin doit suivre le début." });
  }
  if (offer.endsAt.getTime() - offer.startsAt.getTime() > 31 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Une offre ne peut pas dépasser 31 jours." });
  }
});
