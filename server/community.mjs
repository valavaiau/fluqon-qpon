import { InputError, proposalInput, safeURL } from './community-policy.mjs';

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
export async function communityRPC(env,operation,payload={},actor=null,bucket='',operator=false,send=fetch){
 if(!env.BACKEND_URL||!env.API_GATEWAY_KEY)throw new InputError('Community service is not connected yet.',503);
 const response=await send(env.BACKEND_URL,{method:'POST',headers:{'Content-Type':'application/json','x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'community',data:{operation,payload,actor_id:actor,operator_access:operator},bucket}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const result=await limitedJSON(response,1024*1024,503,true);if(result.error)throw new InputError(result.error,result.status||(response.status>=400?response.status:400));if(!response.ok)throw new InputError('Community service unavailable.',response.status>=500?503:response.status);return result;
}
export async function handleCommunity(request,env,options={}){
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
