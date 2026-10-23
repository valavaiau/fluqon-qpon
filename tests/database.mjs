import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
export const HASH='a'.repeat(64),BUCKET='b'.repeat(64),AUTHOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',REVIEWER='33333333-3333-4333-8333-333333333333';
export const fixture=(extra={})=>({id:'fixture-offer',retailer:'TEST FIXTURE ONLY',department:'TEST',category:'other',title:'Local test offer only',description:'Never a real or verified retail promotion.',discount:'TEST',code:'',merchant_url:'https://www.ikea.com/au/en/offers/',conditions:'Local test conditions only. No purchase or price claim.',expires_at:new Date(Date.now()+86400000).toISOString(),glitch:false,affiliate:false,referral_beneficiary:'',referral_reward:'',...extra});
export async function database(){
 const db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const path of ['subscriber-schema.sql','supabase/migrations/20261018210450_offer_publishing_and_private_reports.sql','server/subscription-schema.sql','supabase/migrations/20261018212600_reserve_existing_brand_shortlinks.sql'])await db.exec(await readFile(new URL('../'+path,import.meta.url),'utf8'));
 await db.query('insert into fluqon_private.gateway_config(key_hash) values($1)',[HASH]);
 await db.exec(await readFile(new URL('../database/community.sql',import.meta.url),'utf8'));
 const rpc=async(operation,payload={},actor=null,operator=false,bucket=BUCKET,key=HASH)=>(await db.query('select public.fluqon_community_gateway($1,$2,$3::jsonb,$4::uuid,$5,$6) as result',[key,operation,JSON.stringify(payload),actor,bucket,operator])).rows[0].result;
 for(const [id,handle] of [[AUTHOR,'fixture_author'],[OTHER,'fixture_other'],[REVIEWER,'fixture_reviewer']])await rpc('profile',{handle,consent:true,terms_version:'community-v1'},id);
 await rpc('member',{handle:'fixture_reviewer',role:'reviewer',blocked:false},null,true);
 return {db,rpc};
}
export const submit=(offer=fixture(),base=0)=>({offer,base_revision:base,summary:'A local fixture contribution for the review tests.',source_url:'https://www.ikea.com/au/en/offers/'});
export const approve=id=>({id,decision:'approve',review_note:'Reviewed as a local test fixture only.',method:'merchant',source_url:'https://www.ikea.com/au/en/offers/',evidence:'Local fixture verification. No real merchant check claimed.'});
