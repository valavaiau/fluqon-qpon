import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCommunity} from '../server/community.mjs';

const env={PUBLIC_ORIGIN:'https://fluqon.qpon',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',COMMUNITY_ENABLED:'false',COMMUNITY_AUTH_ENABLED:'false'};
const request=(cookie='',origin=env.PUBLIC_ORIGIN)=>new Request(env.PUBLIC_ORIGIN+'/api/community/auth/signout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});
function cleared(response){
 const values=response.headers.getSetCookie();assert.equal(values.length,2);
 for(const name of ['__Host-fluqon-access','__Host-fluqon-refresh'])assert(values.some(v=>v.startsWith(name+'=;')&&v.includes('Max-Age=0')&&v.includes('Secure')&&v.includes('HttpOnly')&&v.includes('SameSite=Strict')&&v.includes('Path=/')));
 assert.equal(response.headers.get('cache-control'),'no-store');
}
const ended=()=>new Response(null,{status:204});
const renewed=()=>Response.json({access_token:'renewed-fixture-access',refresh_token:'renewed-fixture-refresh',user:{email:'private-fixture@example.org'}});
function noSecrets(data){for(const value of ['fixture-access','fixture-refresh','private-fixture@example.org'])assert(!JSON.stringify(data).includes(value));}

test('logout revokes an active provider session and clears both cookies while community flags stay closed',async()=>{
 const calls=[];const response=await handleCommunity(request('__Host-fluqon-access=fixture-access; __Host-fluqon-refresh=fixture-refresh'),env,{fetch:async(url,init)=>{calls.push({url,init});return ended();}});
 assert.equal(response.status,200);cleared(response);const data=await response.json();assert.equal(data.providerRevoked,true);assert.equal(data.localSignedOut,true);noSecrets(data);
 assert.equal(calls.length,1);assert(calls[0].url.endsWith('/auth/v1/logout?scope=local'));assert.equal(calls[0].init.headers.Authorization,'Bearer fixture-access');
});
test('refresh-only logout renews server-side then revokes without issuing renewed cookies',async()=>{
 const calls=[];const response=await handleCommunity(request('__Host-fluqon-refresh=fixture-refresh'),env,{fetch:async(url,init)=>{calls.push({url,init});return url.includes('/token?')?renewed():ended();}});
 assert.equal(response.status,200);cleared(response);const data=await response.json();assert.equal(data.providerRevoked,true);noSecrets(data);
 assert.equal(calls.length,2);assert(calls[0].url.endsWith('/token?grant_type=refresh_token'));assert.equal(JSON.parse(calls[0].init.body).refresh_token,'fixture-refresh');assert.equal(calls[1].init.headers.Authorization,'Bearer renewed-fixture-access');
});
test('expired access-token logout retries through its refresh token before revoking',async()=>{
 const calls=[];const response=await handleCommunity(request('__Host-fluqon-access=expired-fixture-access; __Host-fluqon-refresh=fixture-refresh'),env,{fetch:async(url,init)=>{calls.push({url,init});if(calls.length===1)return Response.json({error:'expired'}, {status:401});return url.includes('/token?')?renewed():ended();}});
 assert.equal(response.status,200);cleared(response);assert.equal((await response.json()).providerRevoked,true);assert.equal(calls.length,3);assert.equal(calls[2].init.headers.Authorization,'Bearer renewed-fixture-access');
});
test('provider outage and refused revocation clear local cookies without claiming server logout',async()=>{
 for(const send of [async()=>{throw Error('private diagnostic must not escape');},async()=>Response.json({secret:'never echo upstream body'},{status:503})]){
  const response=await handleCommunity(request('__Host-fluqon-access=fixture-access'),env,{fetch:send});assert.equal(response.status,503);cleared(response);const data=await response.json();assert.equal(data.ok,false);assert.equal(data.localSignedOut,true);assert.equal(data.providerRevoked,false);assert(data.error.includes('could not confirm'));assert(!JSON.stringify(data).includes('diagnostic'));assert(!JSON.stringify(data).includes('upstream body'));noSecrets(data);
 }
});
test('failed or malformed refresh cannot claim revoked session or expose provider response',async()=>{
 for(const reply of [()=>Response.json({error:'fixture-refresh rejected'},{status:400}),()=>Response.json({access_token:42}),()=>new Response('{',{status:200})]){
  const calls=[];const response=await handleCommunity(request('__Host-fluqon-refresh=fixture-refresh'),env,{fetch:async url=>{calls.push(url);return reply();}});assert.equal(response.status,503);cleared(response);const data=await response.json();assert.equal(data.providerRevoked,false);assert.equal(data.localSignedOut,true);noSecrets(data);assert.equal(calls.length,1);
 }
});
test('successful renewal followed by refused revocation still reports uncertainty and clears local state',async()=>{
 const calls=[];const response=await handleCommunity(request('__Host-fluqon-refresh=fixture-refresh'),env,{fetch:async url=>{calls.push(url);return url.includes('/token?')?renewed():Response.json({error:'provider detail must stay private'},{status:503});}});
 assert.equal(response.status,503);cleared(response);const data=await response.json();assert.equal(data.localSignedOut,true);assert.equal(data.providerRevoked,false);noSecrets(data);assert(!JSON.stringify(data).includes('provider detail'));assert.equal(calls.length,2);
});
test('already-empty browser logout makes no provider request and does not claim revocation',async()=>{
 const response=await handleCommunity(request(),env,{fetch:async()=>{assert.fail('No provider call needed.');}});assert.equal(response.status,200);cleared(response);const data=await response.json();assert.equal(data.localSignedOut,true);assert.equal(data.providerRevoked,false);
});
test('cross-origin logout is refused before provider calls or cookie mutation',async()=>{
 const response=await handleCommunity(request('__Host-fluqon-refresh=fixture-refresh','https://attacker.invalid'),env,{fetch:async()=>{assert.fail('Cross-origin logout must not call a provider.');}});assert.equal(response.status,403);assert.equal(response.headers.getSetCookie().length,0);
});
