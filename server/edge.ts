// Only the Pages gateway can call this function. Supabase keys remain in its environment.
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const key=request.headers.get('x-fluqon-gateway')||'';
 if(!/^[a-f0-9]{64}$/.test(key))return reply({error:'Unauthorised'},401);
 try{
  const newKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const service=newKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const headers:Record<string,string>={'Content-Type':'application/json',apikey:service};if(service.startsWith('eyJ'))headers.Authorization='Bearer '+service;
  async function rpc(action:string,data:unknown,bucket:string){const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/fluqon_gateway',{method:'POST',headers,body:JSON.stringify({gateway_hash:await digest(key),operation:action,payload:data,client_bucket:bucket}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('database');return r.json();}
  if((await rpc('authorize',{},''))!==true)return reply({error:'Unauthorised'},401);
  const text=await request.text();if(text.length>16000)return reply({error:'Request too large'},413);
  const {action,data,bucket}=JSON.parse(text);
  if(typeof action!=='string'||typeof data!=='object'||!data||Array.isArray(data))return reply({error:'Invalid request'},400);
  let result;
  if(action==='community'){
   const entry=data as Record<string,unknown>;
   const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/fluqon_community_gateway',{method:'POST',headers,body:JSON.stringify({gateway_hash:await digest(key),operation:entry.operation,payload:entry.payload,actor_id:entry.actor_id,client_bucket:typeof bucket==='string'?bucket:'',operator_access:entry.operator_access===true}),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw new Error('community_database');result=await response.json();
  }else result=await rpc(action,data,typeof bucket==='string'?bucket:'');
  if(result?.error)return reply({error:result.error},result.status||400);
  return reply(result);
 }catch(error){console.error(JSON.stringify({event:'backend_failed',kind:error?.name||'Error'}));return reply({error:'Service unavailable'},503);}
});
