// Shared input rules. No submitted URLs are fetched by the community service.
const FIELDS = ['id','retailer','department','category','title','description','discount','code','merchant_url','conditions','expires_at','glitch','affiliate','referral_beneficiary','referral_reward'];
class InputError extends Error { constructor(message,status=400){super(message);this.status=status;} }
function safeURL(value){
 if(typeof value!=='string'||value.length>1500||/[\s\u0000-\u001f\u007f]/u.test(value))throw new InputError('Use a full public HTTPS link.');
 let url;try{url=new URL(value);}catch{throw new InputError('Use a full public HTTPS link.');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||host.endsWith('.')||host.includes(':')||/^\[|^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|lan|test|invalid|example|onion)$/.test(host))throw new InputError('Use a public retailer HTTPS link, without credentials or a custom port.');
 return url.href;
}
function text(data,key,min,max){const value=data[key]??'';if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw new InputError('Check '+key.replaceAll('_',' ')+'.');return value.trim();}
function normaliseOffer(data,now=Date.now()){
 if(!data||Array.isArray(data)||typeof data!=='object')throw new InputError('Offer fields are required.');
 if(Object.keys(data).some(k=>!FIELDS.includes(k)))throw new InputError('This field cannot be changed here.');
 const result={id:text(data,'id',3,60),retailer:text(data,'retailer',1,80),department:text(data,'department',0,50),category:text(data,'category',1,10),title:text(data,'title',3,140),description:text(data,'description',0,400),discount:text(data,'discount',1,30),code:text(data,'code',0,80),merchant_url:safeURL(data.merchant_url),conditions:text(data,'conditions',10,1500),expires_at:text(data,'expires_at',10,40),glitch:data.glitch??false,affiliate:data.affiliate??false,referral_beneficiary:text(data,'referral_beneficiary',0,120),referral_reward:text(data,'referral_reward',0,300)};
 if(!/^[a-z0-9][a-z0-9-]{2,59}$/.test(result.id)||!['tech','fashion','food','other'].includes(result.category)||typeof result.glitch!=='boolean'||typeof result.affiliate!=='boolean')throw new InputError('Check the offer ID, category and flags.');
 const expiry=Date.parse(result.expires_at);if(!Number.isFinite(expiry)||expiry<=now||expiry>now+366*86400000)throw new InputError('Choose an expiry within the next year.');
 result.expires_at=new Date(expiry).toISOString();
 if((result.affiliate||result.referral_beneficiary||result.referral_reward)&&(!result.referral_beneficiary||!result.referral_reward))throw new InputError('State who benefits and the reward or commission conditions.');
 return result;
}
function proposalInput(data){
 if(!Number.isSafeInteger(data.base_revision)||data.base_revision<0)throw new InputError('Load the latest offer before editing.');
 return {offer:normaliseOffer(data.offer),base_revision:data.base_revision,summary:text(data,'summary',10,500),source_url:safeURL(data.source_url)};
}
function publicSnapshot(value){return Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));}
function fieldDiff(before={},after={}){return FIELDS.filter(k=>JSON.stringify(before[k]??'')!==JSON.stringify(after[k]??'')).map(field=>({field,before:before[field]??'',after:after[field]??''}));}


const COMMUNITY_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Vary':'Cookie, Authorization','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const ACCESS='__Host-fluqon-access',REFRESH='__Host-fluqon-refresh';
function answer(data,status=200,headers={}){return Response.json(data,{status,headers:{...COMMUNITY_HEADERS,...headers}});}
function cookies(request){const result={};for(const pair of (request.headers.get('cookie')||'').split(';')){const i=pair.indexOf('=');if(i>0)result[pair.slice(0,i).trim()]=pair.slice(i+1);}return result;}
function cookie(name,value,age){return `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;}
function sessionResponse(data,result){
 if(typeof result.access_token!=='string'||typeof result.refresh_token!=='string'||result.access_token.length>8192||result.refresh_token.length>8192)throw new InputError('Sign-in is temporarily unavailable.',503);
 const response=answer(data);response.headers.append('Set-Cookie',cookie(ACCESS,result.access_token,Math.min(Number(result.expires_in)||3600,3600)));response.headers.append('Set-Cookie',cookie(REFRESH,result.refresh_token,86400));return response;
}
async function signout(request,env,send){
 const stored=cookies(request);
 const finish=(data,status=200)=>{const response=answer(data,status);response.headers.append('Set-Cookie',cookie(ACCESS,'',0));response.headers.append('Set-Cookie',cookie(REFRESH,'',0));return response;};
 const read=name=>{try{const value=decodeURIComponent(stored[name]||'');return value&&value.length<=8192?value:'';}catch{return '';}};
 let access=read(ACCESS);const refresh=read(REFRESH);
 if(!stored[ACCESS]&&!stored[REFRESH])return finish({ok:true,localSignedOut:true,providerRevoked:false,message:'Signed out of this browser.'});
 try{
  if(!env.SUPABASE_PUBLISHABLE_KEY)throw new Error('auth_unconfigured');
  const revoke=async token=>send(settingURL(env,'SUPABASE_URL','/auth/v1/logout?scope=local'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(access){
   const response=await revoke(access),accepted=response.ok,retry=response.status===401||response.status===403;await response.body?.cancel();
   if(accepted)return finish({ok:true,localSignedOut:true,providerRevoked:true,message:'Signed out.'});
   if(!retry||!refresh)throw new Error('logout_unconfirmed');
  }
  if(!refresh)throw new Error('refresh_unavailable');
  const response=await send(settingURL(env,'SUPABASE_URL','/auth/v1/token?grant_type=refresh_token'),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000),redirect:'error'});
  const renewed=await limitedJSON(response);
  if(typeof renewed.access_token!=='string'||!renewed.access_token||renewed.access_token.length>8192)throw new Error('refresh_invalid');
  access=renewed.access_token;
  const revoked=await revoke(access),accepted=revoked.ok;await revoked.body?.cancel();
  if(!accepted)throw new Error('logout_unconfirmed');
  return finish({ok:true,localSignedOut:true,providerRevoked:true,message:'Signed out.'});
 }catch{
  return finish({ok:false,localSignedOut:true,providerRevoked:false,error:'Signed out of this browser. We could not confirm server sign-out.'},503);
 }
}
async function limitedJSON(response,max=65536,overflowStatus=503,allowError=false){
 if(!response.ok&&!allowError){await response.body?.cancel();throw new InputError('The service could not complete that request. Try again shortly.',response.status===429?429:503);}
 const reader=response.body?.getReader();if(!reader)throw new InputError('Empty service response.',503);let length=0,parts=[];
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>max){await reader.cancel();throw new InputError('Request or service response too large.',overflowStatus);}parts.push(r.value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function body(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new InputError('Send JSON fields.');try{const value=await limitedJSON(new Response(request.body),14000,413);if(!value||typeof value!=='object'||Array.isArray(value))throw new InputError('Send JSON fields.');return value;}catch(error){if(error instanceof SyntaxError)throw new InputError('Send valid JSON fields.');throw error;}}
async function sha(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
async function matchKey(value,expected){
 if(typeof value!=='string'||value.length!==64||typeof expected!=='string'||expected.length!==64)return false;
 const digest=await sha(value);const a=new TextEncoder().encode(digest),b=new TextEncoder().encode(expected);
 if(typeof crypto.subtle.timingSafeEqual==='function')return crypto.subtle.timingSafeEqual(a,b);
 // Fixed-size comparison also permits local Node tests; Workers uses timingSafeEqual above.
 let difference=0;for(let i=0;i<64;i++)difference|=a[i]^b[i];return difference===0;
}
function settingURL(env,key,path){const value=env[key];if(!value)throw new InputError('Community service is not connected yet.',503);const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw new InputError('Community service configuration is invalid.',503);return new URL(path,u.origin).href;}
async function user(request,env,send){
 let token;try{token=decodeURIComponent(cookies(request)[ACCESS]||'');}catch{throw new InputError('Sign in again.',401);}
 if(!token||token.length>8192)throw new InputError('Sign in to contribute.',401);
 const response=await send(settingURL(env,'SUPABASE_URL','/auth/v1/user'),{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok){await response.body?.cancel();throw new InputError('Your contributor session ended. Sign in again.',401);}
 const data=await limitedJSON(response);
 if(!/^[a-f0-9-]{36}$/i.test(data.id)||data.is_anonymous===true||!data.email_confirmed_at)throw new InputError('A confirmed contributor account is required.',403);
 return data.id;
}
async function communityRPC(env,operation,payload={},actor=null,bucket='',operator=false,send=fetch){
 if(!env.BACKEND_URL||!env.API_GATEWAY_KEY)throw new InputError('Community service is not connected yet.',503);
 const response=await send(env.BACKEND_URL,{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'community',data:{operation,payload,actor_id:actor,operator_access:operator},bucket}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const result=await limitedJSON(response,1024*1024,503,true);if(result.error)throw new InputError(result.error,result.status||(response.status>=400?response.status:400));if(!response.ok)throw new InputError('Community service unavailable.',response.status>=500?503:response.status);return result;
}
async function handleCommunity(request,env,options={}){
 const send=options.fetch||fetch,url=new URL(request.url),path=url.pathname.slice('/api/community'.length),method=request.method;
 try{
  const origin=env.PUBLIC_ORIGIN||'https://fluqon.qpon';const permitted=new Set([origin,...(env.PREVIEW_ORIGIN?[env.PREVIEW_ORIGIN]:[])]);
  if(!permitted.has(url.origin))return answer({error:'This address is not enabled.'},403);
  if(!['GET','POST'].includes(method))return answer({error:'Method not allowed.'},405,{'Allow':'GET, POST'});
  if(method==='POST'&&(!permitted.has(request.headers.get('origin'))||request.headers.get('sec-fetch-site')==='cross-site'))return answer({error:'Request origin not accepted.'},403);
  if(path==='/auth/signout'&&method==='POST')return signout(request,env,send);
  const enabled=env.COMMUNITY_ENABLED==='true'&&env.COMMUNITY_LICENCE_ACCEPTED==='true';
  if(path==='/config'&&method==='GET')return answer({enabled,authEnabled:enabled&&env.COMMUNITY_AUTH_ENABLED==='true',sitekey:env.TURNSTILE_SITEKEY||'',termsVersion:'community-v1',stage:enabled?'pilot':'private preparation'});
  if(!enabled)return answer({error:'Community editing is being prepared. The existing feed remains available.'},503);
  const rpc=(op,payload={},actor=null,bucket='',operator=false)=>communityRPC(env,op,payload,actor,bucket,operator,send);
  if(path==='/history'&&method==='GET')return answer(await rpc('history',{id:url.searchParams.get('id')||''}));
  let data=method==='POST'?await body(request):{};
  const bucketKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.API_GATEWAY_KEY||''),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bucket=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',bucketKey,new TextEncoder().encode((request.headers.get('CF-Connecting-IP')||'local')+'|'+new Date().toISOString().slice(0,10)))),x=>x.toString(16).padStart(2,'0')).join('');
  if(path.startsWith('/auth/')){
   if(method!=='POST')return answer({error:'Method not allowed.'},405);
   if(env.COMMUNITY_AUTH_ENABLED!=='true'||!env.SUPABASE_PUBLISHABLE_KEY)throw new InputError('Contributor sign-in is not open yet.',503);
   if(!['/auth/request','/auth/verify','/auth/refresh'].includes(path))return answer({error:'Not found.'},404);
   await rpc('auth_limit',{},null,bucket);
   if(path!=='/auth/refresh'){
    if(typeof data.turnstile!=='string'||data.turnstile.length>2048||!data.turnstile)throw new InputError('Complete the security check.',403);
    const check=await limitedJSON(await send('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:data.turnstile}),signal:AbortSignal.timeout(10000),redirect:'error'}));
    if(check.success!==true||check.action!=='community_login'||check.hostname!==url.hostname)throw new InputError('Security check expired. Try again.',403);
    if(typeof data.email!=='string'||data.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw new InputError('Enter a valid email address.');
   }
   const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'};
   if(path==='/auth/request'){
    const r=await send(settingURL(env,'SUPABASE_URL','/auth/v1/otp'),{method:'POST',headers,body:JSON.stringify({email:data.email.trim().toLowerCase(),create_user:true}),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(r.status>=500){await r.body?.cancel();throw new InputError('Sign-in email is temporarily unavailable.',503);}await r.body?.cancel();
    return answer({ok:true,message:'If sign-in is available, check your inbox for a code. Then complete the fresh security check below.'});
   }
   if(path==='/auth/verify'){
    if(typeof data.token!=='string'||!/^\d{6,10}$/.test(data.token))throw new InputError('Enter the email code.');
    const r=await send(settingURL(env,'SUPABASE_URL','/auth/v1/verify'),{method:'POST',headers,body:JSON.stringify({type:'email',email:data.email.trim().toLowerCase(),token:data.token}),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!r.ok){await r.body?.cancel();throw new InputError('The code is invalid or expired.',401);}const session=await limitedJSON(r);
    if(session.user?.is_anonymous===true||!session.user?.email_confirmed_at)throw new InputError('Confirmed account required.',403);
    return sessionResponse({ok:true,message:'Signed in. Your email stays private.'},session);
   }
   let refresh;try{refresh=decodeURIComponent(cookies(request)[REFRESH]||'');}catch{}
   if(!refresh||refresh.length>8192)throw new InputError('Sign in again.',401);
   const r=await send(settingURL(env,'SUPABASE_URL','/auth/v1/token?grant_type=refresh_token'),{method:'POST',headers,body:JSON.stringify({refresh_token:refresh}),signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!r.ok){await r.body?.cancel();throw new InputError('Sign in again.',401);}return sessionResponse({ok:true},await limitedJSON(r));
  }
  const operator=await matchKey(request.headers.get('authorization')?.replace(/^Bearer /,''),env.ADMIN_KEY_HASH);
  const actor=operator?null:await user(request,env,send);
  if(path==='/me'&&method==='GET')return answer(operator?{member:{handle:'operator',role:'maintainer'},proposals:[]}:await rpc('me',{},actor));
  if(path==='/draft'&&method==='GET')return answer(await rpc('draft',{id:url.searchParams.get('id')||''},actor,bucket,operator));
  if(path==='/queue'&&method==='GET')return answer(await rpc('queue',{},actor,bucket,operator));
  if(method!=='POST')return answer({error:'Not found.'},404);
  let operation,payload;
  if(path==='/profile'){
   if(data.consent!==true||data.terms_version!=='community-v1'||typeof data.handle!=='string'||!/^[a-z][a-z0-9_-]{2,31}$/.test(data.handle))throw new InputError('Choose a public name and accept the contributor terms.');
   operation='profile';payload={handle:data.handle,consent:true,terms_version:'community-v1'};
  }else if(path==='/submit'){operation='submit';payload=proposalInput(data);}
  else if(path==='/withdraw'){operation='withdraw';payload={id:data.id};}
  else if(path==='/note'){
   if(typeof data.body!=='string'||data.body.trim().length<10||data.body.length>1000)throw new InputError('Use 10–1,000 characters.');operation='note';payload={offer_id:data.offer_id,body:data.body.trim()};
  }else if(path==='/review'){
   if(!['approve','reject'].includes(data.decision))throw new InputError('Choose approve or reject.');
   operation='review';payload={id:data.id,decision:data.decision,review_note:data.review_note};
   if(data.decision==='approve'){
    if(!['merchant','checkout'].includes(data.method)||typeof data.evidence!=='string'||data.evidence.trim().length<15||data.evidence.length>2500)throw new InputError('Record the actual check and method.');
    Object.assign(payload,{source_url:safeURL(data.source_url),method:data.method,evidence:data.evidence.trim()});
   }
  }else if(path==='/member'){operation='member';payload={handle:data.handle,role:data.role,blocked:data.blocked};}
  else if(path==='/moderate-note'){operation='moderate_note';payload={id:data.id,status:data.status};}
  else if(path==='/redact'){operation='redact';payload={id:data.id,revision:data.revision,reason:data.reason};}
  else return answer({error:'Not found.'},404);
  return answer(await rpc(operation,payload,actor,bucket,operator));
 }catch(error){return answer({error:error instanceof InputError?error.message:'Could not complete that request. Try again shortly.'},error instanceof InputError?error.status:503);}
}

// Marketing campaigns stay drafts for operator review in Brevo. Never auto-send.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function campaignContent(offers){
 return '<html><body style="margin:0;background:#0E1012;color:#F3F4F6;font-family:Arial,sans-serif;padding:28px"><h1>fluqon.qpon</h1><p>Fluke on Coupon.</p><p>Checked offers. Retailer terms still apply. Recheck the live page before buying.</p>'+offers.slice(0,12).map(o=>'<section style="border:1px solid #2A2F35;padding:18px;margin:18px 0"><p>'+esc(o.retailer)+'</p><h2>'+esc(o.title)+'</h2><p style="font-family:monospace;color:#D4FF00">'+esc(o.discount)+'</p><p>'+esc(o.conditions)+'</p><p><a style="color:#D4FF00" href="https://fluqon.qpon/offers/'+esc(o.id)+'">Check the offer ↗</a></p></section>').join('')+'<p><a style="color:#D4FF00" href="{{ unsubscribe }}">unsubscribe.fluq_</a> — leave at any time.</p><p><a style="color:#8A929B" href="https://valavai.au/">James-Anthony Gregory Giorlando</a> trading as <a style="color:#8A929B" href="https://polymathfactor.app/">fluqon qpon</a>.<br>ABN 67 546 382 618<br>sayvon@fluqon.qpon</p><p><a style="color:#8A929B" href="https://fluqon.qpon/privacy">Privacy</a></p></body></html>';
}
async function draftCampaign(env,offers){
 if(!env.BREVO_API_KEY||!env.BREVO_LIST_ID||!env.BREVO_SENDER||env.EMAIL_DELIVERY_TESTED!=='true')return {error:'Brevo is not connected and delivery-tested yet.',status:503};
 if(!offers.length)return {error:'No current checked offers to include.',status:400};
 const response=await fetch('https://api.brevo.com/v3/emailCampaigns',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({name:'fluqon.qpon '+new Date().toISOString(),type:'classic',sender:{email:env.BREVO_SENDER,name:'fluqon.qpon'},subject:offers.length+' checked offers — fluqon.qpon',previewText:'Fluke on Coupon. Read the conditions, then check the checkout.',htmlContent:campaignContent(offers),recipients:{listIds:[Number(env.BREVO_LIST_ID)]},replyTo:'sayvon@fluqon.qpon',mirrorActive:false,inlineImageActivation:false}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)return {error:'Brevo could not prepare this draft. Nothing was sent.',status:503};
 const result=await response.json();return {ok:true,id:result.id,message:'Alert draft '+result.id+' prepared in Brevo. Review its offers, recipients, unsubscribe link and tracking settings before sending.'};
}

// Pages gateway. Secrets are Cloudflare bindings, never public assets.
const origins = env => new Set([env.PUBLIC_ORIGIN||'https://fluqon.qpon',...(env.PREVIEW_ORIGIN?[env.PREVIEW_ORIGIN]:[])]);
const backendURL = env => { if(!env.BACKEND_URL)throw new Error('backend_unconfigured');return env.BACKEND_URL; };
const SECURITY={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), clipboard-write=(self), web-share=(self)','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests"};
const json = (value, status=200) => Response.json(value,{status,headers:{...SECURITY,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function readBody(request) {
 if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('content');
 const reader=request.body?.getReader(); if(!reader) throw new Error('body');
 let size=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>14000){await reader.cancel();throw new Error('size');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
async function secureMatch(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;return crypto.subtle.timingSafeEqual(new TextEncoder().encode(a),new TextEncoder().encode(b));}
export default {
 async fetch(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/community/'))return handleCommunity(request,env);
  if(/^\/(report|subscribe|contribute|community-review|history|community-guide)(?:\/|\.html)?$/.test(path)){
   const asset=await env.ASSETS.fetch(request);const headers=new Headers(asset.headers);
   for(const [k,v] of Object.entries(SECURITY))headers.set(k,v);
   headers.set('Content-Security-Policy',SECURITY['Content-Security-Policy'].replace("script-src 'self'","script-src 'self' https://challenges.cloudflare.com").replace("connect-src 'self'","connect-src 'self' https://challenges.cloudflare.com").replace("frame-src 'none'","frame-src https://challenges.cloudflare.com"));
   headers.set('Cache-Control','no-store');return new Response(asset.body,{status:asset.status,headers});
  }
  if(path.startsWith('/offers/')||path==='/feed.xml'||path.startsWith('/s/'))return publicRoute(request,env);
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
  try {
   if(!origins(env).has(url.origin))return json({error:'This address is not enabled.'},403);
   if(path==='/api/config'&&request.method==='GET')return json({sitekey:env.TURNSTILE_SITEKEY,signupEnabled:env.SIGNUP_ENABLED==='true'&&env.EMAIL_DELIVERY_TESTED==='true'&&!!env.BREVO_API_KEY});
   if(path==='/api/brevo/webhook'){
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    const provided=request.headers.get('x-fluqon-webhook')||'';
    if(!env.BREVO_WEBHOOK_HASH||provided.length>200||!(await secureMatch(await hash(provided),env.BREVO_WEBHOOK_HASH)))return json({error:'Unauthorised.'},401);
    const event=await readBody(request);
    if(!['unsubscribed','spam','hard_bounce','hardBounce'].includes(event.event))return json({ok:true});
    if(typeof event.email!=='string'||event.email.length>254)return json({error:'Invalid email.'},400);
    const r=await fetch(backendURL(env),{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'provider_unsubscribe',data:{email:event.email},bucket:''}),signal:AbortSignal.timeout(10000)});
    return json({ok:r.ok},r.ok?200:503);
   }
   const isAdmin=path.startsWith('/api/admin/');
   if(isAdmin){const key=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';if(key.length>200||!(await secureMatch(await hash(key),env.ADMIN_KEY_HASH)))return json({error:'Operator key required.'},401);}
   let action='',data={};
   if(request.method==='GET'){
    if(path==='/api/offers')action='feed';
    else if(isAdmin&&path==='/api/admin/dashboard')action='dashboard';
    else return json({error:'Page not found.'},404);
   }else if(request.method==='POST'){
    if(!origins(env).has(request.headers.get('origin')))return json({error:'Request origin not accepted.'},403);
    data=await readBody(request);
    const routes={'/api/reports':'report','/api/subscribe':'subscribe','/api/subscription/confirm':'confirm','/api/subscription/unsubscribe':'unsubscribe','/api/admin/offer':'save_offer','/api/admin/check':'check_offer','/api/admin/publish':'publish_offer','/api/admin/status':'set_status','/api/admin/report':'resolve_report','/api/admin/alert-draft':'prepare_alert'};
    action=routes[path];if(!action)return json({error:'Page not found.'},404);
    if(['subscribe','confirm'].includes(action)&&(env.SIGNUP_ENABLED!=='true'||env.EMAIL_DELIVERY_TESTED!=='true'||!env.BREVO_API_KEY))return json({error:'Email sign-ups are not open yet.'},503);
    if(['report','subscribe'].includes(action)){
     if(typeof data.turnstile!=='string'||!data.turnstile||data.turnstile.length>2048)return json({error:'Complete the security check.'},403);
     const check=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:data.turnstile}),signal:AbortSignal.timeout(10000)});
     const result=check.ok?await check.json():{};
     if(result.success!==true||result.action!==action||result.hostname!==url.hostname)return json({error:'Security check expired. Please try again.'},403);
     delete data.turnstile;
    }
   }else return json({error:'Method not allowed.'},405);
   // Rotating HMAC bucket provides short-lived abuse control without storing raw IPs.
   const ip=request.headers.get('CF-Connecting-IP')||'unavailable';
   const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.API_GATEWAY_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const bucket=[...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(ip+'|'+new Date().toISOString().slice(0,10))))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(action==='prepare_alert'){const feedResponse=await fetch(backendURL(env),{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'feed',data:{},bucket}),signal:AbortSignal.timeout(10000)});if(!feedResponse.ok)return json({error:'Could not read the current feed.'},503);const feed=await feedResponse.json();const campaign=await draftCampaign(env,feed.offers);return json(campaign,campaign.status||200);}
   const response=await fetch(backendURL(env),{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action,data,bucket}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)return json({error:response.status===429?'Too many requests. Try again later.':'Could not complete that request. Please try again.'},response.status>=500?503:response.status);
   const result=await response.json();
   if(action==='feed')await enrichReferrals(result,env);
   if(action==='subscribe'&&result.confirmToken){
    try{await sendConfirmation(env,data.email,result.confirmToken);}catch{return json({error:'Confirmation delivery is unavailable. Please try again later.'},503);}
    return json({ok:true,message:'If confirmation is needed, check your inbox. No alerts until you confirm.'});
   }
   if(action==='confirm'&&result.email){
    // Confirmed contacts alone may enter the marketing list. Keep collection closed until this is tested.
    if(!env.BREVO_API_KEY||!env.BREVO_LIST_ID)return json({error:'Email setup is not complete.'},503);
    const sync=await fetch('https://api.brevo.com/v3/contacts',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:result.email,listIds:[Number(env.BREVO_LIST_ID)],updateEnabled:true,emailBlacklisted:false}),signal:AbortSignal.timeout(10000)});
    if(!sync.ok)return json({error:'Could not finish confirmation. Try this link again later.'},503);
    return json({ok:true,message:'Confirmed. You are on the list.'});
   }
   if(action==='unsubscribe'&&result.email&&env.BREVO_API_KEY){
    const sync=await fetch('https://api.brevo.com/v3/contacts/'+encodeURIComponent(result.email),{method:'PUT',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({emailBlacklisted:true,unlinkListIds:env.BREVO_LIST_ID?[Number(env.BREVO_LIST_ID)]:[]}),signal:AbortSignal.timeout(10000)});
    // Local suppression is immediate. Provider failures are recorded for operator retry.
    if(!sync.ok)await fetch(backendURL(env),{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'email_sync_failed',data:{email:result.email},bucket}),signal:AbortSignal.timeout(10000)});
   }
   if(['confirm','unsubscribe'].includes(action))return json({ok:true,message:action==='unsubscribe'?'Unsubscribed. No more alerts.':result.message});
   return json(result);
  }catch(error){console.error(JSON.stringify({event:'api_request_failed',kind:error?.name||'Error'}));return json({error:'Could not complete that request. Please try again.'},503);}
 }
};
async function sendConfirmation(env,email,token){
 const link='https://fluqon.qpon/subscription#confirm='+token;
 const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{name:'fluqon.qpon',email:env.BREVO_SENDER},replyTo:{name:'fluqon.qpon',email:'sayvon@fluqon.qpon'},to:[{email}],subject:'Confirm your fluqon.qpon alerts',textContent:'You asked for fluqon.qpon deal alerts. Confirm here:\n'+link+'\n\nThis link expires in 24 hours. If this was not you, ignore it. No confirmation means no alerts.\n\nJames-Anthony Gregory Giorlando trading as fluqon qpon. ABN 67 546 382 618. sayvon@fluqon.qpon',htmlContent:'<html><body style="background:#0E1012;color:#F3F4F6;font-family:Arial,sans-serif;padding:32px"><h1>fluqon.qpon</h1><p>Fluke on Coupon.</p><p>You asked for deal alerts. Confirm your address to join.</p><p><a style="color:#D4FF00" href="'+link+'">confirm.fluq_</a></p><p>This link expires in 24 hours. If this was not you, ignore it. No confirmation means no alerts.</p><p><a style="color:#8A929B" href="https://valavai.au/">James-Anthony Gregory Giorlando</a> trading as <a style="color:#8A929B" href="https://polymathfactor.app/">fluqon qpon</a>.<br>ABN 67 546 382 618 · sayvon@fluqon.qpon</p></body></html>',headers:{'X-Mailin-track':'0'}}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('mail_delivery');
}

const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function publicRoute(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!origins(env).has(url.origin))return json({error:'This address is not enabled.'},403);
 if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
 const sample={'fluq':'/','jb80':'/deals/jb-audio','nike30':'/deals/nike-retail','dock47':'/deals/amazon-glitch','fresh20':'/deals/woolies-food','iconic25':'/deals/iconic-fashion','first15':'/deals/coles-food'};
 const shortId=path.startsWith('/s/')?path.slice(3):null;if(shortId&&Object.hasOwn(sample,shortId))return Response.redirect(url.origin+sample[shortId],302);
 try{
  const response=await fetch(backendURL(env),{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'feed',data:{},bucket:''}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error();const feed=await response.json();await enrichReferrals(feed,env);
  if(path==='/feed.xml'){
   const xml='<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>fluqon.qpon</title><link>https://fluqon.qpon/</link><description>Fluke on Coupon. Current checked offers.</description>'+feed.offers.map(o=>'<item><title>'+htmlEscape(o.title)+'</title><link>https://fluqon.qpon/offers/'+o.id+'</link><guid>https://fluqon.qpon/offers/'+o.id+'</guid><description>'+htmlEscape(o.conditions)+'</description><pubDate>'+new Date(o.checkedAt).toUTCString()+'</pubDate></item>').join('')+'</channel></rss>';
   return new Response(request.method==='HEAD'?null:xml,{headers:{...SECURITY,'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-store'}});
  }
  const id=shortId||path.slice('/offers/'.length),offer=feed.offers.find(o=>o.id===id);
  if(!offer){const fallback=await env.ASSETS.fetch(new Request(url.origin+'/404.html',request));return new Response(request.method==='HEAD'?null:fallback.body,{status:404,headers:{...SECURITY,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
  if(shortId)return Response.redirect(url.origin+'/offers/'+offer.id,302);
  const e=htmlEscape;
  const body='<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0E1012"><title>'+e(offer.title)+' — fluqon.qpon</title><link rel="canonical" href="https://fluqon.qpon/offers/'+offer.id+'"><meta property="og:title" content="'+e(offer.title)+' — fluqon.qpon"><meta property="og:image" content="https://fluqon.qpon/assets/brand/social-share-v1.png"><meta property="og:type" content="website"><link rel="icon" href="/assets/brand/fluqon-favicon.svg?v=20261019-icons"><link rel="stylesheet" href="/styles.css?v=20261019-publishing"><link rel="stylesheet" href="/support.css?v=20261019-publishing"><link rel="stylesheet" href="/assets/polymath-parent.css"><link rel="manifest" href="/manifest.webmanifest"><script src="/offer.js?v=20261019-publishing" defer></script><script src="/share.js?v=20261019-publishing" defer></script><script src="/pwa.js?v=20261019-publishing" defer></script></head><body><a class="skip" href="#content">Skip to offer</a><div class="shell"><header class="masthead"><a class="wordmark" href="/"><img src="/assets/brand/fluqon-logo.svg" alt="fluqon.qpon" width="170" height="30"></a><a href="/">Back to the feed ↗</a></header><main class="support" id="content"><span class="eyebrow">'+e(offer.retailer)+' // '+e(offer.department)+'</span><h1>'+e(offer.title)+'</h1><p class="intro">'+e(offer.description)+'</p><p><span class="discount">'+e(offer.discount)+'</span></p><section><h2>The code</h2><div class="code-row"><span class="coupon-code" id="offer-code">'+e(offer.code||'NO CODE NEEDED')+'</span><button class="copy" id="copy-offer" data-code="'+e(offer.code)+'">COPY CODE</button></div><p><a href="'+e(offer.url)+'" target="_blank" rel="noopener noreferrer'+(offer.affiliate?' sponsored':'')+'">Open retailer ↗</a></p>'+(offer.referralBeneficiary?'<p class="referral-disclosure">Who benefits: '+e(offer.referralBeneficiary)+'. '+e(offer.referralReward)+'</p>':'')+(offer.affiliate?'<p>Affiliate link. We may earn a commission. It does not change our checking standard.</p>':'')+'</section><section><h2>Conditions</h2><p>'+e(offer.conditions)+'</p></section><section><h2>The check</h2><p>'+(offer.checkMethod==='checkout'?'Accepted in the checkout during the recorded check.':'Confirmed on the merchant’s page. Checkout acceptance has not been claimed.')+'</p><p><time class="data" datetime="'+e(offer.checkedAt)+'">'+e(new Date(offer.checkedAt).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',timeZoneName:'short'}))+'</time></p><p>Offer expiry: <time class="data" datetime="'+e(offer.expiresAt)+'">'+e(new Date(offer.expiresAt).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',timeZoneName:'short'}))+'</time></p><p>A past check cannot guarantee your checkout. Retailer terms and stock apply.</p></section><p><a href="/contribute?offer='+offer.id+'">edit.fluq_</a> · <a href="/history?offer='+offer.id+'">history.fluq_</a></p><p><a href="/report?offer='+offer.id+'">Report Patched</a> · <button type="button" class="share-link" data-share-site data-share-url="/s/'+offer.id+'" data-share-title="'+e(offer.title)+'">share.fluq_</button></p><p id="offer-status" role="status" aria-live="polite"></p></main><footer><nav class="footer-links" aria-label="Site information"><a href="/contribute">contribute.fluq_</a><a href="/history">history.fluq_</a><a href="https://github.com/valavaiau/fluqon-qpon">source.fluq_</a><a href="https://s.valavai.au/">Seizon’s Eunisys</a><a href="/about">about.fluq_</a><a href="/help">help.fluq_</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/subscribe">Email alerts</a><a href="mailto:sayvon@fluqon.qpon">contact.fluq_</a><a href="/install" class="install-link">install.fluq_</a></nav><div class="footer-bottom"><p>Fluke on Coupon.</p><p>Built on Cloudflare Pages. Zero tracking cookies.</p></div><div class="pf-parent"><a href="https://polymathfactor.app/"><span>An app from</span><img src="/assets/polymath-factor-parent.png" width="400" height="131" alt="Polymath Factor"><span>apps ↗</span></a></div></footer></div></body></html>';
  return new Response(request.method==='HEAD'?null:body,{headers:{...SECURITY,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
 }catch{return json({error:'The offer feed is temporarily unavailable. Try again shortly.'},503);}
}

async function enrichReferrals(feed,env){if(env.COMMUNITY_ENABLED!=='true')return;const referrals=await communityRPC(env,'public_referrals');for(const offer of feed.offers||[])Object.assign(offer,referrals[offer.id]||{});}
