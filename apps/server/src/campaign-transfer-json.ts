import {isCampaignTransferText} from "./campaign-transfer-scalars.js";
/** Reject ambiguous object keys in already syntax-checked JSON without
 * reserializing values or rounding bigint tokens. Bounded recursion. */
export function assertCampaignTransferUniqueJsonKeys(raw:string){
 let i=0;const space=()=>{while(i<raw.length&&/\s/.test(raw[i]!))i++;};
 const string=()=>{const start=i++;while(i<raw.length){const c=raw[i++]!;if(c==='\\'){i++;continue;}if(c==='"'){const token=raw.slice(start,i);if(!isCampaignTransferText(JSON.parse(token) as string))throw Error('CAMPAIGN_TRANSFER_JSON_TEXT_INVALID');return token;}}throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');};
 const value=(depth:number):void=>{
  if(depth>128)throw Error('CAMPAIGN_TRANSFER_JSON_DEPTH_LIMIT');space();const c=raw[i];
  if(c==='"'){string();return;}
  if(c==='{'){
   i++;space();const keys=new Set<string>();if(raw[i]==='}'){i++;return;}
   while(i<raw.length){space();if(raw[i]!=='"')throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');const key=JSON.parse(string()) as string;if(keys.has(key))throw Error('CAMPAIGN_TRANSFER_JSON_DUPLICATE_KEY');keys.add(key);space();if(raw[i++]!==':')throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');value(depth+1);space();const next=raw[i++];if(next==='}')return;if(next!==',')throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');}
  }else if(c==='['){i++;space();if(raw[i]===']'){i++;return;}while(i<raw.length){value(depth+1);space();const next=raw[i++];if(next===']')return;if(next!==',')throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');}}
  else{const start=i;while(i<raw.length&&!/[\s,}\]]/.test(raw[i]!))i++;if(i===start)throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');return;}
  throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');
 };value(0);space();if(i!==raw.length)throw Error('CAMPAIGN_TRANSFER_JSON_SYNTAX_INVALID');
}
