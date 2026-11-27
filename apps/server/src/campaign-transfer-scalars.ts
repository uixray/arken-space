/** PostgreSQL UTF8 text/JSONB cannot store NUL or unpaired UTF16 surrogates. */
export function isCampaignTransferText(value:string){
 for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c===0)return false;if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
}
export function isCampaignTransferTimestamp(value:string){
 const m=/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d(?::?\d\d)?)$/.exec(value);if(!m)return false;
 const [year,month,day,hour,minute,second]=m.slice(1).map(Number) as [number,number,number,number,number,number];
 const days=[31,(year%4===0&&(year%100!==0||year%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
 return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1]!&&hour<=23&&minute<=59&&second<=59&&Number.isFinite(Date.parse(value));
}
