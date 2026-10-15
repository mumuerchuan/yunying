import {businessFields,planBusinessImport,mergeBusiness,createBusinessAccount,businessIdentityKeys} from '@/lib/business-import';
import {z} from 'zod';
import {initialize,readWorkspace} from '@/lib/storage';
import {score,grade,defaultWeights,type Account,type Handoff,type Rule} from '@/lib/model';
const text=z.string().trim().min(1).max(2000),short=z.string().trim().min(1).max(150),number=z.number().int().min(0).max(100);
const accountSchema=z.object({id:z.string().optional(),name:short,short:short,scene:z.enum(['质量追溯','工具替换','待分配']),industry:short,region:short,size:z.string().max(80),owner:short,website:z.string().max(300),icp:number,signal:number,timing:number,reach:number,fit:number,confidence:number,risk:number,next:z.string().max(1000)});
const handoffSchema=z.object({id:z.string().optional(),accountId:short,role:short,signal:text,case:short,angle:text,entry:text,owner:short,deadline:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v)),'截止日期不正确'),icp:text});
const now=()=>new Date().toISOString();const date=()=>now().slice(0,10);
function fail(error:unknown){console.error('workspace API error',error);if(error instanceof z.ZodError)return Response.json({error:'请检查必填信息、日期和评分范围（0–100）。'},{status:400});const m=error instanceof Error?error.message:'';if(m.includes('UNIQUE constraint'))return Response.json({error:'记录已存在，请检查重复公司名称或刷新后重试。'},{status:409});return Response.json({error:'保存或读取失败，请稍后重试。输入内容已保留。'},{status:503});}
export async function GET(){try{return Response.json(await readWorkspace(),{headers:{'Cache-Control':'no-store'}})}catch(e){return fail(e)}}
export async function POST(request:Request){if(request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'不支持跨站修改。'},{status:403});try{
 if(Number(request.headers.get('content-length')||0)>1000000)return Response.json({error:'导入内容过大，请分批导入。'},{status:413});
 const raw=await request.text();if(raw.length>1000000)return Response.json({error:'内容过大。'},{status:413});
 const {action,data}=z.object({action:z.string(),data:z.unknown()}).parse(JSON.parse(raw));if(action!=='businessImport'&&raw.length>100000)return Response.json({error:'内容过大。'},{status:413});const db=await initialize();
 const getAccount=async(id:string):Promise<Account|null>=>{const r=await db.prepare('SELECT data FROM accounts WHERE id = ?').bind(id).first<{data:string}>();return r?JSON.parse(r.data):null};
 const getHandoff=async(id:string):Promise<Handoff|null>=>{const r=await db.prepare('SELECT data FROM handoffs WHERE id = ?').bind(id).first<{data:string}>();return r?JSON.parse(r.data):null};
 const currentRule=await db.prepare('SELECT data FROM rules ORDER BY rowid DESC LIMIT 1').first<{data:string}>();const weights:number[]=currentRule?JSON.parse(currentRule.data).weights:defaultWeights;
 if(action==='businessImport'){
  const fieldsSchema=z.object(Object.fromEntries(businessFields.map(k=>[k,z.string().trim().max(15000).optional()]))).strict();
  const v=z.object({rows:z.array(z.object({row:z.number().int().min(1),accountId:short.optional(),create:z.boolean().optional(),fields:fieldsSchema})).min(1),mode:z.enum(['fill','overwrite']),fileName:short,scopeId:short.optional()}).parse(data);
  // 大批量导入时仅扫描主体标识，完整工商长文本只读取本批匹配的档案。
  const stored=await db.prepare("SELECT id,name,json_extract(data,'$.business.企业名称') AS businessName,json_extract(data,'$.business.统一社会信用代码') AS credit FROM accounts").all<{id:string;name:string;businessName:string|null;credit:string|null}>();
  let accounts:Account[]=stored.results.map(r=>({id:r.id,name:r.name,business:{'企业名称':r.businessName||r.name,'统一社会信用代码':r.credit||''}} as Account));
  const candidate=planBusinessImport(v.rows,accounts,v.mode,v.scopeId);
  const ids=[...new Set(candidate.flatMap(r=>r.account?[r.account.id]:[]))];
  if(ids.length){
   const reads=[];for(let i=0;i<ids.length;i+=80){const chunk=ids.slice(i,i+80);reads.push(db.prepare('SELECT data FROM accounts WHERE id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk));}
   const full=await db.batch<{data:string}>(reads);
   const complete=new Map(full.flatMap(result=>result.results.map(r=>{const a=JSON.parse(String(r.data)) as Account;return [a.id,a] as const})));
   accounts=accounts.map(a=>complete.get(a.id)||a);
  }
  const plan=planBusinessImport(v.rows,accounts,v.mode,v.scopeId);
  // 服务端重新匹配，防止客户端传入其他账户 ID 或绕过主体冲突检查。
  if(plan.some((r,i)=>(!r.account&&!r.create)||(v.rows[i].accountId?r.account?.id!==v.rows[i].accountId:!v.rows[i].create)))return Response.json({error:'账户匹配已变化或存在主体冲突，请关闭窗口、刷新后重新上传。'},{status:409});
  const changes=plan.filter(r=>r.changes.length);
  if(!changes.length)return Response.json({ok:true,created:0,updated:0,fields:0});
  let created=0,updated=0;
  const statements=changes.flatMap(r=>{
   if(r.create){
    created++;const next=createBusinessAccount(r,crypto.randomUUID(),v.fileName,now());
    const reservations=businessIdentityKeys(r.fields).map(key=>db.prepare("INSERT INTO state_meta (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=CASE WHEN data=excluded.data THEN data ELSE json('主体并发冲突') END").bind(key,next.id));
    return [...reservations,db.prepare('INSERT INTO accounts (id,name,data) VALUES (?,?,?)').bind(next.id,next.name,JSON.stringify(next))];
   }
   updated++;const old=r.account!, next=mergeBusiness(old,r,v.mode,v.fileName,now());
   // 任何一条档案发生并发变更，整批回滚，避免覆盖同事刚保存的资料。
   return [db.prepare("UPDATE accounts SET data=CASE WHEN data=? THEN ? ELSE json('并发修改，请重试') END WHERE id=?").bind(JSON.stringify(old),JSON.stringify(next),old.id)];
  });
  await db.batch(statements);
  return Response.json({ok:true,created,updated,fields:changes.reduce((n,r)=>n+r.changes.length,0)});
 }else if(action==='account'){
  const v=accountSchema.parse(data);const old=v.id?await getAccount(v.id):null;if(v.id&&!old)return Response.json({error:'账户不存在，请刷新。'},{status:404});const id=v.id||crypto.randomUUID();const a:Account={...(old||{logo:v.short.slice(0,3),founded:'待核实',listed:'待核实',scope:v.industry+'相关业务（待核实）',source:'人工录入',status:'待验证',created:date()}),...v,id,updated:date(),score:0,grade:''} as Account;a.score=score(a,weights);a.grade=grade(a.score);
  await db.prepare('INSERT INTO accounts (id,name,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data').bind(id,a.name,JSON.stringify(a)).run();
 }else if(action==='handoff'||action==='editHandoff'){
  const v=handoffSchema.parse(data);const a=await getAccount(v.accountId);if(!a)return Response.json({error:'关联账户不存在。'},{status:404});if(score(a,weights)<60)return Response.json({error:'综合评分低于60分，暂不允许交付 SDR。请先补充有效信号与评分依据。'},{status:422});
  if(action==='editHandoff'){const old=await getHandoff(v.id||'');if(!old||old.accountId!==v.accountId)return Response.json({error:'交付任务不存在。'},{status:404});if(old.status!=='待补充信息')return Response.json({error:'仅待补充信息的任务可重新补充，请刷新。'},{status:409});const h={...old,...v,status:'待交付'};const r=await db.prepare('UPDATE handoffs SET data=? WHERE id=? AND data=?').bind(JSON.stringify(h),old.id,JSON.stringify(old)).run();if(!r.meta.changes)return Response.json({error:'任务已更新，请刷新。'},{status:409});
  }else{const h={...v,id:crypto.randomUUID(),status:'待交付',created:now()};await db.prepare('INSERT INTO handoffs (id,account_id,data) VALUES (?,?,?)').bind(h.id,h.accountId,JSON.stringify(h)).run();}
 }else if(action==='batchHandoff'){
  const v=z.object({accountIds:z.array(short).min(1).max(100)}).parse(data);const ids=[...new Set(v.accountIds)];const aa=await Promise.all(ids.map(getAccount));if(aa.some(a=>!a||score(a,weights)<60))return Response.json({error:'所选账户包含低于60分或不存在的账户，请取消这些选择。'},{status:422});const statements=aa.map(a=>{const h:Handoff={id:crypto.randomUUID(),accountId:a!.id,role:'待补充',signal:'待核验',case:a!.scene+'场景案例',angle:'待补充',entry:'待核实公开入口',owner:a!.owner,status:'待补充信息',deadline:date(),created:now(),icp:a!.industry+'，ICP '+a!.icp+' 分'};return db.prepare('INSERT INTO handoffs (id,account_id,data) VALUES (?,?,?)').bind(h.id,h.accountId,JSON.stringify(h))});await db.batch(statements);
 }else if(action==='handoffStatus'){
  const v=z.object({id:short,status:z.enum(['已交付','SDR已接受','待补充信息'])}).parse(data);const h=await getHandoff(v.id);if(!h)return Response.json({error:'任务不存在。'},{status:404});const allowed:Record<string,string[]>={'待交付':['已交付'],'已交付':['SDR已接受','待补充信息']};if(!allowed[h.status]?.includes(v.status))return Response.json({error:'任务状态已变化，请刷新后再操作。'},{status:409});if(v.status==='已交付'){const a=await getAccount(h.accountId);if(!a||score(a,weights)<60)return Response.json({error:'账户评分已低于60分，请重新评估。'},{status:422});if([h.icp,h.signal,h.role,h.case,h.angle,h.entry].some(t=>/^待/.test(t)))return Response.json({error:'请先补全任务信息。'},{status:422});}const result=await db.prepare('UPDATE handoffs SET data=? WHERE id=? AND data=?').bind(JSON.stringify({...h,status:v.status}),h.id,JSON.stringify(h)).run();if(!result.meta.changes)return Response.json({error:'任务已被更新，请刷新后重试。'},{status:409});
 }else if(action==='feedback'){
  const v=z.object({handoffId:short,accountId:short,result:z.enum(['有效交流','进入诊断','商机 / POC','无有效交流','未触达']),reason:z.enum(['信号成立','找不到正确角色','信号不成立','业务问题不严重','话术无效','案例无说服力','其他']),note:text}).parse(data);const h=await getHandoff(v.handoffId);if(!h||h.accountId!==v.accountId)return Response.json({error:'关联任务不存在。'},{status:404});if(!['SDR已接受','已反馈'].includes(h.status))return Response.json({error:'请先将任务标记为 SDR 已接受，再记录反馈。'},{status:422});const f={...v,id:crypto.randomUUID(),created:now()};await db.batch([db.prepare('INSERT INTO feedback (id,handoff_id,data) VALUES (?,?,?)').bind(f.id,f.handoffId,JSON.stringify(f)),db.prepare('UPDATE handoffs SET data=? WHERE id=?').bind(JSON.stringify({...h,status:'已反馈'}),h.id)]);
 }else if(action==='signal'){
  const v=z.object({name:short,type:z.enum(['招聘信号','组织信号','竞争信号','资本市场','业务动态','产品动态']),scene:z.enum(['质量追溯','工具替换']),source:short,level:z.enum(['强','中','弱']),owner:short,definition:text}).parse(data);const s={...v,id:crypto.randomUUID(),accounts:0,meeting:0,diagnosis:0,result:'待验证'};await db.prepare('INSERT INTO signals (id,data) VALUES (?,?)').bind(s.id,JSON.stringify(s)).run();
 }else if(action==='signalResult'){
  const v=z.object({id:short,result:z.enum(['高效','待验证','观察中','已淘汰'])}).parse(data);const s=await db.prepare('SELECT data FROM signals WHERE id=?').bind(v.id).first<{data:string}>();if(!s)return Response.json({error:'信号定义不存在。'},{status:404});await db.prepare('UPDATE signals SET data=? WHERE id=?').bind(JSON.stringify({...JSON.parse(s.data),result:v.result}),v.id).run();
 }else if(action==='rule'){
  const v=z.object({weights:z.array(number).length(6).refine(w=>w.reduce((a,b)=>a+b,0)===100),note:text}).parse(data);const c=await db.prepare('SELECT COUNT(*) AS n FROM rules').first<{n:number}>();const r:Rule={...v,id:'V1.'+c!.n,created:now()};await db.prepare('INSERT INTO rules (id,data) VALUES (?,?)').bind(r.id,JSON.stringify(r)).run();
 }else if(action==='import'){
  const v=z.object({csv:z.string().min(1).max(50000)}).parse(data);const rows=parseCsv(v.csv);const header=rows.shift()||[];const required=['公司名称','行业','地区','战役','负责人'];if(required.some(k=>!header.includes(k)))return Response.json({error:'CSV 缺少必需列：公司名称、行业、地区、战役、负责人。'},{status:400});if(!rows.length||rows.length>100)return Response.json({error:'每次请导入1–100条账户记录。'},{status:400});const aa=rows.map(row=>{const vals=Object.fromEntries(header.map((k,i)=>[k,(row[i]||'').trim()]));const p=z.object({'公司名称':short,'行业':short,'地区':short,'战役':z.enum(['质量追溯','工具替换']),'负责人':short}).parse(vals);const a:Account={id:crypto.randomUUID(),name:p['公司名称'],short:p['公司名称'],industry:p['行业'],region:p['地区'],scene:p['战役'],owner:p['负责人'],size:'待核实',website:'待核实',founded:'待核实',listed:'待核实',logo:p['公司名称'].slice(0,2),scope:'待核实',source:'CSV 导入',status:'待验证',next:'完善评分依据与有效信号',icp:0,signal:0,timing:0,reach:0,fit:0,confidence:0,risk:0,score:0,grade:'暂缓',created:date(),updated:date()};return a});const results=await db.batch(aa.map(a=>db.prepare('INSERT INTO accounts (id,name,data) VALUES (?,?,?) ON CONFLICT(name) DO NOTHING').bind(a.id,a.name,JSON.stringify(a))));return Response.json({ok:true,imported:results.reduce((s,r)=>s+r.meta.changes,0),skipped:results.filter(r=>!r.meta.changes).length});
 }else{return Response.json({error:'不支持的操作。'},{status:400})}
 return Response.json({ok:true});
 }catch(e){return fail(e)}}
function parseCsv(csv:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;const input=csv.replace(/^\uFEFF/,'');for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}if(quoted)throw new z.ZodError([]);row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;}
