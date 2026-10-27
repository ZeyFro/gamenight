"use client";
import { useEffect, useState } from "react";
type Channel = {id:string;name:string;category:string|null;topic:string;sampledMessages:number;nonBotSamples:number;pinnedCount:number;recentContentPatterns:Array<{word:string;count:number}>;newestSampleAt:string|null;sampleSkipped?:boolean;skipReason?:string;botNames?:string[];serviceEvidence?:string[]};
type InventoryItem = {id:string;name:string;type:number;category:string|null;protected:boolean;legacyCandidate:boolean;overwriteCount:number;hasMemberOverwrites:boolean};
type Result = {page:number;pageCount:number;totalTextChannels:number;totalGuildChannels:number;inventory?:InventoryItem[];channels:Channel[];unreadableChannels?:Array<{id:string;messageReadStatus:number;pinsReadStatus:number}>;error?:string};
export default function AuditClient(){
 const [summary,setSummary]=useState<Result|null>(null);
 const [busy,setBusy]=useState(false);
 const [problem,setProblem]=useState("");
 const [done,setDone]=useState(0);
 const [retryKey,setRetryKey]=useState(0);
 useEffect(()=>{let active=true;void fetch("/api/admin/tower-content-audit?page=0",{cache:"no-store"}).then(async r=>{const j=await r.json() as Result;if(!r.ok||j.error)throw Error(j.error||"HTTP "+r.status);return j;}).then(j=>{if(active){setSummary(j);setProblem("");}}).catch(e=>{if(active){setSummary(null);setProblem(e instanceof Error?e.message:"Audit inaccessible");}});return()=>{active=false};},[retryKey]);
 async function exportAll(){
  setBusy(true);setProblem("");setDone(0);
  try {
   const pages=summary?.pageCount??0;const all:Channel[]=[];
   let inventory:InventoryItem[]=summary?.inventory||[];
   const unreadable:NonNullable<Result["unreadableChannels"]>=[];
   for(let p=0;p<pages;p++){
    const r=await fetch("/api/admin/tower-content-audit?page="+p,{cache:"no-store"});
    const j=await r.json() as Result;
    if(!r.ok||j.error)throw Error(j.error||"Erreur page "+p);
    all.push(...j.channels);if(p===0)inventory=j.inventory||inventory;
    unreadable.push(...(j.unreadableChannels||[]));setDone(p+1);
   }
   const document={guildId:"553922938101825536",generatedAt:new Date().toISOString(),scope:"read-only inventory and sampled thematic audit; no message bodies",totalGuildChannels:inventory.length,totalTextChannels:all.length,inventory,unreadableChannels:unreadable,channels:all};
   const blob=new Blob([JSON.stringify(document,null,2)],{type:"application/json"});
   const url=URL.createObjectURL(blob);const a=window.document.createElement("a");a.href=url;a.download="the-tower-audit-contenu.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setProblem(e instanceof Error?e.message:"Erreur d'export");}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:980,margin:"2rem auto",padding:24}}>
  <h1>🔎 The Tower — Audit réel des salons</h1>
  <p>Lecture seule. Analyse les thèmes des messages récents et les épinglés, sans exporter les noms des membres ni le texte des conversations. Les salons privés du staff, tickets et NSFW sont inventoriés sans lire leur contenu.</p>
  <p>{summary?.totalGuildChannels??"—"} salons et catégories inventoriés, dont {summary?.totalTextChannels??"—"} salons texte • {summary?.pageCount??"—"} pages d’analyse</p>
  {!!summary?.inventory&&<p>{summary.inventory.filter(c=>c.protected).length} éléments protégés (staff/tickets/accès particuliers), {summary.inventory.filter(c=>c.legacyCandidate).length} éléments historiques à examiner, {summary.inventory.filter(c=>c.hasMemberOverwrites).length} éléments avec permissions individuelles. Aucune suppression ou modification n’est effectuée.</p>}
  {!!problem&&!summary&&<p role="alert">Impossible de charger l’audit : {problem}. Vérifie ta connexion GameNight avec le compte Discord propriétaire et les permissions de lecture du bot.</p>}
  {!!problem&&!summary&&<button type="button" onClick={()=>setRetryKey(x=>x+1)}>↻ Réessayer l’audit</button>}
  <p style={{fontWeight:700}}>L’audit inclut maintenant les robots existants, tickets, sanctions, accueil et modération afin d’éviter les doublons.</p>
  <button type="button" onClick={()=>void exportAll()} disabled={busy||!summary}
    style={{display:"block",width:"100%",borderRadius:12,padding:22,background:"#0891b2",color:"white",fontWeight:800,fontSize:20}}>
   {busy?"Analyse en cours : "+done+"/"+summary?.pageCount:"📥 TÉLÉCHARGER L’AUDIT COMPLET"}
  </button>
  {!!problem&&<p role="alert">{problem}</p>}
  <h2>Aperçu des premiers salons</h2>
  <ul>{(summary?.channels||[]).map(c=><li key={c.id}><strong>{c.category} / {c.name}</strong> — {c.sampleSkipped ? "contenu sensible non lu (métadonnées uniquement)" : `${c.sampledMessages} messages échantillonnés, ${c.pinnedCount} épinglés`}. Services détectés : {(c.serviceEvidence||[]).join(", ")||"—"} • Bots : {(c.botNames||[]).join(", ")||"—"} • Thèmes : {c.recentContentPatterns.slice(0,6).map(x=>x.word).join(", ")}</li>)}</ul>
  <p>Les indices proviennent des derniers messages accessibles, pas de la configuration interne des bots. Les salons protégés et les permissions individuelles sont signalés pour éviter de casser les tickets, sanctions et historiques.</p>
  <p>Transmets ensuite le fichier JSON téléchargé dans cette conversation pour identifier les doublons et préserver les salons utiles.</p>
 </main>;
}
