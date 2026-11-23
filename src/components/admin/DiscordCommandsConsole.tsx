"use client";

import { useState, type FormEvent } from "react";

type Mode = "check" | "execute";
type CommandRow = { name: string; kind: "chat" | "message"; status: string };
type Report = {
  mode?: Mode;
  ok?: boolean;
  commands?: CommandRow[];
  outsideManifest?: number | null;
  failure?: { stage: string; command?: string; http?: number; code?: string; hint?: string; errorName?: string; retryAfterSeconds?: number } | null;
  error?: string;
};
type Outcome = { status: number; report: Report | null };

/** Explication de chaque statut de la route (mêmes cas que docs/SOIREE_ACTIVATION.md § 9 sexies). */
export const STATUS_HELP: Record<number, string> = {
  200: "Terminé.",
  202: "Enregistrement partiel : Discord limite le débit. Attends le délai indiqué puis clique à nouveau sur « Enregistrer » : les commandes déjà à jour sont sautées.",
  400: "Requête invalide.",
  401: "Secret faux, ou compte non administrateur / non connecté.",
  404: "Fonction éteinte : interrupteur ou secret absent côté serveur, ou Preview.",
  429: "Plus de 5 appels par minute : attends une minute.",
  502: "Discord a refusé ou n'a pas répondu : voir le détail ci-dessous.",
  503: "Configuration Discord absente ou invalide (application, jeton du bot ou serveur The Tower).",
};

/** Ordre et libellé des statuts dans le résumé. */
const STATUS_ORDER = ["enregistrée", "déjà à jour", "présente", "absente", "différente", "en attente", "échec"] as const;

/**
 * Formulaire de la route d'enregistrement. Le secret n'existe que dans la mémoire de la page (état React) : jamais
 * écrit dans le stockage du navigateur, jamais journalisé, jamais affiché. Il reste saisi entre deux appels pour
 * permettre de reprendre un enregistrement partiel, et disparaît avec « Effacer le secret » ou en quittant la page.
 */
export function DiscordCommandsConsole() {
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState<Mode | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run(mode: Mode) {
    if (!secret.trim() || pending) return;
    if (mode === "execute" && !window.confirm("Enregistrer les commandes du manifeste dans The Tower ? Aucune commande n'est supprimée.")) {
      return;
    }
    setPending(mode);
    setOutcome(null);
    try {
      const response = await fetch("/api/admin/discord-commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-registration-secret": secret },
        body: JSON.stringify({ mode }),
        cache: "no-store",
      });
      let report: Report | null = null;
      try {
        report = (await response.json()) as Report;
      } catch {
        report = null;
      }
      setOutcome({ status: response.status, report });
    } catch {
      setOutcome({ status: 0, report: null });
    } finally {
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("check");
  }

  const report = outcome?.report;
  const disabled = pending !== null || !secret.trim();

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border-2 border-border bg-surface p-4">
        <label htmlFor="registration-secret" className="text-sm font-medium text-foreground">
          Secret d’enregistrement
        </label>
        <input
          id="registration-secret"
          name="registration-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          className="rounded-lg border-2 border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <p className="text-xs text-muted">Il n’est ni enregistré ni journalisé. Il reste en mémoire de la page pour pouvoir reprendre, jusqu’à « Effacer le secret » ou la fermeture de la page.</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm text-foreground disabled:opacity-50"
          >
            {pending === "check" ? "Vérification…" : "Vérifier"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void run("execute")}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-50"
          >
            {pending === "execute" ? "Enregistrement… (jusqu’à 45 s)" : "Enregistrer"}
          </button>
          <button
            type="button"
            disabled={pending !== null || !secret}
            onClick={() => setSecret("")}
            className="rounded-lg px-4 py-2 text-sm text-muted underline disabled:opacity-50"
          >
            Effacer le secret
          </button>
        </div>
      </form>

      {outcome && (
        <section aria-label="Résultat" className="flex flex-col gap-3">
          <p role="status" className={outcome.status === 200 && report?.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
            {outcome.status === 0
              ? "Le serveur n'a pas répondu."
              : `HTTP ${outcome.status} · ${STATUS_HELP[outcome.status] ?? "Réponse inattendue."}`}
          </p>
          {report?.failure?.stage === "rate_limit" && (
            <p className="text-sm text-destructive">
              Discord limite le débit{report.failure.command ? ` (arrêt avant /${report.failure.command})` : ""}. Attends {report.failure.retryAfterSeconds ?? 30} s, puis
              clique à nouveau sur « Enregistrer » : les commandes déjà à jour sont sautées, aucune n’est supprimée.
            </p>
          )}
          {report?.failure && report.failure.stage !== "rate_limit" && (
            <p className="text-sm text-destructive">
              Échec à l’étape « {report.failure.stage} »
              {report.failure.command ? ` (commande /${report.failure.command})` : ""}
              {report.failure.http ? `, HTTP ${report.failure.http}` : ""}
              {report.failure.code ? `, code Discord ${report.failure.code}` : ""}
              {report.failure.errorName ? `, ${report.failure.errorName}` : ""}
              {report.failure.hint ? ` : ${report.failure.hint}` : "."}
            </p>
          )}
          {report?.commands && report.commands.length > 0 && (
            <p className="text-sm text-foreground" aria-label="Résumé">
              {STATUS_ORDER.map((status) => [status, report.commands!.filter((command) => command.status === status).length] as const)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => `${count} ${status}`)
                .join(" · ")}
              {" "}sur {report.commands.length} commandes.
            </p>
          )}
          {report?.commands && report.commands.length > 0 && (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Commandes du manifeste</caption>
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="py-2">Commande</th>
                  <th scope="col" className="py-2">Type</th>
                  <th scope="col" className="py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {report.commands.map((command) => (
                  <tr key={`${command.kind}:${command.name}`} className="border-b border-border">
                    <td className="py-2">{command.kind === "message" ? command.name : `/${command.name}`}</td>
                    <td className="py-2">{command.kind === "message" ? "clic droit" : "barre oblique"}</td>
                    <td className="py-2">{command.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {typeof report?.outsideManifest === "number" && (
            <p className="text-xs text-muted">{report.outsideManifest} commande(s) du serveur hors manifeste : non touchées.</p>
          )}
        </section>
      )}
    </div>
  );
}
