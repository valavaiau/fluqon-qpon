import {readFile,readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),files=[];
async function scan(dir=''){
 for(const item of await readdir(new URL(dir,root),{withFileTypes:true})){
  if(['node_modules','.git','.DS_Store'].includes(item.name))continue;
  const path=dir+item.name;if(item.isDirectory())await scan(path+'/');else files.push(path);
 }
}
await scan();let checks=0;
for(const path of files){
 assert(!/(^|\/)(\.dev\.vars|operator-key\.txt|brevo-api-key\.txt|cloudflare-deployment\.json|email-receipt\.json|HANDOVER.*|.*before.*\.zip)$/.test(path),'Private artifact: '+path);checks++;
 if(/\.(js|mjs|ts|sql|md|json|py|cjs|yml|yaml|html|css)$/.test(path)){
  const text=await readFile(new URL(path,root),'utf8');
  assert(!/\/Users\/|sb_secret_[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text),'Private path or credential pattern: '+path);checks++;
 }
 if(/\.(mjs|js|cjs)$/.test(path)){
  const checked=spawnSync(process.execPath,['--check',new URL(path,root).pathname],{encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);checks++;
 }
}
const sql=await readFile(new URL('database/community.sql',root),'utf8');
for(const table of ['members','proposals','revisions','referrals','notes']){assert(sql.includes('alter table fluqon_community.'+table+' enable row level security;'));checks++;}
assert(sql.includes('revoke all on function public.fluqon_community_gateway(text,text,jsonb,uuid,text,boolean) from public,anon,authenticated;'));checks++;
const frontend=await readFile(new URL('dist/community.js',root),'utf8');assert(!/localStorage|sessionStorage|innerHTML\s*=\s*data\./.test(frontend));checks++;
const worker=await readFile(new URL('dist/_worker.js',root),'utf8');assert(!/^import /m.test(worker));assert(worker.includes('handleCommunity(request,env)'));checks++;
const routes=JSON.parse(await readFile(new URL('dist/_routes.json',root),'utf8'));
for(const page of ['contribute','community-review','history','community-guide']){
 const html=await readFile(new URL('dist/'+page+'.html',root),'utf8');assert(html.includes('noindex,nofollow'));assert(html.includes('Fluke on Coupon.'));assert(html.includes('/assets/polymath-factor-parent.png'));assert(routes.include.includes('/'+page+'*'));checks++;
}
const sw=await readFile(new URL('dist/sw.js',root),'utf8');assert(!sw.split('self.addEventListener')[0].includes('community'));checks++;
const workflow=await readFile(new URL('.github/workflows/check.yml',root),'utf8');assert(!workflow.includes('secrets.'));assert(!workflow.includes('pull_request_target'));assert(workflow.includes('persist-credentials: false'));checks++;
if(process.argv.includes('--public')){
 const policy=JSON.parse(await readFile(new URL('release-policy.json',root),'utf8'));
 for(const key of ['publicRepositoryApproved','softwareLicenceApproved','contentLicenceApproved','assetRightsApproved'])assert.equal(policy[key],true,'Owner acceptance still required: '+key);
 await readFile(new URL('LICENSE',root),'utf8');await readFile(new URL('CONTENT-LICENSE',root),'utf8');
}
console.log(`Source checks passed: ${checks} assertions across ${files.length} files. ${process.argv.includes('--public')?'Approved public-source gates passed. Production contributor rollout remains closed.':'Public source approval is checked separately with --public.'}`);
