"use client";
import { useEffect, useState } from "react";
type Item = { operation: string; category: string; name: string };
type Preview = { actions?: Item[]; errors?: string[]; archivesDeferred?: string[]; totalChannels?: number; error?: string };
export default function TowerLayoutAdmin() {
  const [state, setState] = useState<Preview>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  async function refresh() {
    const r = await fetch("/api/admin/tower-layout", { cache: "no-store" });
    const j = await r.json();
    setState(j);
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/tower-layout", { cache: "no-store" })
      .then(r => r.json())
      .then(data => { if (active) setState(data); });
    return () => { active = false; };
  }, []);
  async function execute() {
    if (!confirm("Appliquer toutes les créations et renommages sur The Tower ? Aucune suppression ni archivage n'aura lieu.")) return;
    setProblem("");
    setBusy(true);
    try {
      for (let batch = 0; batch < 30; batch++) {
        const r = await fetch("/api/admin/tower-layout", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "THE_TOWER_PHASE_1", guildId: "553922938101825536" }),
        });
        const j = await r.json();
        setLog(old => [...old, ...(j.completed || []), ...(j.error ? [j.error] : [])]);
        if (!r.ok || j.error) { setProblem(j.error || "Échec de la modification Discord"); break; }
        if (j.complete || !(j.completed?.length)) break;
      }
      await refresh();
    } catch { setProblem("Connexion perdue. La vérification peut reprendre les opérations sans doublons."); } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 860, margin: "2rem auto", padding: 24 }}>
    <h1>🏰 The Tower — Réorganisation Discord</h1>
    <section style={{ padding: 20, background: "#10263b", color: "#ffffff", border: "2px solid #22d3ee", borderRadius: 14, margin: "22px 0" }}>
      <h2 style={{ marginTop: 0, color: "#ffffff", fontSize: 22 }}>🚀 Lancer la réorganisation</h2>
      <p style={{ color: "#e0f2fe" }}>42 opérations prévues initialement. Cette action crée et renomme les salons, mais ne supprime rien.</p>
      <button type="button" onClick={() => void execute()} disabled={busy || !state.actions?.length || !!state.errors?.length} style={{ display: "block", width: "100%", padding: "18px 22px", backgroundColor: busy ? "#6b7280" : "#22d3ee", color: "#082f49", fontWeight: 800, fontSize: 19, borderRadius: 12, border: "2px solid #ffffff", cursor: busy ? "progress" : "pointer", opacity: busy || !state.actions?.length || !!state.errors?.length ? 0.6 : 1 }}>
        {busy ? "⏳ Application en cours…" : "✅ APPLIQUER LES MODIFICATIONS SUR DISCORD"}
      </button>
      {!!problem && <p role="alert" style={{ color: "#fecaca", fontWeight: 700 }}>{problem}</p>}
      {state.actions?.length === 0 && <p>✅ Toutes les créations et renommages sont terminés.</p>}
    </section>
    <p>Phase 1 : création et renommage. Aucun message, salon ou rôle supprimé. Les archives sont traitées séparément après vérification des permissions.</p>
    <button disabled={busy} onClick={() => void refresh()}>Actualiser la vérification</button>
    <p>Salons détectés : {state.totalChannels ?? "—"} | Opérations restantes : {state.actions?.length ?? "—"}</p>
    {!!state.error && <p role="alert">{state.error}</p>}
    {!!state.errors?.length && <div role="alert"><strong>Blocages :</strong><ul>{state.errors.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
    <h2>Opérations prévues</h2>
    <ul>{(state.actions || []).map((x,i)=><li key={i}>{x.operation} — {x.name}</li>)}</ul>

    <h2>Archives en attente de vérification</h2>
    <ul>{(state.archivesDeferred || []).map((x,i)=><li key={i}>{x}</li>)}</ul>
    <h2>Journal de cette session</h2>
    <ul>{log.map((x,i)=><li key={i}>{x}</li>)}</ul>
  </main>;
}
