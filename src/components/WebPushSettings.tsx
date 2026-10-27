"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function WebPushSettings({ publicKey, misconfigured = false }: { publicKey: string | null; misconfigured?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => undefined);
  }, [publicKey]);

  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.register("/service-worker.js");
      const current = await registration.pushManager.getSubscription();
      if (current) {
        const response = await fetch("/api/push/subscription", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: current.endpoint }) });
        if (!response.ok) throw new Error();
        await current.unsubscribe();
        setEnabled(false);
        setMessage("Notifications push désactivées sur cet appareil.");
      } else {
        if (!publicKey) throw new Error();
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error();
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
        const response = await fetch("/api/push/subscription", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
        if (!response.ok) {
          await subscription.unsubscribe();
          const error = await response.json().then((body: { error?: string }) => body.error).catch(() => undefined);
          throw new Error(error);
        }
        setEnabled(true);
        setMessage("Notifications push activées sur cet appareil.");
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(
        code === "not_configured" ? "Les notifications push ne sont pas disponibles : le serveur n’est pas configuré correctement. Préviens un administrateur."
        : code === "device_limit" ? "Tu as déjà 5 appareils abonnés : désactive-en un avant d’en ajouter."
        : code === "subscription_in_use" ? "Cet appareil est déjà abonné avec un autre compte."
        : "Impossible de modifier les notifications push. Vérifie les autorisations du navigateur.");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Les notifications de GameNight peuvent apparaître sur cet appareil quand le navigateur l’autorise.</p>
      {publicKey
        ? <Button type="button" variant="secondary" disabled={busy} onClick={toggle}>{busy ? "Mise à jour…" : enabled ? "Désactiver sur cet appareil" : "Activer sur cet appareil"}</Button>
        : <p className="text-sm text-muted">{misconfigured
          ? "Les notifications push sont indisponibles : la configuration du serveur est incomplète ou invalide. Préviens un administrateur."
          : "Les notifications push sont désactivées par l’administrateur."}</p>}
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </div>
  );
}
