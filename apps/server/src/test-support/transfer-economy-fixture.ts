import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {campaigns,characters,worldContent,worldContentInstances} from '@arken/db';
import type {AuthContext} from '../auth.js';
import {saveEconomyConfig,saveMerchant,saveShopOffer} from '../economy-admin.js';
import {quoteEconomy,purchaseEconomy} from '../economy-purchase.js';
type Database=ReturnType<typeof import('@arken/db').createDatabase>['db'];
export async function seedTransferEconomy(db:Database,auth:AuthContext){
 const [campaign]=await db.select().from(campaigns).where(eq(campaigns.id,auth.campaignId));if(!campaign?.name.startsWith('Synthetic')||auth.role!=='GM')throw Error('SYNTHETIC_ECONOMY_SCOPE_REQUIRED');
 const region=randomUUID(),item=randomUUID(),stock=randomUUID(),character=randomUUID(),merchant=randomUUID(),offer=randomUUID(),season=randomUUID();
 await db.insert(worldContent).values([{id:region,slug:'synthetic-region-'+region,name:'Synthetic region',type:'LOCATION',lifecycle:'PUBLISHED'},{id:item,slug:'synthetic-item-'+item,name:'Synthetic item',type:'ITEM',lifecycle:'PUBLISHED',basePriceCopper:10}]);
 await db.insert(worldContentInstances).values({id:stock,campaignId:auth.campaignId,worldContentId:item,quantity:3,discovered:true});
 await db.insert(characters).values({id:character,campaignId:auth.campaignId,ownerMembershipId:auth.membershipId,name:'Synthetic buyer',stats:{charisma:10},wallet:{gold:0,silver:0,copper:100,sp:0}});
 await saveEconomyConfig(db,auth,{actionId:randomUUID(),revision:null,config:{enabled:true,calendar:{anchorCampaignDay:1,anchorYear:1,months:[{name:'Synthetic month',days:30,seasonId:season}]},seasons:[{id:season,name:'Synthetic season',percent:100}],regions:[{worldContentId:region,percent:100}],charismaStatKey:'charisma',charismaBands:[{min:-100000,max:100000,percent:100}]}});
 await saveMerchant(db,auth,{actionId:randomUUID(),id:merchant,revision:null,name:'Synthetic merchant',regionId:region,visible:true,percent:100});
 await saveShopOffer(db,auth,{actionId:randomUUID(),id:offer,revision:null,merchantId:merchant,instanceId:stock,visible:true,supplyPercent:100,gmPercent:100,overrideCopper:null,reason:'Synthetic'});
 const quote=await quoteEconomy(db,auth,{characterId:character,offerId:offer,quantity:1});assert.equal(quote.affordable,true);const command={actionId:randomUUID(),quoteId:quote.id},receipt=await purchaseEconomy(db,auth,command);assert.deepEqual(await purchaseEconomy(db,auth,command),receipt);
 const [buyer]=await db.select().from(characters).where(eq(characters.id,character));const wallet=buyer!.wallet as {gold:number;silver:number;copper:number};assert.equal(wallet.gold*100+wallet.silver*10+wallet.copper,100-receipt.totalCopper);
 return {region,item,stock,character,merchant,offer,quote,receipt};
}
