export const WISHLIST_PURCHASE_PLAN_NOTE_MAX_LENGTH = 300;

export type WishlistPurchasePlanInput = {
  targetDate: Date;
  note: string | null;
};

/** Parse une date calendrier UTC et une note facultative, sans montant ni engagement. */
export function parseWishlistPurchasePlanInput(
  dateValue: unknown,
  noteValue: unknown,
  now = new Date(),
): WishlistPurchasePlanInput | null {
  if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  if (typeof noteValue !== "string") return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const targetDate = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    targetDate.getUTCFullYear() !== year ||
    targetDate.getUTCMonth() !== month - 1 ||
    targetDate.getUTCDate() !== day
  ) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (targetDate.getTime() < today) return null;

  const note = noteValue.trim();
  if (note.length > WISHLIST_PURCHASE_PLAN_NOTE_MAX_LENGTH) return null;
  return { targetDate, note: note || null };
}
