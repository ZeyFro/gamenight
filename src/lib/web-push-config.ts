export type WebPushConfig = { subject: string; publicKey: string; privateKey: string };

export function webPushConfig(env: Record<string, string | undefined>): WebPushConfig | null {
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim();
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (env.WEB_PUSH_ENABLED !== "true" || !subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}
