// Shared input rules. No submitted URLs are fetched by the community service.
export const FIELDS = ['id','retailer','department','category','title','description','discount','code','merchant_url','conditions','expires_at','glitch','affiliate','referral_beneficiary','referral_reward'];
export class InputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function safeURL(value){
 if(typeof value!=='string'||value.length>1500||/[\s\u0000-\u001f\u007f]/u.test(value))throw new InputError('Use a full public HTTPS link.');
 let url;try{url=new URL(value);}catch{throw new InputError('Use a full public HTTPS link.');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||host.endsWith('.')||host.includes(':')||/^\[|^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|lan|test|invalid|example|onion)$/.test(host))throw new InputError('Use a public retailer HTTPS link, without credentials or a custom port.');
 return url.href;
}
function text(data,key,min,max){const value=data[key]??'';if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw new InputError('Check '+key.replaceAll('_',' ')+'.');return value.trim();}
export function normaliseOffer(data,now=Date.now()){
 if(!data||Array.isArray(data)||typeof data!=='object')throw new InputError('Offer fields are required.');
 if(Object.keys(data).some(k=>!FIELDS.includes(k)))throw new InputError('This field cannot be changed here.');
 const result={id:text(data,'id',3,60),retailer:text(data,'retailer',1,80),department:text(data,'department',0,50),category:text(data,'category',1,10),title:text(data,'title',3,140),description:text(data,'description',0,400),discount:text(data,'discount',1,30),code:text(data,'code',0,80),merchant_url:safeURL(data.merchant_url),conditions:text(data,'conditions',10,1500),expires_at:text(data,'expires_at',10,40),glitch:data.glitch??false,affiliate:data.affiliate??false,referral_beneficiary:text(data,'referral_beneficiary',0,120),referral_reward:text(data,'referral_reward',0,300)};
 if(!/^[a-z0-9][a-z0-9-]{2,59}$/.test(result.id)||!['tech','fashion','food','other'].includes(result.category)||typeof result.glitch!=='boolean'||typeof result.affiliate!=='boolean')throw new InputError('Check the offer ID, category and flags.');
 const expiry=Date.parse(result.expires_at);if(!Number.isFinite(expiry)||expiry<=now||expiry>now+366*86400000)throw new InputError('Choose an expiry within the next year.');
 result.expires_at=new Date(expiry).toISOString();
 if((result.affiliate||result.referral_beneficiary||result.referral_reward)&&(!result.referral_beneficiary||!result.referral_reward))throw new InputError('State who benefits and the reward or commission conditions.');
 return result;
}
export function proposalInput(data){
 if(!Number.isSafeInteger(data.base_revision)||data.base_revision<0)throw new InputError('Load the latest offer before editing.');
 return {offer:normaliseOffer(data.offer),base_revision:data.base_revision,summary:text(data,'summary',10,500),source_url:safeURL(data.source_url)};
}
export function publicSnapshot(value){return Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));}
export function fieldDiff(before={},after={}){return FIELDS.filter(k=>JSON.stringify(before[k]??'')!==JSON.stringify(after[k]??'')).map(field=>({field,before:before[field]??'',after:after[field]??''}));}
