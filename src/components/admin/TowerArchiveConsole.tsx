"use client";
import { useEffect, useState } from "react";
type ArchivePreview = { guildId?: string; fingerprint?: string; preview?: Array<{ id:string; name:string; source:string }>; backup?: unknown; errors?: string[]; error?: string; note?: string };
export default function TowerArchiveConsole() {
  const [data,setData] = useState<ArchivePreview>({});
  const [busy,setBusy] = useState(false);
  const [backupSaved,setBackupSaved] = useState(false);
  const [log,setLog] = useState<string[]>([]);
  const [problem,setProblem] = useState("");
  async function refresh() {
    const response = await fetch("/api/admin/tower-archive",{cache:"no-store"});
    const result = await response.json() as ArchivePreview;
    setData(result);
    setBackupSaved(false);
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/tower-archive",{cache:"no-store"})
      .then(r=>r.json())
      .then((x:ArchivePreview)=>{if(active)setData(x);})
      .catch(()=>{if(active)setProblem("Vérification indisponible");});
    return ()=>{active=false;};
  }, []);
  function saveBackup() {
    if (!data.backup) return;
    const blob = new Blob([JSON.stringify({guildId:data.guildId,backup:data.backup},null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url;
    a.download="the-tower-archive-backup-"+new Date().toISOString().slice(0,10)+".json";
    a.click();
    URL.revokeObjectURL(url);
    setBackupSaved(true);
  }
  async function apply() {
    if (!backupSaved || !data.fingerprint || !confirm("Archiver les anciens salons dans une catégorie privée ? Leurs historiques sont conservés. Les accès individuels d'origine devront être restaurés depuis la sauvegarde pour un retour arrière.")) return;
    setBusy(true);setProblem("");
    let fingerprint=data.fingerprint;
    try {
      for(let batch=0;batch<100;batch++){
        const response=await fetch("/api/admin/tower-archive",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({guildId:"553922938101825536",confirm:"ARCHIVER_THE_TOWER_SANS_SUPPRIMER",fingerprint}),
        });
        const result=await response.json();
        if(!response.ok || result.errors?.length || result.error) {
          setProblem(result.error || result.errors?.join(", ") || "Archive interrompue");
          break;
        }
        setLog(old=>[...old,...(result.moved||[])]);
        if(result.completed)break;
        if(result.refreshRequired) {
          const refreshed=await fetch("/api/admin/tower-archive",{cache:"no-store"}).then(r=>r.json());
          fingerprint=refreshed.fingerprint;
        } else {
          fingerprint=result.fingerprint;
        }
        if(!fingerprint)break;
      }
      await refresh();
    }catch{setProblem("Connexion interrompue : actualise la vérification.");}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:880,margin:"2rem auto",padding:24}}>
    <h1>📦 Archives privées — The Tower</h1>
    <p>Conserve les messages, ferme la visibilité aux membres et déplace les anciens salons. Les rôles administrateurs conservent leur accès.</p>
    <button onClick={()=>void refresh()} disabled={busy}>Actualiser</button>
    <p>{data.preview?.length ?? "—"} salons à archiver</p>
    {!!data.error && <p role="alert">{data.error}</p>}
    {!!data.errors?.length && <ul role="alert">{data.errors.map((x,i)=><li key={i}>{x}</li>)}</ul>}
    <ul>{(data.preview||[]).map(x=><li key={x.id}>{x.source} — {x.name}</li>)}</ul>
    <section style={{padding:18,border:"2px solid #64748b",borderRadius:12}}>
      <h2>1. Sauvegarde obligatoire</h2>
      <button onClick={saveBackup} disabled={!data.backup||busy}>Télécharger la sauvegarde JSON</button>
      <p>{backupSaved?"Sauvegarde téléchargée dans le navigateur.":"Le bouton d'archivage reste désactivé avant le téléchargement."}</p>
      <h2>2. Archivage privé</h2>
      <button onClick={()=>void apply()} disabled={busy||!backupSaved||!!data.errors?.length||!data.preview?.length}
        style={{padding:18,borderRadius:10,background:"#0e7490",color:"#fff",fontWeight:700}}>
        {busy?"Archivage en cours…":"Archiver les anciens salons"}
      </button>
      {!!problem && <p role="alert">{problem}</p>}
    </section>
    <h2>Journal</h2>
    <ul>{log.map((x,i)=><li key={i}>{x}</li>)}</ul>
  </main>;
}
