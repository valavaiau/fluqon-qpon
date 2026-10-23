import { draftCampaign } from './brevo.mjs';
import { handleCommunity, communityRPC } from './community.mjs';
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
