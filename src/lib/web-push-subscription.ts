export type WebPushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  const allowedHost = host === "fcm.googleapis.com" || host === "web.push.apple.com" || host.endsWith(".push.services.mozilla.com");
  return url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password && allowedHost;
}

function hasLength(value: string, length: number): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, "base64url").length === length;
}

export function parseWebPushSubscription(value: unknown): WebPushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<WebPushSubscriptionInput>;
  if (!isAllowedPushEndpoint(input.endpoint) || !input.keys || typeof input.keys !== "object") return null;
  if (!hasLength(input.keys.p256dh, 65) || !hasLength(input.keys.auth, 16)) return null;
  return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
