export const MAX_EXPRESSION_TITLE_LENGTH = 120;
export const MAX_EXPRESSION_MEANING_LENGTH = 2000;

export function isCommunityExpressionsEnabled(): boolean {
  return process.env.COMMUNITY_EXPRESSIONS_ENABLED === "true";
}

export function parseCommunityExpression(title: unknown, meaning: unknown) {
  if (typeof title !== "string" || typeof meaning !== "string") return null;
  const value = { title: title.trim(), meaning: meaning.trim() };
  if (!value.title || !value.meaning || value.title.length > MAX_EXPRESSION_TITLE_LENGTH || value.meaning.length > MAX_EXPRESSION_MEANING_LENGTH) return null;
  return value;
}
