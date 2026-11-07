import { expect, test } from "@playwright/test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@arken/db";
import { createMigratedPglite } from "../helpers/pglite-template.js";
import { registerCreationRoutes } from "../../apps/server/src/creation-routes.js";
import { registerCharacterPlayRoutes } from "../../apps/server/src/character-play-routes.js";
import { registerRoutes } from "../../apps/server/src/routes.js";
import { registerRealtime } from "../../apps/server/src/realtime.js";
import { Server as SocketServer } from "socket.io";
import { openWorkspaceSection } from "./workspace-nav-helper";
import { hashToken } from "../../apps/server/src/security.js";
import { env } from "../../apps/server/src/env.js";
const id=()=>crypto.randomUUID();
test("real creation API survives lost response and reload",async({page})=>{
 test.setTimeout(60000);
 const pg=await createMigratedPglite();const db=drizzle(pg,{schema});const app=Fastify();
 try {
   const campaignId=id(), gm=id(), player=id(), buyer=id(), characterId=id(), buyerCharacter=id(), packId=id(), templateId=id(), recipeId=id();
   const secrets = { gm:"g".repeat(40), player:"p".repeat(40), buyer:"b".repeat(40) };
   await db.insert(schema.campaigns).values({id:campaignId,name:"QA"});
   await db.insert(schema.memberships).values([{id:gm,campaignId,role:"GM",displayName:"GM"},{id:player,campaignId,role:"PLAYER",displayName:"Player"},{id:buyer,campaignId,role:"PLAYER",displayName:"Buyer"}]);
   await db.insert(schema.sessions).values([{membershipId:gm,tokenHash:hashToken(secrets.gm),expiresAt:new Date(Date.now()+120000)}, {membershipId:player,tokenHash:hashToken(secrets.player),expiresAt:new Date(Date.now()+120000)}, {membershipId:buyer,tokenHash:hashToken(secrets.buyer),expiresAt:new Date(Date.now()+120000)}]);
   await db.insert(schema.characters).values([{id:characterId,campaignId,ownerMembershipId:player,name:"Author",wallet:{gold:1,silver:0,copper:0,sp:10}},{id:buyerCharacter,campaignId,ownerMembershipId:buyer,name:"Buyer",wallet:{gold:1,silver:0,copper:0,sp:0}}]);
   await app.register(cookie); registerCreationRoutes(app,db as never,async()=>{});
   registerCharacterPlayRoutes(app,db as never,{to:()=>({emit:()=>{}})} as never,{broadcast:async()=>{},publishCharacter:async()=>{}});
   await app.ready();
   const request = async (who:"gm"|"player"|"buyer", path:string, payload:Record<string, unknown>, method:"POST"|"PUT"="POST") => {
    const response = await app.inject({method,url:`/api/creation/${path}`,headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets[who]}`,"x-creation-campaign":campaignId,"x-creation-membership":who==="gm"?gm:who==="player"?player:buyer},payload});
    expect(response.statusCode,`${path}: ${response.body}`).toBe(200); return response.json();
   };
   const metrics = {power:1,priceCopper:0,craftSp:0,usageCost:0}, zero={power:0,priceCopper:0,craftSp:0,usageCost:0};
   const range = {power:{min:0,max:100},priceCopper:{min:0,max:100},craftSp:{min:0,max:100},usageCost:{min:0,max:100}};
   const manual = {power:{min:0,max:0},priceCopper:{min:0,max:0},craftSp:{min:0,max:0},usageCost:{min:0,max:0}};
   const source={format:1,kind:"SKILL",name:"QA rules",description:"",slots:["ACTION","TARGET","SCHOOL","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="EFFECT"?1:0,max:1})),components:[{id:"effect",name:"QA effect",description:"",slot:"EFFECT",tags:[],parameters:[],contribution:metrics,factorsBasisPoints:{power:10000,priceCopper:10000,craftSp:10000,usageCost:10000},requirements:[],materials:[],artifact:null,effects:[{kind:"MANUAL",text:"QA"}]}],compatibility:[],limits:range,manualAdjustment:manual,usageResource:null};
   const rules=await request("gm","rules/versions",{actionId:id(),packId,expectedRevision:null,source,publish:true});
   const design={name:"QA skill",lore:"",appearance:"",selections:[{componentId:"effect",parameters:{}}],adjustments:zero,adjustmentReason:""};
   const template=await request("player","templates/versions",{actionId:id(),templateId,expectedRevision:null,previousVersionId:null,ruleVersionId:rules.versionId,design});
   await request("gm","reviews",{actionId:id(),versionId:template.versionId,expectedRevision:null,decision:"APPROVED",reason:"QA"});
   const recipeSource={format:1,name:"QA craft",reason:"QA",kind:"SKILL",operation:"CRAFT",inputs:[],output:{versionId:template.versionId,level:1,stage:"CRAFTED"},cost:{copper:7,sp:0,materials:[]},refund:null};
   const recipe=await request("gm","recipes/versions",{actionId:id(),recipeId,expectedRevision:null,source:recipeSource,publish:true});
   let commits=0; const actionIds:string[]=[];
   await page.route("**/api/creation/**",async route=>{
    const req=route.request(),url=new URL(req.url()), action=req.method()==="POST"||req.method()==="PUT";
    const payload=action?req.postDataJSON():undefined;
    const response=await app.inject({method:req.method() as "GET"|"POST"|"PUT",url:url.pathname+url.search,
      headers:{cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`,
        "x-creation-campaign":campaignId,"x-creation-membership":player},payload});
    if(url.pathname.endsWith("/operations/commit")){
     commits++;actionIds.push(payload.actionId);
     if(commits===1){expect(response.statusCode,response.body).toBe(200);await route.abort("failed");return;}
    }
    await route.fulfill({status:response.statusCode,contentType:"application/json",body:response.body});
   });
   await page.setViewportSize({width:390,height:800});
   await page.goto(`/src/test-support/creation-objects-browser-fixture.html?campaign=${campaignId}&member=${player}&character=${characterId}`);
   await page.getByRole("button",{name:"Объекты и изготовление"}).click();
   await page.getByRole("combobox",{name:"Рецепт мастера"}).selectOption(recipe.versionId);
   await page.getByRole("button",{name:"Получить точный расчёт"}).click();
   await expect(page.getByRole("region",{name:"Подтверждение операции"})).toContainText("QA skill");
   await page.getByRole("button",{name:"Подтвердить расход и результат"}).click();
   await expect(page.getByRole("heading",{name:"Результат ещё не подтверждён"})).toBeVisible();
   await page.reload();
   await page.getByRole("button",{name:"Проверить / повторить то же действие"}).click();
   await page.getByRole("button",{name:"Объекты и изготовление"}).click();
   await expect(page.getByRole("heading",{name:"QA skill"})).toBeVisible();
   expect(commits).toBe(2);expect(actionIds[0]).toBe(actionIds[1]);
   expect(await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.characterId,characterId))).toHaveLength(1);
   const [character]=await db.select().from(schema.characters).where(eq(schema.characters.id,characterId));
   expect(character?.wallet).toMatchObject({gold:0,silver:9,copper:3,sp:10});
 } finally {await app.close();await pg.close();}
});

test("GM creates a rules draft through the system and reopens it after reload", async ({ page }) => {
 test.setTimeout(60000);
 const pg = await createMigratedPglite(), db = drizzle(pg, { schema }), app = Fastify();
 try {
  const campaignId = id(), gm = id(), player = id(), secret = "g".repeat(40), playerSecret = "p".repeat(40);
  await db.insert(schema.campaigns).values({ id: campaignId, name: "Synthetic GM campaign" });
  await db.insert(schema.memberships).values({ id: gm, campaignId, role: "GM", displayName: "GM" });
  await db.insert(schema.memberships).values({ id: player, campaignId, role: "PLAYER", displayName: "Player" });
  await db.insert(schema.sessions).values({ membershipId: gm, tokenHash: hashToken(secret), expiresAt: new Date(Date.now() + 120000) });
  await db.insert(schema.sessions).values({ membershipId: player, tokenHash: hashToken(playerSecret), expiresAt: new Date(Date.now() + 120000) });
  await app.register(cookie); registerCreationRoutes(app, db as never, async () => {}); await app.ready();
  let dropFirstRulesResponse = true;
  await page.route("**/api/creation/**", async route => {
   const request = route.request(), url = new URL(request.url());
   const payload = ["POST", "PUT"].includes(request.method()) ? request.postDataJSON() : undefined;
   const response = await app.inject({ method: request.method() as "GET" | "POST" | "PUT", url: url.pathname + url.search,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}`, "x-creation-campaign": campaignId, "x-creation-membership": gm }, payload });
   if (url.pathname.endsWith("/rules/versions") && dropFirstRulesResponse) {
    dropFirstRulesResponse = false; expect(response.statusCode, response.body).toBe(200); await route.abort("failed"); return;
   }
   await route.fulfill({ status: response.statusCode, contentType: "application/json", body: response.body });
  });
  await page.goto(`/src/test-support/creation-objects-browser-fixture.html?campaign=${campaignId}&member=${gm}&gm=1`);
  await page.getByRole("button", { name: "Настройки мастера" }).click();
  const rules = page.getByRole("group", { name: "Навыки · новый набор" });
  await rules.getByLabel("Название набора правил", { exact: true }).fill("Системные правила QA");
  await rules.getByRole("button", { name: "Сохранить черновик правил" }).click();
  await expect(page.getByRole("heading", { name: "Результат ещё не подтверждён" })).toBeVisible();
  await page.getByRole("button", { name: "Проверить / повторить то же действие" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Черновик правил" })).toContainText("сохранено");
  await expect(page.getByRole("group", { name: "Навыки · ревизия 0" })).toBeVisible();
  const saved = await db.select().from(schema.creationRulePacks).where(eq(schema.creationRulePacks.campaignId, campaignId));
  expect(saved).toHaveLength(1); expect(saved[0]?.enabled).toBe(false);
  const versions = await db.select().from(schema.creationRuleVersions).where(eq(schema.creationRuleVersions.packId, saved[0]!.id));
  expect(versions).toHaveLength(1); expect(versions[0]?.published).toBe(false);
  const editableName = page.getByRole("group", { name: "Навыки · ревизия 0" }).getByLabel("Название набора правил", { exact: true });
  await editableName.fill("Изменённый черновик QA");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Новые правила артефактов" }).click();
  await expect(editableName).toHaveValue("Изменённый черновик QA");
  await page.getByRole("button", { name: "Сохранить черновик правил" }).click();
  await expect(page.getByRole("group", { name: "Навыки · ревизия 1" })).toBeVisible();
  const updatedVersions = await db.select().from(schema.creationRuleVersions).where(eq(schema.creationRuleVersions.packId, saved[0]!.id));
  expect(updatedVersions).toHaveLength(2);
  expect(updatedVersions.map(v => (v.source as { name: string }).name).sort()).toEqual(["Изменённый черновик QA", "Системные правила QA"].sort());
  await page.reload();
  await page.getByRole("button", { name: "Настройки мастера" }).click();
  await page.getByRole("button", { name: "Системные правила QA · выключен" }).click();
  await expect(page.getByRole("group", { name: "Навыки · ревизия 1" }).getByLabel("Название набора правил", { exact: true })).toHaveValue("Изменённый черновик QA");
  const zero = { power: 0, priceCopper: 0, craftSp: 0, usageCost: 0 };
  const limits = { power: { min: 0, max: 100 }, priceCopper: { min: 0, max: 100 }, craftSp: { min: 0, max: 100 }, usageCost: { min: 0, max: 100 } };
  const adjustment = { power: { min: 0, max: 0 }, priceCopper: { min: 0, max: 0 }, craftSp: { min: 0, max: 0 }, usageCost: { min: 0, max: 0 } };
  const source = { format: 1, kind: "SKILL", name: "Опубликованные правила QA", description: "", slots: ["ACTION", "TARGET", "SCHOOL", "EFFECT", "MODIFIER", "LIMITATION"].map(slot => ({ slot, min: slot === "EFFECT" ? 1 : 0, max: 1 })),
   components: [{ id: "synthetic", name: "QA component", description: "", slot: "EFFECT", tags: [], parameters: [], contribution: zero,
     factorsBasisPoints: { power: 10000, priceCopper: 10000, craftSp: 10000, usageCost: 10000 }, requirements: [], materials: [], artifact: null,
     effects: [{ kind: "MANUAL", text: "Synthetic effect" }] }], compatibility: [], limits, manualAdjustment: adjustment, usageResource: null };
  const advanced = page.locator("details").filter({ has: page.getByText("Расширенный источник набора", { exact: true }) });
  await advanced.locator("summary").click();
  await advanced.locator("textarea").fill(JSON.stringify(source));
  await advanced.getByRole("button", { name: "Применить источник к форме" }).click();
  await expect(page.getByLabel("Название набора правил", { exact: true })).toHaveValue(source.name);
  await page.getByRole("button", { name: "Опубликовать эту версию правил" }).click();
  await expect(page.getByRole("group", { name: "Навыки · ревизия 2" })).toBeVisible();
  const playerRules = await app.inject({ method: "GET", url: "/api/creation/rules", headers: {
    cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}`, "x-creation-campaign": campaignId, "x-creation-membership": player } });
  expect(playerRules.statusCode, playerRules.body).toBe(200);
  expect(playerRules.json().items).toHaveLength(1);
  expect(playerRules.json().items[0]).toMatchObject({ name: source.name, enabled: true, activeVersion: { published: true } });
  expect(playerRules.json().items[0]).not.toHaveProperty("latestVersion");
  await page.getByLabel("Название набора правил", { exact: true }).fill("Секретный черновик QA");
  await page.getByRole("button", { name: "Сохранить черновик правил" }).click();
  await expect(page.getByRole("group", { name: "Навыки · ревизия 3" })).toBeVisible();
  const playerAfterDraft = await app.inject({ method: "GET", url: "/api/creation/rules", headers: {
    cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}`, "x-creation-campaign": campaignId, "x-creation-membership": player } });
  expect(playerAfterDraft.statusCode, playerAfterDraft.body).toBe(200);
  expect(playerAfterDraft.json().items[0]).toMatchObject({ name: source.name, activeVersion: { published: true } });
  expect(playerAfterDraft.body).not.toContain("Секретный черновик QA");
 } finally { await app.close(); await pg.close(); }
});
test("player and GM complete an approved creation and undo locally", async ({ page, browser }) => {
 test.setTimeout(120000);
 const pg=await createMigratedPglite(), db=drizzle(pg,{schema}), app=Fastify();
 try {
  const campaignId=id(), gm=id(), player=id(), characterId=id(), packId=id(), recipeId=id();
  const secrets={gm:"g".repeat(40), player:"p".repeat(40)};
  await db.insert(schema.campaigns).values({id:campaignId,name:"Synthetic"});
  await db.insert(schema.memberships).values([{id:gm,campaignId,role:"GM",displayName:"GM"},{id:player,campaignId,role:"PLAYER",displayName:"Player"}]);
  await db.insert(schema.sessions).values([{membershipId:gm,tokenHash:hashToken(secrets.gm),expiresAt:new Date(Date.now()+300000)},{membershipId:player,tokenHash:hashToken(secrets.player),expiresAt:new Date(Date.now()+300000)}]);
  await db.insert(schema.characters).values({id:characterId,campaignId,ownerMembershipId:player,name:"Synthetic player",wallet:{gold:1,silver:0,copper:0,sp:10}});
  await app.register(cookie); registerCreationRoutes(app,db as never,async()=>{});
  registerCharacterPlayRoutes(app,db as never,{to:()=>({emit:()=>{}})} as never,{broadcast:async()=>{},publishCharacter:async()=>{}}); await app.ready();
  let who:"gm"|"player"="gm";
  const headers=()=>({cookie:`${env.SESSION_COOKIE_NAME}=${secrets[who]}`,"x-creation-campaign":campaignId,"x-creation-membership":who==="gm"?gm:player});
  const request=async(path:string,payload:Record<string,unknown>)=>{const res=await app.inject({method:"POST",url:`/api/creation/${path}`,headers:headers(),payload});expect(res.statusCode,res.body).toBe(200);return res.json()};
  const zero={power:0,priceCopper:0,craftSp:0,usageCost:0};
  const range={power:{min:0,max:100},priceCopper:{min:0,max:100},craftSp:{min:0,max:100},usageCost:{min:0,max:100}};
  const manual={power:{min:0,max:0},priceCopper:{min:0,max:0},craftSp:{min:0,max:0},usageCost:{min:0,max:0}};
  const source={format:1,kind:"SKILL",name:"QA rules",description:"",slots:["ACTION","TARGET","SCHOOL","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="EFFECT"?1:0,max:1})),components:[{id:"effect",name:"QA effect",description:"",slot:"EFFECT",tags:[],parameters:[],contribution:zero,factorsBasisPoints:{power:10000,priceCopper:10000,craftSp:10000,usageCost:10000},requirements:[],materials:[],artifact:null,effects:[{kind:"ACTIVATION"},{kind:"USES",maximum:{base:2,terms:[]},recharge:"DAY"}]}],compatibility:[],limits:range,manualAdjustment:manual,usageResource:null};
  const rules=await request("rules/versions",{actionId:id(),packId,expectedRevision:null,source,publish:true});
  await page.route("**/api/creation/**",async route=>{const req=route.request(),url=new URL(req.url());const payload=["POST","PUT"].includes(req.method())?req.postDataJSON():undefined;const res=await app.inject({method:req.method() as "GET"|"POST"|"PUT",url:url.pathname+url.search,headers:headers(),payload});await route.fulfill({status:res.statusCode,contentType:"application/json",body:res.body})});
  who="player"; await page.goto(`/src/test-support/creation-objects-browser-fixture.html?campaign=${campaignId}&member=${player}&character=${characterId}`);
  await page.getByLabel("Название",{exact:true}).fill("Synthetic skill");
  await page.getByRole("combobox",{name:"Набор правил"}).selectOption(rules.versionId);
  await page.getByRole("checkbox",{name:"QA effect"}).check();
  await page.getByRole("button",{name:"Сохранить новую версию"}).click();
  await expect(page.getByRole("button",{name:"Synthetic skill"})).toBeVisible();
  const [template]=await db.select().from(schema.creationTemplates).where(eq(schema.creationTemplates.campaignId,campaignId));
  const [version]=await db.select().from(schema.creationTemplateVersions).where(eq(schema.creationTemplateVersions.templateId,template!.id));
  who="gm"; await page.goto(`/src/test-support/creation-objects-browser-fixture.html?campaign=${campaignId}&member=${gm}&gm=1`);
  await page.getByRole("button",{name:"Synthetic skill"}).click();
  await page.getByLabel("Причина решения").fill("Synthetic approval");
  await page.getByRole("button",{name:"Одобрить версию"}).click();
  await expect(page.getByText("Одобрено",{exact:false}).first()).toBeVisible();
  const recipeSource={format:1,name:"QA craft",reason:"QA",kind:"SKILL",operation:"CRAFT",inputs:[],output:{versionId:version!.id,level:1,stage:"CRAFTED"},cost:{copper:0,sp:0,materials:[]},refund:null};
  const recipe=await request("recipes/versions",{actionId:id(),recipeId,expectedRevision:null,source:recipeSource,publish:true});
  who="player"; await page.goto(`/src/test-support/creation-objects-browser-fixture.html?campaign=${campaignId}&member=${player}&character=${characterId}`);
  await page.getByRole("button",{name:"Объекты и изготовление"}).click();
  await page.getByRole("combobox",{name:"Рецепт мастера"}).selectOption(recipe.versionId);
  await page.getByRole("button",{name:"Получить точный расчёт"}).click();
  await page.getByRole("button",{name:"Подтвердить расход и результат"}).click();
  await expect(page.getByRole("heading",{name:"Synthetic skill"})).toBeVisible();
  const [object]=await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.characterId,characterId));
  await db.insert(schema.characterCatalogEntries).values({id:id(),characterId,kind:"ABILITY",name:"Ordinary ability",description:"",data:{activation:{type:"ACTION"},uses:{current:1,max:2,recharge:"DAY"}}});
  const sceneId=id();
  await db.insert(schema.scenes).values({id:sceneId,campaignId,name:"Synthetic scene",grid:{enabled:true,size:64,offsetX:0,offsetY:0,color:"#c8b78b",opacity:0.22}});
  await db.update(schema.campaigns).set({activeSceneId:sceneId}).where(eq(schema.campaigns.id,campaignId));
  const game=Fastify(); await game.register(cookie);
  const io=new SocketServer(game.server,{cors:{origin:"http://localhost:5173",credentials:true}});
  registerRealtime(io,db as never,game.log);
  registerRoutes(game,db as never,io as never);
  const gmContext=await browser.newContext({baseURL:"http://localhost:5173",viewport:{width:1600,height:1000}});
  try {
   // The Vite test proxy targets this loopback port. Never reuse a running
   // server: listen fails if anything else owns it.
   await game.listen({host:"127.0.0.1",port:4100});
   await page.context().addCookies([{name:env.SESSION_COOKIE_NAME,value:secrets.player,url:"http://localhost:5173"}]);
   await page.route("**/api/**",async route=>{
    const req=route.request(),url=new URL(req.url());
    const payload=["POST","PUT","PATCH","DELETE"].includes(req.method())?req.postData()??undefined:undefined;
    const res=await game.inject({method:req.method() as "GET"|"POST"|"PUT"|"PATCH"|"DELETE",url:url.pathname+url.search,
      headers:{...req.headers(),cookie:`${env.SESSION_COOKIE_NAME}=${secrets.player}`},payload});
    await route.fulfill({status:res.statusCode,contentType:res.headers["content-type"]?.toString()??"application/json",body:res.rawPayload});
   });
   await page.setViewportSize({width:1600,height:1000});
   await page.goto("/");
   await expect.poll(async()=>io.engine.clientsCount).toBe(1);
   await gmContext.addCookies([{name:env.SESSION_COOKIE_NAME,value:secrets.gm,url:"http://localhost:5173"}]);
   await gmContext.route("**/api/**",async route=>{
    const req=route.request(),url=new URL(req.url());
    const payload=["POST","PUT","PATCH","DELETE"].includes(req.method())?req.postData()??undefined:undefined;
    const res=await game.inject({method:req.method() as "GET"|"POST"|"PUT"|"PATCH"|"DELETE",url:url.pathname+url.search,
      headers:{...req.headers(),cookie:`${env.SESSION_COOKIE_NAME}=${secrets.gm}`},payload});
    await route.fulfill({status:res.statusCode,contentType:res.headers["content-type"]?.toString()??"application/json",body:res.rawPayload});
   });
   const gmPage=await gmContext.newPage(); await gmPage.goto("/");
   await expect.poll(async()=>io.engine.clientsCount).toBe(2);
   await expect(gmPage.locator(".workspace-nav:visible")).toBeVisible();
   await openWorkspaceSection(page,"Персонажи");
   const abilityRow=page.locator(".character-card__row:visible").filter({hasText:"Synthetic skill"});
   await expect(abilityRow).toBeVisible();
   await expect(abilityRow.getByRole("button",{name:"Редактировать"})).toHaveCount(0);
   await expect(abilityRow.getByRole("button",{name:"Удалить"})).toHaveCount(0);
   await expect(abilityRow.getByRole("button",{name:"Перезарядить"})).toHaveCount(0);
   const ordinary=page.locator(".character-card__row:visible").filter({hasText:"Ordinary ability"});
   await expect(ordinary.getByRole("button",{name:"Редактировать"})).toBeVisible();
   await expect(ordinary.getByRole("button",{name:"Удалить"})).toBeVisible();
   await expect(ordinary.getByRole("button",{name:"Перезарядить"})).toBeVisible();
   await abilityRow.getByRole("button",{name:"Активировать"}).click();
   await expect(page.getByRole("button",{name:"Отменить применение"}).first()).toBeVisible();
   await expect(gmPage.getByRole("button",{name:"Отменить применение"}).first()).toBeVisible();
   await page.getByRole("button",{name:"Отменить применение"}).first().click();
   await expect(page.getByText("Применение отменено").first()).toBeVisible();
   await expect(gmPage.getByText("Применение отменено").first()).toBeVisible();
   const [entry]=await db.select().from(schema.characterCatalogEntries).where(eq(schema.characterCatalogEntries.id,object!.entryId!));
   expect(entry?.data).toMatchObject({uses:{current:2,max:2}});
   // Seed only a synthetic recipe and materials; application and chat undo use
   // the real application components and the real registered server routes.
   const baseId=id(), stackId=id();
   await db.insert(schema.worldContent).values({id:baseId,slug:`qa-base-${baseId}`,type:"ITEM",name:"Synthetic base",lifecycle:"PUBLISHED"});
   await db.insert(schema.worldContentInstances).values({id:stackId,campaignId,worldContentId:baseId,inventoryCharacterId:characterId,quantity:1,discovered:true});
   const itemSource={...source,kind:"ARTIFACT",name:"QA consumable rules",slots:["BASE","MATERIAL","CORE","EFFECT","MODIFIER","LIMITATION"].map(slot=>({slot,min:slot==="BASE"?1:0,max:1})),components:[{...source.components[0],id:"base",slot:"BASE",artifact:{baseItemId:baseId,category:"CONSUMABLE",rarity:"QA"},effects:[{kind:"ACTIVATION"},{kind:"CONSUME_ITEM"}]}]};
   who="gm"; const itemRules=await request("rules/versions",{actionId:id(),packId:id(),expectedRevision:null,source:itemSource,publish:true});
   who="player"; const itemTemplate=await request("templates/versions",{actionId:id(),templateId:id(),expectedRevision:null,previousVersionId:null,ruleVersionId:itemRules.versionId,design:{name:"Synthetic consumable",lore:"",appearance:"",selections:[{componentId:"base",parameters:{}}],adjustments:zero,adjustmentReason:""}});
   who="gm"; await request("reviews",{actionId:id(),versionId:itemTemplate.versionId,expectedRevision:null,decision:"APPROVED",reason:"QA"});
   const itemRecipe=await request("recipes/versions",{actionId:id(),recipeId:id(),expectedRevision:null,publish:true,source:{format:1,name:"QA consumable craft",reason:"QA",kind:"ARTIFACT",operation:"CRAFT",inputs:[],output:{versionId:itemTemplate.versionId,level:1,stage:"CRAFTED"},cost:{copper:0,sp:0,materials:[{worldContentId:baseId,quantity:1}]},refund:null}});
   who="player";
   await openWorkspaceSection(page,"Мастерская");
   const workshop=page.getByRole("dialog",{name:"Мастерская"});
   await expect(workshop).toBeVisible();
   await workshop.getByRole("button",{name:"Объекты и изготовление"}).click();
   await workshop.getByRole("combobox",{name:"Рецепт мастера"}).selectOption(itemRecipe.versionId);
   const material=workshop.locator("label").filter({hasText:"Synthetic base"}).first();
   await material.locator("input").fill("1");
   await workshop.getByRole("button",{name:"Получить точный расчёт"}).click();
   await workshop.getByRole("button",{name:"Подтвердить расход и результат"}).click();
   await expect(workshop.getByRole("heading",{name:"Synthetic consumable"})).toBeVisible();
   await expect(workshop.getByText("Категория: Расходуемый предмет · редкость: QA")).toBeVisible();
   const [item]=await db.select().from(schema.creationObjects).where(eq(schema.creationObjects.versionId,itemTemplate.versionId));
   expect(item?.instanceId).toBeTruthy();
   await workshop.getByRole("button",{name:"Закрыть окно"}).click();
   await expect(workshop).toBeHidden();
   await openWorkspaceSection(page,"Персонажи");
   const itemRow=page.locator(".character-card__row:visible").filter({hasText:"Synthetic consumable"});
   await expect(itemRow).toBeVisible(); await itemRow.getByRole("button",{name:"Активировать"}).click();
   await expect.poll(async()=>(await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,item!.instanceId!)))[0]?.quantity).toBe(0);
   await expect(gmPage.getByRole("button",{name:"Отменить применение"}).first()).toBeVisible();
   await page.getByRole("button",{name:"Отменить применение"}).first().click();
   await expect.poll(async()=>(await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,item!.instanceId!)))[0]?.quantity).toBe(1);
   await expect(gmPage.getByText("Применение отменено")).toHaveCount(2);
   const [restored]=await db.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id,item!.instanceId!));
   expect(restored).toMatchObject({quantity:1,inventoryCharacterId:characterId});
   await openWorkspaceSection(page,"Мастерская");
   const reopened=page.getByRole("dialog",{name:"Мастерская"});
   await reopened.getByLabel("Название",{exact:true}).fill("Unsaved synthetic draft");
   await reopened.getByRole("button",{name:"Закрыть окно"}).click();
   await expect(reopened.getByRole("heading",{name:"Закрыть мастерскую?"})).toBeVisible();
   await reopened.getByRole("button",{name:"Продолжить редактирование"}).click();
   await expect(reopened.getByLabel("Название",{exact:true})).toHaveValue("Unsaved synthetic draft");
   await reopened.getByRole("combobox",{name:"Набор правил"}).selectOption(rules.versionId);
   await reopened.getByRole("checkbox",{name:"QA effect"}).check();
   await reopened.getByRole("button",{name:"Сохранить новую версию"}).click();
   await expect(reopened.getByRole("button",{name:"Unsaved synthetic draft"})).toBeVisible();
   await reopened.getByRole("button",{name:"Закрыть окно"}).click();
   await expect(reopened).toBeHidden();
   await openWorkspaceSection(gmPage,"Мастерская");
   const gmWorkshop=gmPage.getByRole("dialog",{name:"Мастерская"});
   await gmWorkshop.getByRole("button",{name:"Настройки мастера"}).click();
   await gmWorkshop.getByLabel("Название набора правил",{exact:true}).fill("Saved GM draft");
   await gmWorkshop.getByRole("button",{name:"Сохранить черновик правил"}).click();
   await expect(gmWorkshop.getByRole("group",{name:"Навыки · ревизия 0"})).toBeVisible();
   await gmWorkshop.getByRole("button",{name:"Закрыть окно"}).click();
   await expect(gmWorkshop).toBeHidden();
  } finally { await gmContext.close(); await io.close(); await game.close(); }
 } finally {await app.close();await pg.close();}
});
