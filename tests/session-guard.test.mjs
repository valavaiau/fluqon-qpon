import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {handleCommunity} from '../server/community.mjs';
import {database,AUTHOR,OTHER,SESSIONS,sessionToken,submit,HASH,BUCKET} from './database.mjs';

// All identity, token and network values in this file are local fixtures, never real Auth acceptance.
const env={PUBLIC_ORIGIN:'https://fluqon.qpon',BACKEND_URL:'https://backend.invalid/endpoint',SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'public-fixture-key',COMMUNITY_ENABLED:'true',COMMUNITY_LICENCE_ACCEPTED:'true',COMMUNITY_AUTH_ENABLED:'true',API_GATEWAY_KEY:'b'.repeat(64)};
const response=(data,status=200)=>Response.json(data,{status});
function request(path,data,token=sessionToken()){
 return new Request(env.PUBLIC_ORIGIN+'/api/community'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:'__Host-fluqon-access='+encodeURIComponent(token),...(data===undefined?{}:{Origin:env.PUBLIC_ORIGIN,'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
}
const confirmed={id:AUTHOR,email_confirmed_at:'2026-10-23T00:00:00Z',is_anonymous:false};
async function edge(fetch){
 const source=stripTypeScriptTypes(await readFile(new URL('../server/edge.ts',import.meta.url),'utf8'));
 let handle;const logs=[];
 runInNewContext(source,{Deno:{serve:fn=>{handle=fn;},env:{get:name=>({SUPABASE_URL:env.SUPABASE_URL,SUPABASE_SECRET_KEYS:'{"default":"private-fixture-service-key"}'})[name]}},fetch,crypto,TextEncoder,Response,AbortSignal,console:{error:message=>logs.push(message)}});
 return {handle,logs};
}
const edgeRequest=data=>new Request(env.BACKEND_URL,{method:'POST',headers:{'x-fluqon-gateway':env.API_GATEWAY_KEY},body:JSON.stringify({action:'community',data,bucket:BUCKET})});

test('every protected Pages route binds identity and session from the accepted token, not submitted metadata',async()=>{
 const cases=[['/me',undefined,'me'],['/draft?id=fixture-offer',undefined,'draft'],['/queue',undefined,'queue'],['/profile',{handle:'fixture_name',consent:true,terms_version:'community-v1'},'profile'],['/submit',submit(),'submit'],['/withdraw',{id:'fixture'},'withdraw'],['/note',{offer_id:'fixture-offer',body:'A local fixture note.'},'note'],['/review',{id:'fixture',decision:'reject',review_note:'Local fixture decision.'},'review'],['/member',{handle:'fixture_name',role:'contributor',blocked:false},'member'],['/moderate-note',{id:'fixture',status:'hidden'},'moderate_note'],['/redact',{id:'fixture-offer',revision:1,reason:'Local fixture removal.'},'redact']];
 for(const [path,data,operation] of cases){
  let sent;
  const fetch=async(url,init)=>new URL(url).pathname==='/auth/v1/user'?response(confirmed):(sent=JSON.parse(init.body),response({ok:true}));
  const r=await handleCommunity(request(path,data===undefined?undefined:{...data,actor_id:OTHER,session_id:SESSIONS[OTHER],_session_id:SESSIONS[OTHER],operator_access:true,user_metadata:{session_id:SESSIONS[OTHER]}}),env,{fetch});
  assert.equal(r.status,200,path);assert.equal(sent.data.operation,operation);assert.equal(sent.data.actor_id,AUTHOR);assert.equal(sent.data.session_id,SESSIONS[AUTHOR]);assert.equal(sent.data.operator_access,false);assert(!('_session_id' in sent.data.payload));
  const text=await r.text();assert(!text.includes(SESSIONS[AUTHOR]));assert(!text.includes(sessionToken()));
 }
});

test('Pages rejects absent, malformed, mismatched and nested-only claims after provider validation',async()=>{
 const claims=[{session_id:null},{session_id:undefined},{session_id:'not-a-uuid'},{session_id:'-'.repeat(36)},{session_id:123},{session_id:[]},{sub:OTHER},{sub:null},{session_id:null,user_metadata:{session_id:SESSIONS[AUTHOR]}}];
 const tokens=[...claims.map(sessionToken),'not-a-token','a.b.c','a.'+Buffer.from([255]).toString('base64url')+'.c'];
 for(const token of tokens){
  let calls=0;const fetch=async url=>{calls++;assert.equal(new URL(url).pathname,'/auth/v1/user');return response(confirmed);};
  assert.equal((await handleCommunity(request('/me',undefined,token),env,{fetch})).status,401);assert.equal(calls,1);
 }
 let calls=0;
 const rejected=await handleCommunity(request('/me'),env,{fetch:async()=>{calls++;return response({error:'Fixture provider rejection.'},401);}});
 assert.equal(rejected.status,401);assert.equal(calls,1);
 const malformedUser=await handleCommunity(request('/me'),env,{fetch:async()=>response({...confirmed,id:'-'.repeat(36)})});assert.equal(malformedUser.status,403);
});

test('Edge overwrites nested session metadata and preserves the existing six-argument contract',async()=>{
 const calls=[];
 const {handle}=await edge(async(url,init)=>{calls.push(JSON.parse(init.body));return response(new URL(url).pathname.endsWith('/fluqon_gateway')?true:{ok:true});});
 for(const session of [SESSIONS[AUTHOR],undefined]){
  const r=await handle(edgeRequest({operation:'me',payload:{_session_id:SESSIONS[OTHER]},actor_id:AUTHOR,session_id:session,operator_access:false}));assert.equal(r.status,200);
  const sent=calls.at(-1);assert.deepEqual(Object.keys(sent).sort(),['actor_id','client_bucket','gateway_hash','operation','operator_access','payload'].sort());assert.equal(sent.payload._session_id,session||null);assert.equal(sent.actor_id,AUTHOR);
 }
 const before=calls.length;
 assert.equal((await handle(edgeRequest({operation:'me',payload:[],actor_id:AUTHOR,session_id:SESSIONS[AUTHOR]}))).status,400);assert.equal(calls.length,before+1);
});

test('same copied token is denied through Pages, Edge and SQL once its fixture session is revoked',async()=>{
 const {db}=await database();try{
  const gatewayHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.API_GATEWAY_KEY))).toString('hex');
  await db.query('update fluqon_private.gateway_config set key_hash=$1',[gatewayHash]);
  const {handle}=await edge(async(url,init)=>{
   const fields=JSON.parse(init.body);
   if(new URL(url).pathname.endsWith('/fluqon_gateway'))return response((await db.query('select public.fluqon_gateway($1,$2,$3::jsonb,$4) as result',[fields.gateway_hash,fields.operation,JSON.stringify(fields.payload),fields.client_bucket])).rows[0].result);
   const result=await db.query('select public.fluqon_community_gateway($1,$2,$3::jsonb,$4::uuid,$5,$6) as result',[fields.gateway_hash,fields.operation,JSON.stringify(fields.payload),fields.actor_id,fields.client_bucket,fields.operator_access]);return response(result.rows[0].result);
  });
  const fetch=async(url,init)=>new URL(url).pathname==='/auth/v1/user'?response(confirmed):handle(new Request(url,init));
  const token=sessionToken();assert.equal((await handleCommunity(request('/me',undefined,token),env,{fetch})).status,200);
  await db.query('delete from auth.sessions where id=$1',[SESSIONS[AUTHOR]]);
  assert.equal((await handleCommunity(request('/submit',submit(),token),env,{fetch})).status,401);
  assert.equal((await handleCommunity(request('/me',undefined,token),env,{fetch})).status,401);
  assert.equal((await db.query('select count(*)::int as n from fluqon_community.proposals')).rows[0].n,0);
 }finally{await db.close();}
});

test('SQL rejects missing, malformed, other-user and revoked sessions before every protected operation',async()=>{
 const {db,rpc}=await database();try{
  for(const session of [null,'not-a-uuid','-'.repeat(36),123,[],SESSIONS[OTHER]])assert.equal((await rpc('me',{},AUTHOR,false,BUCKET,HASH,session)).status,401);
  assert.equal((await rpc('queue',{},AUTHOR,null)).status,403,'explicit null is never operator access');
  assert.equal((await rpc('queue',{},null,null)).status,401);
  await db.query('delete from auth.sessions where id=$1',[SESSIONS[AUTHOR]]);
  for(const operation of ['profile','me','draft','submit','withdraw','note','queue','review','member','moderate_note','redact'])assert.equal((await rpc(operation,{},AUTHOR)).status,401,operation);
  assert.equal((await db.query('select count(*)::int as n from fluqon_community.proposals')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from fluqon_community.notes')).rows[0].n,0);
 }finally{await db.close();}
});

test('SQL checks not_after at guard evaluation, including a transaction which started before expiry',async()=>{
 const {db,rpc}=await database();try{
  assert.equal((await rpc('me',{},AUTHOR)).member.handle,'fixture_author');
  await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[SESSIONS[AUTHOR]]);assert.equal((await rpc('me',{},AUTHOR)).status,401);
  await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=$1",[SESSIONS[AUTHOR]]);assert.equal((await rpc('me',{},AUTHOR)).member.handle,'fixture_author');
  await db.exec('begin');
  await db.query("update auth.sessions set not_after=clock_timestamp()+interval '0.04 seconds' where id=$1",[SESSIONS[AUTHOR]]);
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal((await rpc('me',{},AUTHOR)).status,401);
  await db.exec('rollback');
 }finally{await db.close();}
});

test('public reads, owner access and private ACLs survive the guard; session metadata is not persisted',async()=>{
 const {db,rpc}=await database();try{
  await db.exec('delete from auth.sessions');
  assert.deepEqual(await rpc('public_referrals'),{});assert.equal((await rpc('history',{id:'not-published'})).status,404);assert.equal((await rpc('auth_limit')).ok,true);assert(Array.isArray((await rpc('queue',{},null,true)).proposals));
  assert.equal((await rpc('member',{handle:'fixture_author',role:'contributor',blocked:false},null,true)).ok,true);
  assert(!JSON.stringify((await db.query('select details from fluqon_private.audit_log')).rows).includes('_session_id'));
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select * from auth.sessions'),/permission denied/);
   await assert.rejects(db.query('select public.fluqon_community_gateway($1,$2)',[HASH,'queue']),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});

test('unavailable session lookup fails closed and Edge returns only its generic service error',async()=>{
 const {db,rpc}=await database();try{
  await db.exec('alter table auth.sessions rename to unavailable_fixture_sessions');
  await assert.rejects(rpc('me',{},AUTHOR),/sessions.*does not exist/);
 }finally{await db.close();}
 const {handle,logs}=await edge(async url=>{if(new URL(url).pathname.endsWith('/fluqon_gateway'))return response(true);throw new Error('private fixture database failure');});
 const r=await handle(edgeRequest({operation:'me',payload:{},actor_id:AUTHOR,session_id:SESSIONS[AUTHOR]}));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Service unavailable'});assert(!logs.join('').includes('private fixture database failure'));assert(!logs.join('').includes(SESSIONS[AUTHOR]));
});
