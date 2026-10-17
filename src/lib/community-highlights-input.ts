import { z } from "zod";

export const isCommunityHighlightsEnabled = () => process.env.COMMUNITY_HIGHLIGHTS_ENABLED === "true";

export const highlightInput = z.object({
  kind: z.enum(["FAME", "SHAME"]),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(4000),
  mediaUrl: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }).transform(value => value || null),
}).strict();
