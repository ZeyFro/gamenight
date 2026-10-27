"use client";
import { useEffect, useState } from "react";

type ArchivePreview = {
  guildId?: string; mode?: string; writeEnabled?: boolean;
  preview?: Array<{ id: string; name: string; source: string }>;
  backup?: unknown; errors?: string[]; error?: string; note?: string;
  categoriesToHide?: Array<{ id: string; name: string }>;
};

export default function TowerArchiveConsole() {
  const [data, setData] = useState<ArchivePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/tower-archive", { cache: "no-store" });
      const result = await response.json() as ArchivePreview;
      if (!response.ok || result.error) throw Error(result.error || "HTTP " + response.status);
      setData(result);
      setProblem("");
    } catch (e) {
      setData(null);
      setProblem(e instanceof Error ? e.message : "Prévisualisation indisponible");
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);

  function saveBackup() {
    if (!data?.backup) return;
    const blob = new Blob([JSON.stringify({ guildId: data.guildId, backup: data.backup }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "the-tower-archive-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main style={{ maxWidth: 880, margin: "2rem auto", padding: 24 }}>
    <h1>📦 Archives historiques — The Tower</h1>
    <p><strong>Consultation et sauvegarde uniquement.</strong> L’archivage est suspendu pendant l’audit des salons, tickets, sanctions et bots déjà présents. Aucune permission ou catégorie ne sera modifiée ici.</p>
    <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Vérification en cours…" : "↻ Actualiser"}</button>
    <p>{data?.preview?.length ?? "—"} salons historiques repérés • {data?.categoriesToHide?.length ?? "—"} catégories candidates</p>
    {!!problem && <p role="alert">Vérification impossible : {problem}. Vérifie ta connexion propriétaire et l’accès du bot à Discord.</p>}
    {!!data?.errors?.length && <ul role="alert">{data.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    <ul>{(data?.preview || []).map(x => <li key={x.id}>{x.source} — {x.name}</li>)}</ul>
    <h2>Sauvegarde de l’état actuel</h2>
    <button type="button" onClick={saveBackup} disabled={busy || !data?.backup}>📥 Télécharger la sauvegarde JSON</button>
    <p>Cette sauvegarde contient les métadonnées et permissions originales des salons candidats. Conserve-la en lieu sûr : elle peut contenir des informations sur les salons privés.</p>
    <h2>Avant toute réorganisation</h2>
    <p><a href="/admin/tower-content-audit">🔎 Auditer les salons et les systèmes existants</a>. Les anciennes catégories ne seront ni supprimées ni déplacées automatiquement.</p>
  </main>;
}
