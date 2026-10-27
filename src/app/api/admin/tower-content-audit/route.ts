import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin } from "@/lib/admin";
import plan from "@/lib/tower-discord-layout.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const GUILD="553922938101825536";
const OWNER="699223334046531636";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex"};
type Channel={id:string;name:string;type:number;parent_id:string|null;topic?:string|null;nsfw?:boolean;last_message_id?:string|null;permission_overwrites?:Array<{id:string;type:number;allow:string;deny:string}>};
type DiscordMessage={id:string;content:string;timestamp:string;author?:{bot?:boolean;username?:string};webhook_id?:string;embeds?:Array<{title?:string;description?:string}>;pinned?:boolean;attachments?:Array<{content_type?:string}>};
async function api(route:string):Promise<{status:number;data:unknown}>{
 const token=process.env.DISCORD_BOT_TOKEN;
 if(!token)throw Error("Token missing");
 for(let retry=0;retry<4;retry++){
  const res=await fetch("https://discord.com/api/v10"+route,{headers:{Authorization:"Bot "+token},cache:"no-store",signal:AbortSignal.timeout(13000)});
  if(res.status===429){const j=await res.json() as {retry_after?:number};await new Promise(resolve=>setTimeout(resolve,Math.min(4000,Math.max(200,(j.retry_after||1)*1000))));continue;}
  if(res.status===403||res.status===404)return {status:res.status,data:null};
  if(!res.ok)throw Error("Discord status "+res.status);
  return {status:res.status,data:await res.json()};
 }
 throw Error("Rate limit");
}
async function guard(){
 const u=await getCurrentUser({allowPlatformAdminWithoutMembership:true});
 const admin=u?await requireAdmin():null;
 return !!admin&&admin.discordId===OWNER;
}
function keywords(text:string){
 const tokens=text.toLocaleLowerCase("fr").replace(/https?:\/\/\S+/g," ").match(/[a-zà-ÿ0-9]{4,}/g)||[];
 const ignore=new Set(["pour","avec","dans","vous","nous","mais","plus","elle","tout","tous","cette","discord","https","http","message","salon","leur","avoir","chez","aussi","bonjour"]);
 const count=new Map<string,number>();
 for(const t of tokens)if(!ignore.has(t))count.set(t,(count.get(t)||0)+1);
 return [...count].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([word,count])=>({word,count}));
}
export async function GET(req:NextRequest){
 if(!(await guard()))return NextResponse.json({error:"Forbidden"},{status:403,headers});
 const page=Number(req.nextUrl.searchParams.get("page")||0);
 if(!Number.isInteger(page)||page<0||page>200)return NextResponse.json({error:"Invalid page"},{status:400,headers});
 try{
  const all=await api("/guilds/"+GUILD+"/channels");
  if(all.status!==200||!Array.isArray(all.data))return NextResponse.json({error:"Inventaire des salons Discord inaccessible",discordStatus:all.status},{status:502,headers});
  const channels=all.data as Channel[];
  const categoryById=new Map(channels.filter(c=>c.type===4).map(c=>[c.id,c.name]));
  const protectedIds=new Set(plan.protected_categories.map(c=>c.id));
  // Overwrites do not prove public access; keep uncertain channels metadata-only.
  for(const c of channels)if((c.permission_overwrites?.length??1)>0||c.nsfw||c.name.toLocaleLowerCase("fr").includes("the-hell"))protectedIds.add(c.id);
  const legacyIds=new Set(plan.archive_candidates.map(c=>c.id));
  const inventory=page===0?channels.map(c=>({
   id:c.id,name:c.name,type:c.type,category:c.parent_id?categoryById.get(c.parent_id)||null:null,
   protected:protectedIds.has(c.id)||!!c.parent_id&&protectedIds.has(c.parent_id),
   legacyCandidate:legacyIds.has(c.id)||!!c.parent_id&&legacyIds.has(c.parent_id),
   overwriteCount:c.permission_overwrites?.length||0,
   hasMemberOverwrites:!!c.permission_overwrites?.some(o=>o.type===1),
   // These are raw overwrite indicators, NOT effective permissions.
  })):undefined;
  const texts=channels.filter(c=>c.type===0||c.type===5).sort((a,b)=>a.id.localeCompare(b.id));
  const batch=texts.slice(page*5,page*5+5);
  const result=[];
  for(const c of batch){
   // Sensitive channels are inventoried by metadata only. Never sample private
   // staff/ticket content or adult-only areas, even for an authenticated owner.
   if(protectedIds.has(c.id)||(c.parent_id!==null&&protectedIds.has(c.parent_id))){
    result.push({id:c.id,name:c.name,category:c.parent_id?categoryById.get(c.parent_id)||null:null,
     topic:"",nsfw:!!c.nsfw,sampleSkipped:true,skipReason:"sensitive_channel",
     sampledMessages:0,nonBotSamples:0,pinnedCount:0,botNames:[],serviceEvidence:[],recentContentPatterns:[]});
    continue;
   }
   const r=await api("/channels/"+c.id+"/messages?limit=30");
   const messages=(r.data||[]) as DiscordMessage[];
   const p=await api("/channels/"+c.id+"/pins");
   const pinsPayload=p.data as DiscordMessage[]|{items?:Array<{message?:DiscordMessage}>}|null;
   const pins=Array.isArray(pinsPayload)?pinsPayload:(pinsPayload?.items||[]).map(x=>x.message).filter((x):x is DiscordMessage=>!!x);
   const recent=messages.filter(x=>!x.author?.bot);
   const phrases=[c.name,c.topic||"",...messages.map(x=>x.content.slice(0,1200)),...messages.flatMap(x=>(x.embeds||[]).map(e=>(e.title||"")+" "+(e.description||"")).slice(0,4)),...pins.map(x=>x.content.slice(0,1200))];
   const serviceTerms=["ticket","support","sanction","ban","bannissement","warn","avertissement","mute","modération","bienvenue","welcome","arrivée","join","départ","leave","logs","journal","signalement","report","règlement","role","rôle","autorole","verification","vérification"];
   const serviceEvidence=serviceTerms.filter(t=>phrases.join(" ").toLocaleLowerCase("fr").includes(t));
   const botNames=[...new Set(messages.filter(x=>x.author?.bot||x.webhook_id).map(x=>x.author?.username||"Webhook"))].slice(0,15);
   result.push({
    id:c.id,name:c.name,category:channels.find(x=>x.id===c.parent_id)?.name||null,topic:c.topic||"",sampleSkipped:false,
    nsfw:!!c.nsfw,messageReadStatus:r.status,pinsReadStatus:p.status,
    sampledMessages:messages.length,nonBotSamples:recent.length,pinnedCount:pins.length,
    oldestSampleAt:messages.at(-1)?.timestamp||null,newestSampleAt:messages[0]?.timestamp||null,
    recentContentPatterns:keywords(phrases.join(" ")),
    // Excerpts are deliberately not returned; privacy-preserving audit.
    sampleHasAttachments:messages.some(x=>(x.attachments?.length||0)>0),
    sampleHasLinks:messages.some(x=>/https?:\/\//.test(x.content)),
    botMessageCount:messages.filter(x=>x.author?.bot).length,
    webhookMessageCount:messages.filter(x=>!!x.webhook_id).length,
    botNames,serviceEvidence,
   });
  }
  return NextResponse.json({guildId:GUILD,page,pageCount:Math.ceil(texts.length/5),totalTextChannels:texts.length,totalGuildChannels:channels.length,inventory,channels:result,
   unreadableChannels:result.filter(c=>!c.sampleSkipped&&(c.messageReadStatus!==200||c.pinsReadStatus!==200)).map(c=>({id:c.id,messageReadStatus:c.messageReadStatus,pinsReadStatus:c.pinsReadStatus})),
   note:"Audit en lecture seule. Inventaire de tous les types de salons; analyse des 30 messages récents et épinglés uniquement dans les salons non sensibles. Salons staff/tickets et NSFW inventoriés sans lecture des messages. Indices de services non conclusifs; aucune permission effective déduite des overwrites. Aucun contenu brut de message ni identité de membre transmis."},{headers});
 }catch{return NextResponse.json({error:"Audit Discord inaccessible"},{status:502,headers});}
}
