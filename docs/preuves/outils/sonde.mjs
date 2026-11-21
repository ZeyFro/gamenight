import { createRequire } from "node:module";import { readFileSync } from "node:fs";import { PrismaClient } from "@prisma/client";import { encode } from "next-auth/jwt";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin="http://127.0.0.1:3102";const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});const user=await db.user.findUniqueOrThrow({where:{discordId:process.argv[2]??"p-nouveau"}});
const secret=readFileSync("/tmp/preuves-auth-secret","utf8").trim();const b=await chromium.launch();const c=await b.newContext({viewport:{width:1280,height:800}});
await c.addCookies([{name:"authjs.session-token",value:await encode({secret,salt:"authjs.session-token",maxAge:7200,token:{discordId:user.discordId,sessionCreatedAt:Date.now()}}),url:origin,httpOnly:true,sameSite:"Lax"}]);
await c.addInitScript(id=>sessionStorage.setItem(`gn:onboarding-prompt:${id}`,"later"),user.id);const p=await c.newPage();
for(const path of process.argv.slice(3)){await p.goto(origin+path,{waitUntil:"load"});await p.waitForTimeout(800);
console.log("=====",path,JSON.stringify(await p.evaluate(()=>({controls:[...document.querySelectorAll("main select, main input, main textarea, main button, main [role=combobox], main [role=checkbox]")].filter(e=>e.getBoundingClientRect().width>0).map(e=>`${e.tagName.toLowerCase()}${e.type?"["+e.type+"]":""}${e.disabled?"(désactivé)":""}:${(e.getAttribute("aria-label")||e.name||e.textContent||"").trim().replace(/\s+/g," ").slice(0,40)}`).slice(0,25)}))));}
await b.close();await db.$disconnect();
