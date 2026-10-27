"use client";
import { useEffect, useState } from "react";
type Channel = {id:string;name:string;category:string|null;topic:string;sampledMessages:number;nonBotSamples:number;pinnedCount:number;recentContentPatterns:Array<{word:string;count:number}>;newestSampleAt:string|null;botNames?:string[];serviceEvidence?:string[]};
type Result = {page:number;pageCount:number;totalTextChannels:number;channels:Channel[];error?:string};
export default function AuditClient(){
 const [summary,setSummary]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);
 const [problem,setProblem]=useState("");
 const [done,setDone]=useState(0);
 useEffect(()=>{let active=true;void fetch("/api/admin/tower-content-audit?page=0",{cache:"no-store"}).then(r=>r.json()).then((j:Result)=>{if(active)setSummary(j)}).catch(()=>{if(active)setProblem("Audit inaccessible")});return()=>{active=false};},[]);
 async function exportAll(){
  setBusy(true);setProblem("");setDone(0);
  try {
   const pages=summary?.pageCount||1;const all:Channel[]=[];
   for(let p=0;p<pages;p++){
    const r=await fetch("/api/admin/tower-content-audit?page="+p,{cache:"no-store"});
    const j=await r.json() as Result;
    if(!r.ok||j.error)throw Error(j.error||"Erreur page "+p);
    all.push(...j.channels);setDone(p+1);
   }
   const document={guildId:"553922938101825536",generatedAt:new Date().toISOString(),scope:"read-only thematic audit no message bodies",total:all.length,channels:all};
   const blob=new Blob([JSON.stringify(document,null,2)],{type:"application/json"});
   const url=URL.createObjectURL(blob);const a=window.document.createElement("a");a.href=url;a.download="the-tower-audit-contenu.json";a.click();URL.revokeObjectURL(url);
  }catch(e){setProblem(e instanceof Error?e.message:"Erreur d'export");}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:980,margin:"2rem auto",padding:24}}>
  <h1>🔎 The Tower — Audit réel des salons</h1>
  <p>Lecture seule. Analyse les thèmes des messages récents et les épinglés, sans exporter les noms des membres ni le texte des conversations.</p>
  <p>{summary?.totalTextChannels??"—"} salons texte • {summary?.pageCount??"—"} pages</p>
  {!!summary?.error&&<p role="alert">Accès refusé ou Discord indisponible : {summary.error}. Connecte-toi à GameNight avec le compte Discord propriétaire, puis recharge cette page.</p>}
  <p style={{fontWeight:700}}>L’audit inclut maintenant les robots existants, tickets, sanctions, accueil et modération afin d’éviter les doublons.</p>
  <button type="button" onClick={()=>void exportAll()} disabled={busy||!summary?.pageCount}
    style={{display:"block",width:"100%",borderRadius:12,padding:22,background:"#0891b2",color:"white",fontWeight:800,fontSize:20}}>
   {busy?"Analyse en cours : "+done+"/"+summary?.pageCount:"📥 TÉLÉCHARGER L’AUDIT COMPLET"}
  </button>
  {!!problem&&<p role="alert">{problem}</p>}
  <h2>Aperçu des premiers salons</h2>
  <ul>{(summary?.channels||[]).map(c=><li key={c.id}><strong>{c.category} / {c.name}</strong> — {c.sampledMessages} messages échantillonnés, {c.pinnedCount} épinglés. Services détectés : {(c.serviceEvidence||[]).join(", ")||"—"} • Bots : {(c.botNames||[]).join(", ")||"—"} • Thèmes : {c.recentContentPatterns.slice(0,6).map(x=>x.word).join(", ")}</li>)}</ul>
  <p>Transmets ensuite le fichier JSON téléchargé dans cette conversation pour identifier les doublons et préserver les salons utiles.</p>
 </main>;
}
