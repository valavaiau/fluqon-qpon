import {FIELDS,fieldDiff,proposalInput,safeURL} from './community-policy.mjs';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=$('[data-community-page]')?.dataset.communityPage;
let ownerKey='',baseRevision=0,originalExpiry='',originalExpiryField='',token='',widget,securityLoading,config,member,queue,activity=Date.now();
const status=message=>{const el=$('#community-status');if(el)el.textContent=message;};
const date=value=>new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
async function api(path,data,retry=true){
 const response=await fetch('/api/community'+path,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(ownerKey?{Authorization:'Bearer '+ownerKey}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await response.json();
 if(response.status===401&&retry&&!ownerKey&&config?.authEnabled&&!path.startsWith('/auth/')){try{await api('/auth/refresh',{},false);return api(path,data,false);}catch{}}
 if(!response.ok){const error=Error(result.error||'Could not complete that request.');error.localSignedOut=result.localSignedOut===true;throw error;}return result;
}
async function run(action){status('Working…');try{const result=await action();status(result?.message||'Updated.');}catch(error){status(error.message);}}
function diffHTML(before,after){return fieldDiff(before,after).map(c=>`<div class="change"><dt>${esc(c.field.replaceAll('_',' '))}</dt><dd><small>BEFORE</small>${['code','discount','expires_at'].includes(c.field)?`<span class="data">${esc(c.before===''?'Not set':c.before)}</span>`:esc(c.before===''?'Not set':c.before)}</dd><dd><small>PROPOSED</small>${['code','discount','expires_at'].includes(c.field)?`<span class="data">${esc(c.after===''?'Not set':c.after)}</span>`:esc(c.after===''?'Not set':c.after)}</dd></div>`).join('')||'<p>No field changes.</p>';}
function setDraft(offer,revision){
 const form=$('#contribution-form');form.reset();for(const name of FIELDS){const input=form.elements.namedItem(name);if(!input)continue;const value=offer[name];if(input.type==='checkbox')input.checked=!!value;else if(name==='expires_at'&&value){const t=new Date(value);input.value=new Date(t.getTime()-t.getTimezoneOffset()*60000).toISOString().slice(0,16);}else input.value=value??'';}
 baseRevision=revision;originalExpiry=offer.expires_at||'';originalExpiryField=form.elements.namedItem('expires_at').value;form.elements.namedItem('id').readOnly=revision>0;$('#base-revision').textContent=revision?`Editing revision ${revision} · live offer unchanged until review`:'New offer · revision 0';
}
function locked(){ownerKey='';queue=null;$('#review-key-form')?.reset();if($('#review-panel'))$('#review-panel').hidden=true;if($('#review-login'))$('#review-login').hidden=false;for(const id of ['#review-proposals','#review-notes','#member-list'])$(id)?.replaceChildren();}
async function signInReady(){
 if(!config.authEnabled||!$('#signin-panel')||$('#signin-panel').hidden)return;
 if(widget!==undefined){token='';window.turnstile?.reset(widget);return;}
 if(!window.turnstile){
  securityLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.addEventListener('load',resolve);script.addEventListener('error',()=>{securityLoading=undefined;reject(Error('Security check could not load. Reload the page to try again.'));});document.head.append(script);});
  await securityLoading;
 }
 widget=window.turnstile.render('#community-security',{sitekey:config.sitekey,action:'community_login',theme:'dark',callback:value=>{token=value;},'expired-callback':()=>{token='';}});
}
function signedOut(){
 member=null;ownerKey='';token='';
 $('#session-panel').hidden=true;$('#profile-panel').hidden=true;$('#contributor-panel').hidden=true;$('#signin-panel').hidden=false;$('#signin-form').hidden=!config.authEnabled;
 for(const form of document.querySelectorAll('.community form'))form.reset();
 $('#my-proposals').replaceChildren();$('#contributor-name').textContent='';setDraft({},0);
}
async function identity(){
 const state=await api('/me');member=state.member;
 if($('#signin-panel'))$('#signin-panel').hidden=true;
 if($('#session-panel'))$('#session-panel').hidden=false;
 if($('#profile-panel'))$('#profile-panel').hidden=!!member;
 if($('#contributor-panel'))$('#contributor-panel').hidden=!member;
 if($('#contributor-name')&&member)$('#contributor-name').textContent=`${member.handle} · ${member.role}`;
 if($('#my-proposals'))$('#my-proposals').innerHTML=state.proposals.map(p=>`<article class="desk-record"><h3>${esc(p.snapshot.title)}</h3><span class="data">${esc(p.status)} · ${esc(date(p.created_at))}</span><p>${esc(p.summary)}</p>${p.review_note?`<p>Review: ${esc(p.review_note)}</p>`:''}${p.status==='pending'?`<button type="button" class="quiet-button" data-withdraw="${esc(p.id)}">withdraw.proposal_</button>`:''}</article>`).join('')||'<p>No submissions yet.</p>';
 return state;
}
async function loadQueue(){
 queue=await api('/queue');$('#review-login').hidden=true;$('#review-panel').hidden=false;$('#queue-count').textContent=`${queue.proposals.length} pending changes · ${queue.notes.length} pending notes`;
 $('#review-proposals').innerHTML=queue.proposals.map(p=>`<article class="desk-record" id="proposal-${esc(p.id)}"><h3>${esc(p.snapshot.title)}</h3><span class="data">${esc(p.offer_id)} · base ${p.base_revision} · current ${p.current_revision}</span><p>Submitted by <strong>${esc(p.handle)}</strong> · ${esc(date(p.created_at))}</p><p>${esc(p.summary)}</p><p><a href="${esc(safeURL(p.source_url))}" target="_blank" rel="noopener noreferrer">Read the submitted source ↗</a></p>${p.base_revision!==p.current_revision?'<p class="historical">Revision conflict. Reject with an explanation or ask for a fresh submission; do not overwrite newer work.</p>':''}<dl class="change-list">${diffHTML(p.current,p.snapshot)}</dl><form class="alert-form review-form" data-review="${esc(p.id)}"><label>Decision<select name="decision"><option value="reject">Reject — keep current offer</option><option value="approve">Approve after an actual check</option></select></label><label>Review note<textarea name="review_note" minlength="10" maxlength="1000" required></textarea></label><fieldset><legend>Required for approval</legend><label for="method-${esc(p.id)}">What was checked?</label><select id="method-${esc(p.id)}" name="method"><option value="merchant">Retailer’s published terms</option><option value="checkout">Accepted at checkout</option></select><label for="source-${esc(p.id)}">Source checked</label><input id="source-${esc(p.id)}" type="url" name="source_url" value="${esc(p.source_url)}"><label for="evidence-${esc(p.id)}">Private evidence — what did you actually check?</label><textarea id="evidence-${esc(p.id)}" name="evidence" maxlength="2500"></textarea><p>Do not include customer or payment information. Approval records a new check now; it is not automatic verification.</p></fieldset><button>save.decision_</button></form></article>`).join('')||'<p>No offer changes waiting.</p>';
 $('#review-notes').innerHTML=queue.notes.map(n=>`<article class="desk-record"><h3>${esc(n.offer_id)}</h3><p>From ${esc(n.handle)}</p><p>${esc(n.body)}</p><div class="desk-actions"><button data-note="${esc(n.id)}" data-decision="approved">publish.note_</button><button class="quiet-button" data-note="${esc(n.id)}" data-decision="hidden">hide.note_</button></div></article>`).join('')||'<p>No notes waiting.</p>';
 $('#member-list').innerHTML=ownerKey?queue.members.map(m=>`<form class="member-row" data-member="${esc(m.handle)}"><span class="data">${esc(m.handle)}</span><label>Role<select name="role"><option ${m.role==='contributor'?'selected':''}>contributor</option><option ${m.role==='reviewer'?'selected':''}>reviewer</option><option ${m.role==='maintainer'?'selected':''}>maintainer</option></select></label><label><input type="checkbox" name="blocked" ${m.blocked?'checked':''}> Block contributions</label><button>save.access_</button></form>`).join(''):'<p>Owner-key access is required to change roles.</p>';
}
async function showHistory(id){
 if(!/^[a-z0-9][a-z0-9-]{2,59}$/.test(id))throw Error('Enter the offer ID from /offers/…');
 const history=await api('/history?id='+encodeURIComponent(id));$('#history-offer').value=id;
 $('#history-list').innerHTML=history.revisions.map((r,i)=>`<article class="desk-record"><h2>Revision ${r.revision}${r.redacted?' · removed':''}</h2><span class="data">${esc(date(r.created_at))}</span><p>${esc(r.summary)}</p>${r.redacted?'<p>Content removed by a maintainer.</p>':`<p>By ${esc(r.author_handle)}. Recorded method: ${esc(r.check_method||'not recorded')}.</p><p class="historical">Historical record. Check the live offer for current availability.</p><p><a href="${esc(safeURL(r.source_url))}" rel="noopener noreferrer" target="_blank">Source ↗</a></p><details><summary>View this revision${history.revisions[i+1]?' and changes':''}</summary><dl class="change-list">${diffHTML(history.revisions[i+1]?.snapshot||{},r.snapshot)}</dl></details><a class="restore" href="/contribute?offer=${encodeURIComponent(id)}&restore=${r.revision}">Propose restoring this revision</a>`}</article>`).join('');
 $('#history-notes').innerHTML=history.notes.map(n=>`<article class="desk-record"><p>${esc(n.body)}</p><span class="data">${esc(n.handle)} · ${esc(date(n.created_at))}</span></article>`).join('')||'<p>No public notes yet.</p>';
 return {message:'History loaded. Earlier offers may no longer be available.'};
}
async function init(){
 if(page==='community-guide')return;
 try{config=await api('/config');}catch{status('Community service is unavailable. Try again later.');return;}
 $('#community-stage').textContent=config.localPreview?'LOCAL TEST BUILD · All offers and people here are fixtures. No emails are sent. No production data is connected.':config.enabled?'Community pilot · submissions are reviewed before publication.':'Community editing is being prepared. The existing checked feed remains available.';
 if(!config.enabled){document.querySelectorAll('.community form button,.community #review-session').forEach(b=>b.disabled=true);if($('#signin-panel'))$('#signin-panel').hidden=true;return;}
 if(page==='history'){
  $('#history-form').addEventListener('submit',e=>{e.preventDefault();void run(()=>showHistory(new FormData(e.target).get('id')));});
  const id=new URL(location.href).searchParams.get('offer');if(id)await run(()=>showHistory(id));return;
 }
 if(page==='community-review'){
  $('#review-login').hidden=false;
  $('#review-key-form').addEventListener('submit',e=>{e.preventDefault();ownerKey=e.target.elements.namedItem('key').value;e.target.reset();void run(async()=>{try{await loadQueue();return {message:'Review desk unlocked.'};}catch(error){locked();throw error;}});});
  $('#review-session').addEventListener('click',()=>void run(async()=>{ownerKey='';await loadQueue();return {message:'Reviewer session ready.'};}));
  $('#refresh-queue').addEventListener('click',()=>void run(loadQueue));$('#lock-review').addEventListener('click',()=>{locked();status('Review desk locked.');});
  $('#review-panel').addEventListener('submit',e=>{const f=e.target;e.preventDefault();if(f.dataset.review)void run(async()=>{const result=await api('/review',{...Object.fromEntries(new FormData(f)),id:f.dataset.review});await loadQueue();return result;});if(f.dataset.member)void run(async()=>{const result=await api('/member',{handle:f.dataset.member,role:f.elements.namedItem('role').value,blocked:f.elements.namedItem('blocked').checked});await loadQueue();return result;});if(f.id==='redact-form')void run(async()=>{const fields=Object.fromEntries(new FormData(f));const result=await api('/redact',{...fields,revision:Number(fields.revision)});f.reset();await loadQueue();return result;});});
  $('#review-panel').addEventListener('click',e=>{const b=e.target.closest('[data-note]');if(b)void run(async()=>{const result=await api('/moderate-note',{id:b.dataset.note,status:b.dataset.decision});await loadQueue();return result;});});return;
 }
 try{await identity();}catch{if($('#signin-panel'))$('#signin-panel').hidden=false;}
 if(config.authEnabled&&$('#signin-panel')&&!$('#signin-panel').hidden){void signInReady().catch(error=>status(error.message));}
 else if(!config.authEnabled&&!member&&!config.localPreview){$('#signin-form').hidden=true;status('Contributor email sign-in is not open yet.');}
 $('#signin-form').addEventListener('submit',e=>{e.preventDefault();const intent=e.submitter.value,data=Object.fromEntries(new FormData(e.target));void run(async()=>{const result=await api('/auth/'+(intent==='request'?'request':'verify'),{email:data.email,token:data.token,turnstile:token});if(intent==='verify'){e.target.reset();await identity();}return result;}).finally(()=>{token='';if(widget!==undefined)window.turnstile?.reset(widget);});});
 $('#profile-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{const result=await api('/profile',{handle:e.target.elements.namedItem('handle').value,consent:e.target.elements.namedItem('consent').checked,terms_version:config.termsVersion});await identity();return result;});});
 $('#signout').addEventListener('click',()=>void run(async()=>{let result;try{result=await api('/auth/signout',{});}catch(error){if(!error.localSignedOut)throw error;result={message:error.message};}signedOut();void signInReady().catch(error=>status(result.message+' '+error.message));return result;}));
 $('#clear-draft').addEventListener('click',()=>setDraft({},0));
 async function loadOffer(id){const current=await api('/draft?id='+encodeURIComponent(id));let offer=current.offer;const restoring=Number(new URL(location.href).searchParams.get('restore'));if(restoring){const history=await api('/history?id='+encodeURIComponent(id));const old=history.revisions.find(r=>r.revision===restoring&&!r.redacted);if(!old)throw Error('That revision is not available.');offer=old.snapshot;status(`Restoring revision ${restoring} as a proposal against current revision ${current.revision}. Update expired dates and explain the reason.`);}setDraft(offer,current.revision);$('#existing-offer').value=id;return {message:restoring?`Earlier revision loaded against current revision ${current.revision}. Update expired dates and explain your restoration.`:'Latest revision loaded. Your changes will be reviewed.'};}
 $('#load-form').addEventListener('submit',e=>{e.preventDefault();void run(()=>loadOffer(new FormData(e.target).get('id')));});
 const requested=new URL(location.href).searchParams.get('offer');if(requested&&member)await run(()=>loadOffer(requested));
 $('#contribution-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{const f=e.target,values=Object.fromEntries(new FormData(f)),offer=Object.fromEntries(FIELDS.map(k=>[k,values[k]??'']));offer.glitch=f.elements.namedItem('glitch').checked;offer.affiliate=f.elements.namedItem('affiliate').checked;offer.expires_at=originalExpiry&&offer.expires_at===originalExpiryField?originalExpiry:new Date(offer.expires_at).toISOString();const data=proposalInput({offer,base_revision:baseRevision,source_url:values.source_url,summary:values.summary});const result=await api('/submit',data);setDraft({},0);await identity();return result;});});
 $('#note-form').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{const result=await api('/note',Object.fromEntries(new FormData(e.target)));e.target.reset();return result;});});
 $('#my-proposals').addEventListener('click',e=>{const b=e.target.closest('[data-withdraw]');if(b)void run(async()=>{const result=await api('/withdraw',{id:b.dataset.withdraw});await identity();return result;});});
}
for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{activity=Date.now();},{passive:true});
setInterval(()=>{if(ownerKey&&Date.now()-activity>15*60000){locked();status('Review desk locked after inactivity.');}},30000);
window.addEventListener('pagehide',()=>{ownerKey='';queue=null;document.querySelectorAll('input[type=password],input[type=email]').forEach(i=>{i.value='';});});
void init();
