import { createECDH } from "node:crypto";

export type WebPushConfig = { subject: string; publicKey: string; privateKey: string };
/** `variables` ne contient que des NOMS de variables, jamais de valeurs. */
export type WebPushConfigIssue = { code: "disabled" | "incomplete" | "invalid"; variables: string[] };

const NAMES = ["WEB_PUSH_VAPID_SUBJECT", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY"] as const;

function base64urlBytes(value: string, length: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === length ? bytes : null;
}

function validSubject(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "mailto:" ? url.pathname.includes("@") : url.protocol === "https:";
  } catch { return false; }
}

function keysMatch(publicKey: string, privateKey: string): boolean {
  const publicBytes = base64urlBytes(publicKey, 65);
  const privateBytes = base64urlBytes(privateKey, 32);
  if (!publicBytes || !privateBytes) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateBytes);
    return ecdh.getPublicKey().equals(publicBytes);
  } catch { return false; }
}

export function webPushConfigIssue(env: Record<string, string | undefined>): WebPushConfigIssue | null {
  if (env.WEB_PUSH_ENABLED !== "true") return { code: "disabled", variables: [] };
  const missing = NAMES.filter((name) => !env[name]?.trim());
  if (missing.length) return { code: "incomplete", variables: missing };
  const subject = env.WEB_PUSH_VAPID_SUBJECT!.trim();
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY!.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY!.trim();
  const invalid: string[] = [];
  if (!validSubject(subject)) invalid.push(NAMES[0]);
  if (!keysMatch(publicKey, privateKey)) invalid.push(NAMES[1], NAMES[2]);
  return invalid.length ? { code: "invalid", variables: invalid } : null;
}

export function webPushConfig(env: Record<string, string | undefined>): WebPushConfig | null {
  if (webPushConfigIssue(env)) return null;
  return {
    subject: env.WEB_PUSH_VAPID_SUBJECT!.trim(),
    publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY!.trim(),
    privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY!.trim(),
  };
}

/** Message d'opérateur (journal) : noms de variables seulement. */
export function webPushIssueMessage(issue: WebPushConfigIssue): string {
  return issue.code === "incomplete"
    ? `Web Push allumé mais variables absentes : ${issue.variables.join(", ")}.`
    : `Web Push allumé mais configuration VAPID invalide (${issue.variables.join(", ")}) : paire de clés illisible ou dépareillée, ou sujet qui n'est ni mailto: ni https://.`;
}
