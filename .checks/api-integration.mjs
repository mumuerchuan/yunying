import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[path.dirname(require.resolve('vite'))]}));
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')))sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
class Prepared{constructor(sql){this.sql=sql;this.values=[];}bind(...v){this.values=v;return this;}async first(){return sqlite.prepare(this.sql).get(...this.values)||null;}async run(){const r=sqlite.prepare(this.sql).run(...this.values);return {meta:{changes:Number(r.changes)},success:true};}async all(){return {results:sqlite.prepare(this.sql).all(...this.values),success:true};}}
globalThis.__testDb={prepare:sql=>new Prepared(sql),async batch(stmts){sqlite.exec('BEGIN');try{const rows=[];for(const s of stmts){rows.push(/^SELECT/i.test(s.sql)?await s.all():await s.run());}sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
await esbuild.build({entryPoints:['app/api/workspace/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.checks/api-bundle.mjs',plugins:[{name:'d1-local-test',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env = {DB:globalThis.__testDb};'}));}}]});
const {GET,POST}=await import('./api-bundle.mjs');
const get=async()=>{const r=await GET();assert.equal(r.status,200);return r.json();};
const post=async(action,data,status=200)=>{const r=await POST(new Request('https://test.local/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})}));const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
let s=await get();assert.equal(s.accounts.length,16);assert.equal(s.signals.length,8);assert.equal(s.handoffs.length,6);await get();assert.equal((await get()).accounts.length,16);console.log('PASS schema, seed, idempotent reads');
const input={name:'测试研发公司',short:'测试研发',scene:'质量追溯',industry:'软件',region:'北京',size:'500',owner:'测试负责人',website:'待核实',icp:90,signal:85,timing:80,reach:80,fit:85,confidence:90,risk:5,next:'核验信号'};
await post('account',input);s=await get();const a=s.accounts.find(a=>a.name===input.name);assert.equal(a.grade,'A');assert.equal(a.founded,'待核实');await post('account',{...input,id:a.id,owner:'更新负责人'});assert.equal((await get()).accounts.find(x=>x.id===a.id).owner,'更新负责人');console.log('PASS create, edit, score, persisted read-back');
await post('account',{...input,name:'低分测试',short:'低分',icp:0,signal:0,timing:0,reach:0,fit:0,confidence:0});s=await get();const low=s.accounts.find(x=>x.name==='低分测试');const h={accountId:a.id,role:'质量负责人',signal:'新增5个测试岗位',case:'质量追溯示例',angle:'了解需求到测试的追溯方式',entry:'企业官网',owner:'测试SDR',deadline:'2026-09-25',icp:'研发协作复杂'};
await post('handoff',{...h,accountId:low.id},422);await post('handoff',h);s=await get();const task=s.handoffs.find(x=>x.accountId===a.id);await post('handoffStatus',{id:task.id,status:'SDR已接受'},409);await post('handoffStatus',{id:task.id,status:'已交付'});await post('handoffStatus',{id:task.id,status:'SDR已接受'});await post('feedback',{handoffId:task.id,accountId:a.id,result:'进入诊断',reason:'信号成立',note:'确认追溯问题，约定诊断'});s=await get();assert.equal(s.handoffs.find(x=>x.id===task.id).status,'已反馈');assert.ok(s.feedback.some(f=>f.handoffId===task.id));console.log('PASS low-score gate, delivery state machine, feedback transaction');
await post('batchHandoff',{accountIds:[a.id,low.id]},422);await post('batchHandoff',{accountIds:[a.id]});s=await get();const batch=s.handoffs.find(x=>x.accountId===a.id&&x.status==='待补充信息');await post('editHandoff',{...h,id:batch.id});assert.equal((await get()).handoffs.find(x=>x.id===batch.id).status,'待交付');console.log('PASS batch staging and task supplementation');
const csv='公司名称,行业,地区,战役,负责人\n导入测试,软件,上海,工具替换,运营\n导入测试,软件,上海,工具替换,运营';const imported=await post('import',{csv});assert.equal(imported.imported,1);assert.equal(imported.skipped,1);assert.equal((await get()).accounts.find(x=>x.name==='导入测试').score,0);await post('import',{csv:'公司名称,行业\n缺少字段,软件'},400);console.log('PASS CSV import, deduplication, validation');
await post('rule',{weights:[30,20,15,15,10,10],note:'测试新的权重配置'});await post('rule',{weights:[100,100,0,0,0,0],note:'无效'},400);s=await get();assert.equal(s.rules[0].id,'V1.1');await post('signal',{name:'质量招聘测试信号',type:'招聘信号',scene:'质量追溯',source:'公开招聘',level:'强',owner:'测试',definition:'近30天新增测试岗位'});s=await get();const sig=s.signals.find(x=>x.name==='质量招聘测试信号');await post('signalResult',{id:sig.id,result:'高效'});assert.equal((await get()).signals.find(x=>x.id===sig.id).result,'高效');console.log('PASS rule versioning, weight validation, signal creation and feedback');
console.log('All API integration checks passed.');

const businessInput={rows:[{row:2,accountId:a.id,fields:{'企业名称':a.name,'统一社会信用代码':'91110000100026793Y','法定代表人':'登记代表人','经营状态':'开业','注册资本':'1,000万(元)','参保人数':'415人','电话':'010-12345678','更多邮箱':'a@example.test,b@example.test','经营范围':'技术服务；研发。'}}],mode:'fill',fileName:'工商数据.xlsx'};
let result=await post('businessImport',businessInput);assert.equal(result.updated,1);assert.equal(result.fields,9);
let importedAccount=(await get()).accounts.find(x=>x.id===a.id);assert.equal(importedAccount.business['法定代表人'],'登记代表人');assert.equal(importedAccount.business['统一社会信用代码'],'91110000100026793Y');assert.equal(importedAccount.businessImport.fileName,'工商数据.xlsx');assert.equal(importedAccount.owner,'更新负责人');assert.equal(importedAccount.size,input.size);assert.equal(importedAccount.status,a.status);
const second={...businessInput,rows:[{row:2,accountId:a.id,fields:{'企业名称':a.name,'法定代表人':'新代表人','电话':'-','邮箱':'new@example.test'}}]};
await post('businessImport',second);importedAccount=(await get()).accounts.find(x=>x.id===a.id);assert.equal(importedAccount.business['法定代表人'],'登记代表人');assert.equal(importedAccount.business['邮箱'],'new@example.test');assert.equal(importedAccount.business['电话'],'010-12345678');
await post('businessImport',{...second,mode:'overwrite'});importedAccount=(await get()).accounts.find(x=>x.id===a.id);assert.equal(importedAccount.business['法定代表人'],'新代表人');assert.equal(importedAccount.business['电话'],'010-12345678');
await post('businessImport',{...businessInput,scopeId:low.id},409);
await post('businessImport',{...businessInput,rows:[{...businessInput.rows[0],accountId:low.id}]},409);
await post('businessImport',{...businessInput,rows:[{...businessInput.rows[0],fields:{'企业名称':'不匹配企业','法定代表人':'不应写入'}}]},409);
await post('businessImport',{...businessInput,rows:[businessInput.rows[0],{...businessInput.rows[0],row:3}]},409);
await post('businessImport',{...businessInput,rows:[{...businessInput.rows[0],fields:{'企业名称':a.name,'统一社会信用代码':'91110000100026793X','法定代表人':'不应写入'}}]},409);
await post('businessImport',{...businessInput,rows:[{...businessInput.rows[0],fields:{'企业名称':low.name,'统一社会信用代码':'91110000100026793Y'}}]},409);
await post('businessImport',{...businessInput,rows:[{...businessInput.rows[0],fields:{'企业名称':a.name,'恶意字段':'不应写入'}}]},400);
assert.equal((await get()).accounts.find(x=>x.id===a.id).business['法定代表人'],'新代表人');
console.log('PASS business import persistence, all modes, blanks, scope, forged IDs, duplicates and identity conflicts');

const bulk=[];
for(let i=0;i<125;i++){
 await post('account',{...input,name:'批量工商企业'+i,short:'批量'+i});
}
const bulkAccounts=(await get()).accounts.filter(x=>x.name.startsWith('批量工商企业'));
for(const [i,x] of bulkAccounts.entries())bulk.push({row:i+2,accountId:x.id,fields:{'企业名称':x.name,'法定代表人':'批量代表人'}});
const bulkInput={rows:bulk,mode:'fill',fileName:'超过100家.xlsx'};
const bulkResult=await post('businessImport',bulkInput);assert.equal(bulkResult.updated,125);
const persisted=(await get()).accounts.filter(x=>x.name.startsWith('批量工商企业'));assert.ok(persisted.every(x=>x.business['法定代表人']==='批量代表人'));
const retry=await post('businessImport',bulkInput);assert.equal(retry.updated,0);assert.equal(retry.fields,0);
console.log('PASS more than 100 companies persist, retries safely accept already imported rows');

const beforeCreate=(await get()).accounts.length;
const newRows=Array.from({length:125},(_,i)=>({row:i+2,create:true,fields:{'企业名称':'全新Excel企业'+i,'所属行业':'软件和信息技术服务业','所属省份':'北京市','所属城市':'市辖区','所属区县':'海淀区','成立日期':'2020-01-02','网址':'www.example.test','经营范围':'技术服务、研发','参保人数':'88人'}}));
const newImport={rows:newRows,mode:'fill',fileName:'全新企业.xlsx'};
const created=await post('businessImport',newImport);assert.equal(created.created,125);assert.equal(created.updated,0);
let after=(await get()).accounts;assert.equal(after.length,beforeCreate+125);
const fresh=after.find(x=>x.name==='全新Excel企业0');assert.equal(fresh.industry,'软件和信息技术服务业');assert.equal(fresh.region,'北京市 · 市辖区 · 海淀区');assert.equal(fresh.founded,'2020-01-02');assert.equal(fresh.website,'www.example.test');assert.equal(fresh.owner,'待分配');assert.equal(fresh.scene,'待分配');assert.equal(fresh.score,0);assert.equal(fresh.size,'待核实');assert.equal(fresh.business['参保人数'],'88人');
const replay=await post('businessImport',newImport);assert.equal(replay.created,0);assert.equal((await get()).accounts.length,beforeCreate+125);
await post('account',{...input,id:fresh.id,name:fresh.name,short:fresh.short,scene:'待分配',owner:'待分配'});
const mixed=await post('businessImport',{rows:[{row:2,accountId:fresh.id,fields:{'企业名称':fresh.name,'法定代表人':'Excel代表人'}},{row:3,create:true,fields:{'企业名称':'混合批次新增企业','所属行业':'制造业'}}],mode:'fill',fileName:'混合.xlsx'});assert.equal(mixed.created,1);assert.equal(mixed.updated,1);
const repeatedName={rows:[{row:2,create:true,fields:{'企业名称':'重复新企业','电话':'1'}},{row:3,create:true,fields:{'企业名称':'重复新企业','电话':'2'}}],mode:'fill',fileName:'重复.xlsx'};await post('businessImport',repeatedName,409);assert.ok(!(await get()).accounts.some(x=>x.name==='重复新企业'));
await post('businessImport',{rows:[{row:2,create:true,fields:{'企业名称':'新代码企业甲','统一社会信用代码':'91110000100026793X'}},{row:3,create:true,fields:{'企业名称':'新代码企业乙','统一社会信用代码':'91110000100026793X'}}],mode:'fill',fileName:'重复信用代码.xlsx'},409);
await post('businessImport',{rows:[{row:2,create:true,fields:{'电话':'010-12345678'}}],mode:'fill',fileName:'缺名称.xlsx'},409);
await post('businessImport',{rows:[{row:2,create:true,fields:{'企业名称':'不能跨账户新增','电话':'123'}}],scopeId:a.id,mode:'fill',fileName:'范围.xlsx'},409);
console.log('PASS 125 new enterprises, core fields, unassigned workflow, replay deduplication, mixed create/update and conflicts');

const legacyImport={rows:[{row:2,create:true,fields:{'企业名称':'旧注册号企业甲','统一社会信用代码':'110108123456789'}},{row:3,create:true,fields:{'企业名称':'旧注册号企业乙','统一社会信用代码':'110108123456789'}}],mode:'fill',fileName:'旧号.xlsx'};
const legacyResult=await post('businessImport',legacyImport);assert.equal(legacyResult.created,2);
let legacyAccounts=(await get()).accounts.filter(x=>x.name.startsWith('旧注册号企业'));assert.equal(legacyAccounts.length,2);assert.ok(legacyAccounts.every(x=>x.business['统一社会信用代码']==='110108123456789'));
const legacyReplay=await post('businessImport',legacyImport);assert.equal(legacyReplay.created,0);
await post('businessImport',{rows:[{row:2,accountId:a.id,fields:{'企业名称':a.name,'统一社会信用代码':'旧代码','电话':'010-999'}}],mode:'overwrite',fileName:'旧号更新.xlsx'});
assert.equal((await get()).accounts.find(x=>x.id===a.id).business['统一社会信用代码'],'91110000100026793Y');
console.log('PASS legacy identifiers persist verbatim, separate companies remain separate, replay deduplicates by name');

const classified=(await get()).accounts.find(x=>x.name==='全新Excel企业1');assert.equal(classified.industryClassification.level1,'信息传输、软件和信息技术服务业');assert.equal(classified.industryClassification.level2,'软件和信息技术服务业');assert.equal(classified.industryClassification.level3,'其他信息技术服务业');
await post('businessImport',{rows:[{row:2,accountId:classified.id,fields:{'企业名称':classified.name,'所属行业':'软件开发'}}],mode:'overwrite',fileName:'细分行业.xlsx'});
const refined=(await get()).accounts.find(x=>x.id===classified.id);assert.equal(refined.industryClassification.level3,'软件开发');assert.equal(refined.business['所属行业'],'软件开发');
console.log('PASS existing imported accounts automatically classified; later industry updates recompute three levels');
