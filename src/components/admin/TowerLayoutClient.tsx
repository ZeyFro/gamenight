"use client";
import { useEffect, useState } from "react";

type Item = { operation: string; category: string; name: string };
type Preview = {
  actions?: Item[]; errors?: string[]; archivesDeferred?: string[];
  totalChannels?: number; mode?: string; writeEnabled?: boolean; error?: string;
};

export default function TowerLayoutAdmin() {
  const [state, setState] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/tower-layout", { cache: "no-store" });
      const result = await response.json() as Preview;
      if (!response.ok || result.error) throw Error(result.error || "HTTP " + response.status);
      setState(result);
      setProblem("");
    } catch (e) {
      setState(null);
      setProblem(e instanceof Error ? e.message : "Inventaire Discord inaccessible");
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);

  return <main style={{ maxWidth: 860, margin: "2rem auto", padding: 24 }}>
    <h1>🏰 The Tower — État des salons Discord</h1>
    <p><strong>Mode lecture seule.</strong> La réorganisation automatique est suspendue pour éviter de recréer les salons d’accueil, de tickets, de sanctions et de modération déjà existants. Aucune action de cette page ne modifie Discord.</p>
    <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Vérification en cours…" : "↻ Actualiser l’inventaire"}</button>
    {!!problem && <p role="alert">Impossible de charger l’inventaire : {problem}. Connecte-toi avec le compte Discord propriétaire.</p>}
    <p>Salons détectés : {state?.totalChannels ?? "—"} • Opérations envisagées, non autorisées : {state?.actions?.length ?? "—"}</p>
    {!!state?.errors?.length && <div role="alert"><strong>Éléments à vérifier :</strong><ul>{state.errors.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    <h2>Propositions à examiner, pas à exécuter</h2>
    <ul>{(state?.actions || []).map((x, i) => <li key={i}>{x.operation} — {x.name}</li>)}</ul>
    <h2>Audit du contenu et des bots existants</h2>
    <p><a href="/admin/tower-content-audit">🔎 Ouvrir l’audit complet des salons et des systèmes existants</a>. Il inventorie aussi les vocaux, catégories, permissions particulières et historiques à protéger.</p>
    <h2>Archives historiques en attente</h2>
    <p><a href="/admin/tower-archive">📦 Consulter la prévisualisation et sauvegarder l’état actuel</a>. L’archivage n’est pas disponible tant que l’audit n’est pas validé.</p>
    <ul>{(state?.archivesDeferred || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
  </main>;
}
