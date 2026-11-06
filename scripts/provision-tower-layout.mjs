#!/usr/bin/env node
/**
 * The Tower 2.0 — Discord provisioning preview.
 * Default is READ ONLY. No write token is needed for the inventory if DISCORD_BOT_TOKEN exists.
 * Writes require both --apply and TOWER_DISCORD_APPLY=I_UNDERSTAND.
 * Current phase deliberately implements creation/renaming only: moving legacy channels
 * into archives needs an effective-permission audit before being safe.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import permissions from "./tower-layout-permissions.cjs";

const API = "https://discord.com/api/v10";
const guild = process.env.DISCORD_BOT_GUILD_ID;
if (!guild) throw new Error("Missing DISCORD_BOT_GUILD_ID.");
const manifest = JSON.parse(await fs.readFile(new URL("../docs/tower-layout-approved.json", import.meta.url), "utf8"));
const apply = process.argv.includes("--apply");
const yes = process.env.TOWER_DISCORD_APPLY === "I_UNDERSTAND";
const token = process.env.DISCORD_BOT_TOKEN;
const missingPermissionPolicies = permissions.findCategoriesMissingPermissionPolicy(manifest.category_order);
if (manifest.guild_id !== guild) throw new Error("Guild mismatch");
if (apply && !yes) throw new Error("Apply requires TOWER_DISCORD_APPLY=I_UNDERSTAND");
if (apply) permissions.assertCategoriesHavePermissionPolicy(manifest.category_order);
if (!token) throw new Error("Missing DISCORD_BOT_TOKEN. Never print or commit the token.");

async function api(method, route, body) {
  for (let attempt=0;attempt<6;attempt++) {
    const r = await fetch(API+route, {
      method, headers: {"Authorization": "Bot "+token, ...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    if (r.status===429) { const j=await r.json();await new Promise(res=>setTimeout(res,Math.ceil((j.retry_after||1)*1000)));continue; }
    if (!r.ok) throw new Error(method+" "+route+" failed HTTP "+r.status+": "+(await r.text()).slice(0,500));
    return r.status===204?null:await r.json();
  }
  throw new Error("Rate limit retry exhausted");
}
const channels = await api("GET", "/guilds/"+guild+"/channels");
const map = new Map(channels.map(x=>[x.id,x]));
const stamp = new Date().toISOString().replace(/[:.]/g,"-");
const backup = path.join(os.tmpdir(), "tower-discord-backup-"+stamp+".json");
await fs.writeFile(backup,JSON.stringify({guild,at:new Date().toISOString(),channels},null,2),{mode:0o600});
console.log("Snapshot:",backup,"channels:",channels.length);
const plan=[];
for (const category of manifest.category_order) {
  const existing = category.reuse_category_id&&map.get(category.reuse_category_id);
  if(category.reuse_category_id && (!existing||existing.type!==4)) throw new Error("Missing/mismatched category "+category.reuse_category_id+" "+category.name);
  const sameName = !category.reuse_category_id && channels.find(x => x.type === 4 && x.name === category.name);
  if (apply && sameName) permissions.assertExistingCategoryPermissionPolicyMatches(sameName, category);
  const parent = existing ?? sameName;
  if (apply && parent && category.channels.some(channel => !channel.reuse_id)) {
    permissions.permissionOverwritesForChild(parent);
  }
  plan.push({action:existing?"rename-category":sameName?"reuse-category":"create-category",id:parent?.id,name:category.name});
  for (const ch of category.channels) {
    const old=ch.reuse_id&&map.get(ch.reuse_id);
    if(ch.reuse_id && !old) throw new Error("Missing existing channel "+ch.reuse_id+" "+ch.name);
    if(old && ![0,2,5,15].includes(old.type)) throw new Error("Unexpected channel type: "+old.name);
    const type=ch.type==="forum"?15:ch.type==="voice_lobby"?2:0;
    plan.push({action:old?"rename-channel":"create-channel",id:old?.id,categoryId:parent?.id,name:ch.name,type});
  }
}
for(const c of manifest.archive_candidates){
  const old=map.get(c.id);if(!old||old.type!==4)throw new Error("Archive category not found: "+c.name+" "+c.id);
  const children=channels.filter(x=>x.parent_id===c.id);
  plan.push({action:"archive-review-required",category:c.name,id:c.id,children:children.map(x=>({id:x.id,name:x.name,type:x.type,overwrites:x.permission_overwrites?.length??0}))});
}
console.log(JSON.stringify({apply,permissionReviewRequired:missingPermissionPolicies,planned:plan},null,2));
if(!apply){console.log("READ-ONLY PLAN. No Discord writes.");process.exit(0);}
if(plan.some(x=>x.action==="archive-review-required")) {
  console.log("Archives are REVIEW-ONLY in this first phase. Legacy categories and messages are untouched.");
}
for(const c of manifest.category_order){
  let parent=c.reuse_category_id;
  let parentChannel;
  if(parent){
    parentChannel=map.get(parent);
    if(parentChannel.name!==c.name) await api("PATCH","/channels/"+parent,{name:c.name});
  } else {
    parentChannel=channels.find(x=>x.type===4&&x.name===c.name);
    if(parentChannel) parent=parentChannel.id;
    else {
      parentChannel=await api("POST","/guilds/"+guild+"/channels",{name:c.name,type:4,permission_overwrites:c.permission_overwrites});
      parentChannel.permission_overwrites ??= c.permission_overwrites;
      parent=parentChannel.id;
      map.set(parent,parentChannel);
    }
  }
  for(const ch of c.channels){
    if(ch.reuse_id){
      const current=map.get(ch.reuse_id);
      if(current.name!==ch.name)await api("PATCH","/channels/"+ch.reuse_id,{name:ch.name});
      // Deliberately do NOT reparent existing channels until effective permissions are verified.
    }else{
      const type=ch.type==="forum"?15:ch.type==="voice_lobby"?2:0;
      // Child channels must keep the selected category's effective access policy.
      const live=await api("GET","/guilds/"+guild+"/channels");
      if(live.some(x=>x.parent_id===parent&&x.name===ch.name))continue;
      await api("POST","/guilds/"+guild+"/channels",{name:ch.name,type,parent_id:parent,permission_overwrites:permissions.permissionOverwritesForChild(parentChannel)});
    }
  }
}
console.log("PHASE 1 COMPLETE. Verify real permissions and categories before any archive moves.");
