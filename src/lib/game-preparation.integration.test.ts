import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL=process.env.TEST_DATABASE_URL;
const mocks=vi.hoisted(() => ({current:vi.fn()}));
vi.mock("@/lib/current-user",() => ({getCurrentUser:mocks.current}));
vi.mock("@/lib/prisma",async () => { const {PrismaClient}=await import("@prisma/client"); return {prisma:TEST_DATABASE_URL?new PrismaClient({datasourceUrl:TEST_DATABASE_URL}):{}}; });
vi.mock("next/cache",() => ({revalidatePath:vi.fn()}));
vi.mock("next/navigation",() => ({redirect:(url:string) => {throw Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/rate-limit",() => ({checkRateLimit:() => true}));
if(!TEST_DATABASE_URL) console.warn("[game-preparation] PostgreSQL local absent : persistance SKIPPÉE.");
describe.skipIf(!TEST_DATABASE_URL)("préparation sourcée en PostgreSQL",() => {
  let db:import("@prisma/client").PrismaClient;
  let update:typeof import("@/app/jeux/preparation-actions").updateGamePreparation;
  beforeAll(async () => {db=(await import("@/lib/prisma")).prisma as typeof db; update=(await import("@/app/jeux/preparation-actions")).updateGamePreparation;});
  afterAll(async () => {await db?.$disconnect();});
  afterEach(() => {vi.unstubAllGlobals();});
  beforeEach(async () => {
    vi.stubGlobal("fetch",vi.fn(() => {throw Error("Réseau réel interdit");}));
    await db.$executeRawUnsafe('TRUNCATE "User", "Game" CASCADE');
    await db.user.createMany({data:[{id:"owner",discordId:"owner",discordName:"Owner"},{id:"other",discordId:"other",discordName:"Other"}]});
    await db.game.createMany({data:[{id:"g",name:"Game",source:"MANUAL",addedById:"owner",minPlayers:2,igdbDetails:{genres:["Puzzle"]}},{id:"foreign",name:"Foreign",source:"MANUAL",addedById:"other"}]});
    await db.userGame.create({data:{userId:"owner",gameId:"g",owned:true}}); mocks.current.mockResolvedValue({id:"owner"});
  });
  function form(gameId="g") {const f=new FormData(); for(const[k,v] of Object.entries({gameId,preparationCost:"PAID",preparationPrice:"12 EUR",downloadSizeGb:"12,5",preparationPlatform:"PC Windows",preparationSourceUrl:"https://example.com/game",userId:"other",minPlayers:"99"})) f.set(k,v); return f;}
  it("laisse les anciens jeux inconnus et conserve les autres métadonnées lors d'un relevé",async () => {
    expect(await db.game.findUnique({where:{id:"g"}})).toMatchObject({preparationCost:null,downloadSizeGb:null,preparationUpdatedAt:null});
    expect(await update(form())).toEqual({ok:true});
    expect(await db.game.findUnique({where:{id:"g"}})).toMatchObject({preparationCost:"PAID",preparationPrice:"12 EUR",downloadSizeGb:12.5,preparationPlatform:"PC Windows",preparationSourceUrl:"https://example.com/game",preparationUpdatedAt:expect.any(Date),minPlayers:2,igdbDetails:{genres:["Puzzle"]}});
  });
  it("permet un statut gratuit sourcé puis un effacement complet",async () => {
    const f=form(); f.set("preparationCost","FREE"); f.set("preparationPrice",""); expect((await update(f)).ok).toBe(true); expect((await db.game.findUniqueOrThrow({where:{id:"g"}})).preparationCost).toBe("FREE");
    f.set("preparationCost","unknown"); for(const k of ["downloadSizeGb","preparationPrice","preparationPlatform","preparationSourceUrl"]) f.set(k,""); expect((await update(f)).ok).toBe(true);
    expect(await db.game.findUnique({where:{id:"g"}})).toMatchObject({preparationCost:null,preparationPrice:null,downloadSizeGb:null,preparationPlatform:null,preparationSourceUrl:null});
  });
  it("refuse un jeu tiers, inexistant et une possession retirée",async () => {
    expect(await update(form("foreign"))).toEqual({ok:false,error:"access"}); expect(await update(form("missing"))).toEqual({ok:false,error:"access"});
    await db.userGame.update({where:{userId_gameId:{userId:"owner",gameId:"g"}},data:{owned:false}}); expect(await update(form())).toEqual({ok:false,error:"access"});
    expect(await db.game.count({where:{preparationUpdatedAt:{not:null}}})).toBe(0);
  });
  it("ne fait aucune écriture partielle si le relevé est incohérent ou non sourcé",async () => {
    for(const[k,v] of [["preparationSourceUrl",""],["preparationPlatform",""],["downloadSizeGb","-1"],["preparationCost","FREE"]]){const f=form(); f.set(k,v); expect(await update(f)).toEqual({ok:false,error:"invalid"});}
    expect(await db.game.count({where:{preparationUpdatedAt:{not:null}}})).toBe(0);
  });
});
