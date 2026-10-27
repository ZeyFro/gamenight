import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin } from "@/lib/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const GUILD="553922938101825536";
const OWNER="699223334046531636";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex"};
type Channel={id:string;name:string;type:number;parent_id:string|null;topic?:string|null;nsfw?:boolean;last_message_id?:string|null;permission_overwrites?:unknown[]};
type DiscordMessage={id:string;content:string;timestamp:string;author?:{bot?:boolean};pinned?:boolean;attachments?:Array<{content_type?:string}>};
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
 if(!Number.isInteger(page)||page<0||page>30)return NextResponse.json({error:"Invalid page"},{status:400,headers});
 try{
  const all=await api("/guilds/"+GUILD+"/channels");
  const channels=(all.data||[]) as Channel[];
  const texts=channels.filter(c=>c.type===0||c.type===5).sort((a,b)=>a.id.localeCompare(b.id));
  const batch=texts.slice(page*5,page*5+5);
  const result=[];
  for(const c of batch){
   const r=await api("/channels/"+c.id+"/messages?limit=30");
   const messages=(r.data||[]) as DiscordMessage[];
   const p=await api("/channels/"+c.id+"/pins");
   const pinsPayload=p.data as DiscordMessage[]|{items?:Array<{message?:DiscordMessage}>}|null;
   const pins=Array.isArray(pinsPayload)?pinsPayload:(pinsPayload?.items||[]).map(x=>x.message).filter((x):x is DiscordMessage=>!!x);
   const recent=messages.filter(x=>!x.author?.bot);
   const phrases=[c.name,c.topic||"",...recent.map(x=>x.content.slice(0,1200)),...pins.map(x=>x.content.slice(0,1200))];
   result.push({
    id:c.id,name:c.name,category:channels.find(x=>x.id===c.parent_id)?.name||null,topic:c.topic||"",
    nsfw:!!c.nsfw,messageReadStatus:r.status,pinsReadStatus:p.status,
    sampledMessages:messages.length,nonBotSamples:recent.length,pinnedCount:pins.length,
    oldestSampleAt:messages.at(-1)?.timestamp||null,newestSampleAt:messages[0]?.timestamp||null,
    recentContentPatterns:keywords(phrases.join(" ")),
    // Excerpts are deliberately not returned; privacy-preserving audit.
    sampleHasAttachments:messages.some(x=>(x.attachments?.length||0)>0),
    sampleHasLinks:messages.some(x=>/https?:\/\//.test(x.content)),
    botMessageCount:messages.filter(x=>x.author?.bot).length,
   });
  }
  return NextResponse.json({guildId:GUILD,page,pageCount:Math.ceil(texts.length/5),totalTextChannels:texts.length,channels:result,note:"Lecture seule; métadonnées et thèmes agrégés, aucun message nominatif ni contenu brut transmis."},{headers});
 }catch{return NextResponse.json({error:"Audit Discord inaccessible"},{status:502,headers});}
}
