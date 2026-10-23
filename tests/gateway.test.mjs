import test from 'node:test';import assert from 'node:assert/strict';
import {handleCommunity} from '../server/community.mjs';
import {fixture,submit,AUTHOR} from './database.mjs';
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const env={PUBLIC_ORIGIN:'https://fluqon.qpon',BACKEND_URL:'https://backend.invalid/endpoint',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test-key',COMMUNITY_ENABLED:'true',COMMUNITY_LICENCE_ACCEPTED:'true',COMMUNITY_AUTH_ENABLED:'true',API_GATEWAY_KEY:'b'.repeat(64),TURNSTILE_SECRET:'test-only'};
function request(path,data,headers={}){return new Request('https://fluqon.qpon/api/community'+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:'https://fluqon.qpon'}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
const result=(v,status=200)=>Response.json(v,{status});
function transport(calls,{confirmed=true,anonymous=false,challenge=true}={}){return async(url,init={})=>{
 const u=new URL(url);calls.push({url,init});
 if(u.hostname==='challenges.cloudflare.com')return result({success:challenge,hostname:'fluqon.qpon',action:'community_login'});
 if(u.pathname==='/auth/v1/user')return result({id:AUTHOR,email_confirmed_at:confirmed?'2026-10-23T00:00:00Z':null,is_anonymous:anonymous});
 if(u.pathname==='/auth/v1/verify'||u.pathname==='/auth/v1/token')return result({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:AUTHOR,email_confirmed_at:'2026-10-23T00:00:00Z'}});
 if(u.hostname==='backend.invalid')return result({ok:true,member:{handle:'test_author',role:'contributor'},proposals:[]});
 return result({ok:true});
};}
test('community remains closed by default and does not call any provider',async()=>{const calls=[];const r=await handleCommunity(request('/submit',submit()),{...env,COMMUNITY_ENABLED:'false'},{fetch:transport(calls)});assert.equal(r.status,503);assert.equal(calls.length,0);});
test('cross-origin writes and oversized/malformed input cannot reach a backend',async()=>{
 const calls=[];const send=transport(calls);
 assert.equal((await handleCommunity(request('/submit',submit(),{Origin:'https://attacker.invalid'}),env,{fetch:send})).status,403);
 assert.equal((await handleCommunity(request('/submit',{x:'x'.repeat(15000)}),env,{fetch:send})).status,413);
 const bad=new Request('https://fluqon.qpon/api/community/submit',{method:'POST',headers:{Origin:env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:'{'});
 assert.equal((await handleCommunity(bad,env,{fetch:send})).status,400);assert.equal(calls.length,0);
});
test('server resolves identity; forged roles/actors and evidence cannot authorise publication',async()=>{
 const calls=[],send=transport(calls);
 const r=await handleCommunity(request('/submit',{...submit(),actor_id:'forged',operator_access:true,role:'maintainer'},{Cookie:'__Host-fluqon-access=test'}),env,{fetch:send});assert.equal(r.status,200);
 const payload=JSON.parse(calls.find(c=>new URL(c.url).hostname==='backend.invalid').init.body);
 assert.equal(payload.data.actor_id,AUTHOR);assert.equal(payload.data.operator_access,false);assert.equal(payload.data.operation,'submit');assert(!('actor_id' in payload.data.payload));
 calls.length=0;
 assert.equal((await handleCommunity(request('/submit',submit(fixture({status:'published'})),{Cookie:'__Host-fluqon-access=test'}),env,{fetch:send})).status,400);
 assert(!calls.some(c=>new URL(c.url).hostname==='backend.invalid'));
});
test('unconfirmed and anonymous auth users are refused before private data access',async()=>{
 for(const config of [{confirmed:false},{anonymous:true}]){const calls=[];const r=await handleCommunity(request('/me',undefined,{Cookie:'__Host-fluqon-access=test'}),env,{fetch:transport(calls,config)});assert.equal(r.status,403);assert.equal(calls.length,1);}
});
test('OTP uses real provider validation, secure cookies, no browser token disclosure, and no PII logging',async()=>{
 const calls=[];const r=await handleCommunity(request('/auth/verify',{email:'fixture@example.org',token:'123456',turnstile:'test-challenge'}),env,{fetch:transport(calls)});assert.equal(r.status,200);
 const cookies=r.headers.getSetCookie();assert.equal(cookies.length,2);for(const c of cookies){assert(c.includes('HttpOnly'));assert(c.includes('Secure'));assert(c.includes('SameSite=Strict'));assert(c.includes('Path=/'));}
 const body=await r.text();assert(!body.includes('test-access'));assert(!body.includes('test-refresh'));assert(!body.includes('fixture@example.org'));
 assert.equal(r.headers.get('cache-control'),'no-store');
 const invalid=await handleCommunity(request('/auth/verify',{email:'fixture@example.org',token:'123456',turnstile:'bad'}),env,{fetch:transport([],{challenge:false})});assert.equal(invalid.status,403);
});
test('existing owner key stays distinct from contributor identity and signout clears both cookies',async()=>{
 const key='1'.repeat(64),calls=[];const r=await handleCommunity(request('/queue',undefined,{Authorization:'Bearer '+key}),{...env,ADMIN_KEY_HASH:await hash(key)},{fetch:transport(calls)});assert.equal(r.status,200);
 const payload=JSON.parse(calls[0].init.body);assert.equal(payload.data.operator_access,true);assert.equal(payload.data.actor_id,null);
 const out=await handleCommunity(request('/auth/signout',{}),env,{fetch:transport([])});assert.equal(out.headers.getSetCookie().length,2);assert(out.headers.getSetCookie().every(v=>v.includes('Max-Age=0')));
});
