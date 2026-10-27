import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as policy from '../server/community-policy.mjs';

const source=(await readFile(new URL('../dist/community.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
function element(){return {hidden:false,value:'',textContent:'',innerHTML:'',type:'text',readOnly:false,events:{},addEventListener(event,handler){this.events[event]=handler;},reset(){},replaceChildren(){this.innerHTML='';}};}
function preview(logoutResponse,member=null){
 const elements={},fields={};
 const get=id=>elements[id]??=(element());
 for(const id of ['session-panel','profile-panel','contributor-panel'])get(id).hidden=true;
 get('data-community-page').dataset={communityPage:'contribute'};
 get('contribution-form').elements={namedItem:key=>fields[key]??=element()};
 const forms=['signin-form','profile-form','load-form','contribution-form','note-form'].map(get);
 let widgetCount=0;const calls=[];
 const context={...policy,URL,location:{href:'https://fluqon.qpon/contribute',reload(){assert.fail('Do not reload away the logout warning.');}},setInterval(){},window:{addEventListener(){},turnstile:{render(){widgetCount++;return 'fixture-widget';},reset(){}}},document:{querySelector:selector=>get(selector==='[data-community-page]'?'data-community-page':selector.slice(1)),querySelectorAll:selector=>selector==='.community form'?forms:[],addEventListener(){},head:{append(){assert.fail('Fixture Turnstile is already available.');}}},fetch:async path=>{
  calls.push(path);
  if(path==='/api/community/config')return Response.json({enabled:true,authEnabled:true,sitekey:'fixture-sitekey',termsVersion:'community-v1'});
  if(path==='/api/community/me')return Response.json({member,proposals:[]});
  if(path==='/api/community/auth/signout')return logoutResponse();
  assert.fail('Unexpected request: '+path);
 }};
 vm.runInNewContext(source,context);
 return {elements,get,calls,widgetCount:()=>widgetCount};
}
test('authenticated contributor without profile can sign out without accepting terms',async()=>{
 const view=preview(()=>Response.json({ok:true,localSignedOut:true,providerRevoked:true,message:'Signed out.'}));await flush();
 assert.equal(view.get('session-panel').hidden,false);assert.equal(view.get('profile-panel').hidden,false);assert.equal(view.get('contributor-panel').hidden,true);assert.equal(view.get('signin-panel').hidden,true);assert(!view.get('community-status').textContent.includes('not open'));
 view.get('signout').events.click();await flush();
 assert.equal(view.get('session-panel').hidden,true);assert.equal(view.get('profile-panel').hidden,true);assert.equal(view.get('contributor-panel').hidden,true);assert.equal(view.get('signin-panel').hidden,false);assert.equal(view.widgetCount(),1);assert.equal(view.get('community-status').textContent,'Signed out.');assert(!view.calls.includes('/api/community/profile'));
 const html=await readFile(new URL('../dist/contribute.html',import.meta.url),'utf8');
 assert(html.indexOf('id="session-panel"')<html.indexOf('id="signout"'));assert(html.indexOf('id="signout"')<html.indexOf('id="profile-panel"'));assert(html.indexOf('id="signout"')<html.indexOf('id="contributor-panel"'));
});
test('local logout failure receipt clears authenticated UI and retains truthful warning',async()=>{
 const warning='Signed out of this browser. We could not confirm server sign-out.';
 const view=preview(()=>Response.json({ok:false,localSignedOut:true,providerRevoked:false,error:warning},{status:503}),{handle:'fixture-member',role:'contributor'});await flush();
 view.get('my-proposals').innerHTML='Private fixture proposal';view.get('signout').events.click();await flush();
 assert.equal(view.get('session-panel').hidden,true);assert.equal(view.get('contributor-panel').hidden,true);assert.equal(view.get('my-proposals').innerHTML,'');assert.equal(view.get('contributor-name').textContent,'');assert.equal(view.get('community-status').textContent,warning);assert.equal(view.get('signin-panel').hidden,false);
});
test('unconfirmed local logout network failure does not claim signed-out UI state',async()=>{
 const view=preview(()=>{throw Error('Connection failed.');},{handle:'fixture-member',role:'contributor'});await flush();view.get('signout').events.click();await flush();assert.equal(view.get('session-panel').hidden,false);assert.equal(view.get('contributor-panel').hidden,false);assert.equal(view.get('community-status').textContent,'Connection failed.');
});
test('static auth entrances stay hidden and template forms cannot leak fields through native GET submission',async()=>{
 for(const page of ['contribute','community-review','history','community-guide']){
  const html=await readFile(new URL('../dist/'+page+'.html',import.meta.url),'utf8');
  for(const form of html.matchAll(/<form\b[^>]*>/g))assert(/\bmethod="post"/.test(form[0]),page+' native form must not submit fields in a URL');
  if(page==='contribute')assert(/<section id="signin-panel" hidden>/.test(html));
  if(page==='community-review')assert(/<section id="review-login" hidden>/.test(html));
 }
});
