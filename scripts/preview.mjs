// Loopback-only disposable integration preview. All identities/offers are test fixtures.
// Never deploy this adapter, its simulated identity, or its key to Cloudflare.
import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {database,fixture,submit,approve,AUTHOR,HASH} from '../tests/database.mjs';
import {handleCommunity} from '../server/community.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url)),port=Number(process.env.PORT||4173);
const {db,rpc}=await database();const key='1'.repeat(64);const keyHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))).toString('hex');
const initial=await rpc('submit',submit(),AUTHOR);await rpc('review',approve(initial.reference),null,true);
await rpc('submit',submit(fixture({title:'A clearer local test title',conditions:'Local fixture correction. Never a genuine offer or price.'}),1),AUTHOR);
const env={PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,BACKEND_URL:'https://preview-backend.invalid/',SUPABASE_URL:'https://preview-auth.invalid',SUPABASE_PUBLISHABLE_KEY:'local-test-only',API_GATEWAY_KEY:'b'.repeat(64),ADMIN_KEY_HASH:keyHash,COMMUNITY_ENABLED:'true',COMMUNITY_LICENCE_ACCEPTED:'true',COMMUNITY_AUTH_ENABLED:'false'};
const send=async(url,init={})=>{
 const u=new URL(url);
 if(u.hostname==='preview-auth.invalid'&&u.pathname==='/auth/v1/user')return Response.json({id:AUTHOR,email_confirmed_at:'2026-10-23T00:00:00Z',is_anonymous:false});
 if(u.hostname==='preview-backend.invalid'){
  const call=JSON.parse(init.body),d=call.data;
  const result=await rpc(d.operation,d.payload,d.actor_id,d.operator_access,call.bucket||'b'.repeat(64));
  return Response.json(result,{status:result.error?result.status||400:200});
 }
 throw Error('Local preview does not make external requests.');
};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.xml':'application/xml'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,env.PUBLIC_ORIGIN);if(url.origin!==env.PUBLIC_ORIGIN){res.writeHead(400);return res.end();}
  if(url.pathname.startsWith('/api/community/')){
   let size=0,chunks=[];for await(const part of req){size+=part.length;if(size>16000){res.writeHead(413);return res.end();}chunks.push(part);}
   const headers=new Headers(req.headers);if(!headers.has('authorization'))headers.set('cookie','__Host-fluqon-access=local-fixture');
   const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   let response=await handleCommunity(request,env,{fetch:send});
   if(url.pathname==='/api/community/config'){const value=await response.json();response=Response.json({...value,localPreview:true});}
   res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
  }
  if(url.pathname==='/api/offers'){
   const data=(await db.query("select public.fluqon_gateway($1,'feed') as result",[HASH])).rows[0].result;
   const referrals=await rpc('public_referrals');for(const o of data.offers)Object.assign(o,referrals[o.id]||{});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(data));
  }
  let file=decodeURIComponent(url.pathname);if(file==='/')file='/index.html';else if(!path.extname(file))file+='.html';
  const absolute=path.resolve(root,'.'+file);if(!absolute.startsWith(root)||absolute.endsWith('/_worker.js')){res.writeHead(404);return res.end('Not found');}
  let content=await readFile(absolute);if(path.extname(file)==='.html')content=Buffer.from(content.toString().replace('<body>','<body><aside style="padding:12px;background:#D4FF00;color:#0E1012;font:14px monospace">LOCAL TEST BUILD · Fixtures only. No production data, real emails or offers.</aside>'));
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end(error.code==='ENOENT'?'Not found':'Local preview error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local preview http://127.0.0.1:${port}/contribute\nReview desk http://127.0.0.1:${port}/community-review\nDisposable fixture owner key: ${key}`));
async function close(){server.close();await db.close();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);
