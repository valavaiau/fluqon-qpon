import test from 'node:test';import assert from 'node:assert/strict';
import {database,fixture,submit,approve,AUTHOR,OTHER,REVIEWER,HASH} from './database.mjs';
import {normaliseOffer,safeURL,proposalInput,fieldDiff} from '../server/community-policy.mjs';

test('input boundaries reject private URL forms, unknown fields, forged verification and missing referral disclosure',()=>{
 for(const url of ['http://www.ikea.com/','https://127.0.0.1/','https://[::1]/','https://user:pass@www.ikea.com/','https://localhost/','https://metadata.internal/','https://2130706433/','https://0x7f000001/','https://www.ikea.com:8080/','javascript:alert(1)'])assert.throws(()=>safeURL(url),url);
 assert.throws(()=>normaliseOffer(fixture({status:'published'})));
 assert.throws(()=>normaliseOffer(fixture({affiliate:true})));
 assert.throws(()=>proposalInput({...submit(),base_revision:-1}));
 assert.equal(normaliseOffer(fixture()).retailer,'TEST FIXTURE ONLY');
 assert.deepEqual(fieldDiff({title:'before'},{title:'after'}),[{field:'title',before:'before',after:'after'}]);
});
test('database roles cannot read private tables or invoke service RPCs',async()=>{
 const {db}=await database();try{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select * from fluqon_community.proposals'),/permission denied/);
   await assert.rejects(db.query('select public.fluqon_community_gateway($1,$2)',[HASH,'queue']),/permission denied/);
   await assert.rejects(db.query('select * from subscriber_private.subscribers'),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});
test('pending edits never touch live data; acceptance is revision-bound; histories redact private fields',async()=>{
 const {db,rpc}=await database();try{
  assert.equal((await rpc('queue',{},AUTHOR)).status,403);
  assert.equal((await rpc('queue',{},null,false,'b'.repeat(64),'c'.repeat(64))).status,401);
  const p=await rpc('submit',submit(),AUTHOR);assert.equal(p.ok,true);
  assert.equal((await db.query('select count(*)::int as n from fluqon_private.offers')).rows[0].n,0);
  assert.equal((await rpc('history',{id:'fixture-offer'})).status,404);
  const firstQueue=await rpc('queue',{},null,true);assert.equal(firstQueue.proposals[0].current_revision,0);
  const accepted=await rpc('review',approve(p.reference),null,true);assert.equal(accepted.ok,true);assert.equal(accepted.revision,1);
  await db.query("update fluqon_private.offers set revision=2,title='PRIVATE DRAFT CONTENT',status='draft' where id='fixture-offer'");
  assert.equal((await rpc('draft',{id:'fixture-offer'},AUTHOR)).status,404);
  assert(!JSON.stringify(await rpc('history',{id:'fixture-offer'})).includes('PRIVATE DRAFT CONTENT'));
  await db.query("update fluqon_private.offers set revision=1,title='Local test offer only',status='published' where id='fixture-offer'");
  const second=await rpc('submit',submit(fixture({title:'Edited local fixture'}),1),AUTHOR);assert.equal(second.ok,true);
  const editQueue=await rpc('queue',{},null,true);assert.equal(editQueue.proposals[0].current.title,'Local test offer only');
  const competing=await rpc('submit',submit(fixture({title:'Conflicting fixture edit'}),1),OTHER);assert.equal(competing.ok,true);
  assert.equal((await db.query("select title from fluqon_private.offers where id='fixture-offer'")).rows[0].title,'Local test offer only');
  assert.equal((await rpc('review',approve(second.reference),null,true)).revision,2);
  assert.equal((await rpc('review',approve(competing.reference),null,true)).status,409);
  assert.equal((await rpc('review',approve(second.reference),null,true)).status,409);
  const history=await rpc('history',{id:'fixture-offer'});assert.equal(history.revisions.length,2);assert.equal(history.revisions[0].author_handle,'fixture_author');
  assert(!JSON.stringify(history).includes('evidence'));assert(!JSON.stringify(history).includes(AUTHOR));assert(!JSON.stringify(history).includes('email'));
  // Restore a previous revision through a NEW proposal, a fresh check and a new revision.
  const restored=await rpc('submit',submit(history.revisions[1].snapshot,2),AUTHOR);assert.equal(restored.ok,true);
  assert.equal((await rpc('review',approve(restored.reference),null,true)).revision,3);
  assert.equal((await rpc('redact',{id:'fixture-offer',revision:3,reason:'Fixture privacy removal test.'},null,true)).ok,true);
  const removed=(await rpc('history',{id:'fixture-offer'})).revisions[0];assert.equal(removed.snapshot,null);assert.equal(removed.author_handle,'[removed]');
  assert.equal((await db.query("select status from fluqon_private.offers where id='fixture-offer'")).rows[0].status,'paused');
  assert.equal((await rpc('draft',{id:'fixture-offer'},AUTHOR)).status,404);
 }finally{await db.close();}
});
test('atomic approval rejects glitches, invalid snapshots, expired offers and incomplete checks',async()=>{
 const {db,rpc}=await database();try{
  const p=await rpc('submit',submit(fixture({glitch:true})),AUTHOR);assert.equal(p.ok,true);
  assert.equal((await rpc('review',approve(p.reference),null,true)).status,400);
  assert.equal((await db.query('select count(*)::int as n from fluqon_private.offers')).rows[0].n,0);
  const invalid=await rpc('submit',submit(fixture({id:'broken-fixture',category:'invalid'})),AUTHOR);assert.equal(invalid.ok,true);
  assert.equal((await rpc('review',approve(invalid.reference),null,true)).status,400);
  assert.equal((await db.query("select count(*)::int as n from fluqon_private.offers where id='broken-fixture'")).rows[0].n,0);
  assert.equal((await rpc('review',{...approve(p.reference),method:'checkout'},null,true)).ok,true);
  await db.query("update fluqon_private.offers set checked_at=now()-interval '5 hours' where id='fixture-offer'");
  const feed=(await db.query("select public.fluqon_gateway($1,'feed') as r",[HASH])).rows[0].r;assert.equal(feed.offers.length,0);
 }finally{await db.close();}
});
test('owner controls roles, independent review, referral replacement and blocked users',async()=>{
 const {db,rpc}=await database();try{
  assert.equal((await rpc('member',{handle:'fixture_author',role:'maintainer',blocked:false},AUTHOR)).status,403);
  const p=await rpc('submit',submit(fixture({referral_beneficiary:'Fixture beneficiary',referral_reward:'Fixture reward only, not real.'})),AUTHOR);
  assert.equal((await rpc('review',approve(p.reference),REVIEWER)).status,403);
  assert.equal((await rpc('review',approve(p.reference),null,true)).ok,true);
  const data=await rpc('public_referrals');assert.equal(data['fixture-offer'].referralBeneficiary,'Fixture beneficiary');
  const q=await rpc('submit',submit(fixture({title:'Reviewer own fixture'}),1),REVIEWER);
  assert.equal((await rpc('review',approve(q.reference),REVIEWER)).status,403);
  await rpc('member',{handle:'fixture_author',role:'contributor',blocked:true},null,true);
  assert.equal((await rpc('submit',submit(fixture({id:'blocked-fixture'})),AUTHOR)).status,403);
 }finally{await db.close();}
});
test('discussion moderation, private draft isolation and account/network rate limits',async()=>{
 const {db,rpc}=await database();try{
  assert.equal((await rpc('draft',{id:'private-unpublished'},AUTHOR)).status,404);
  const p=await rpc('submit',submit(),AUTHOR);await rpc('review',approve(p.reference),null,true);
  assert.equal((await rpc('note',{offer_id:'fixture-offer',body:'Local test discussion with no personal details.'},AUTHOR)).ok,true);
  assert.equal((await rpc('history',{id:'fixture-offer'})).notes.length,0);
  const queue=await rpc('queue',{},null,true);assert.equal(queue.notes.length,1);
  assert.equal((await rpc('moderate_note',{id:queue.notes[0].id,status:'approved'},null,true)).ok,true);
  assert.equal((await rpc('history',{id:'fixture-offer'})).notes.length,1);
  for(let i=0;i<12;i++)await rpc('auth_limit');assert.equal((await rpc('auth_limit')).status,429);
  let rate;for(let i=0;i<12;i++)rate=await rpc('submit',submit(fixture({id:'limit-fixture-'+i})),OTHER,false,(''+i).padStart(64,'a'));
  assert.equal(rate.status,429);
 }finally{await db.close();}
});
