import {withIndustryClassification} from './industry';
import type {Account} from './model';

export const businessFields=['企业名称','经营状态','法定代表人','注册资本','实缴资本','成立日期','核准日期','营业期限','所属省份','所属城市','所属区县','电话','更多电话','邮箱','更多邮箱','统一社会信用代码','纳税人识别号','工商注册号','组织机构代码','参保人数','企业类型','所属行业','曾用名','注册地址','最新年报地址','网址','经营范围'] as const;
export type BusinessField=typeof businessFields[number];
export type BusinessData=Partial<Record<BusinessField,string>>;
export type BusinessRow={row:number;fields:BusinessData};
export type ImportMode='fill'|'overwrite';
export const isMissing=(v?:string)=>!v||['-','—','--','待核实','暂无','未公示','待验证'].includes(v.trim());
export const normalizeCompany=(v:string)=>v.trim().replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
const code=(v?:string)=>isMissing(v)?'':v!.trim().toUpperCase();
// 非18位原始值仍保存，但不作为跨企业匹配或去重的身份标识。
export const validCredit=(v?:string)=>/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code(v))?code(v):'';

function indexAccounts(accounts:Account[]){
 const names=new Map<string,Account[]>(),codes=new Map<string,Account[]>();
 for(const account of accounts){
  const name=normalizeCompany(account.business?.['企业名称']||account.name),credit=validCredit(account.business?.['统一社会信用代码']);
  for(const alias of new Set([name,normalizeCompany(account.name)]))names.set(alias,[...(names.get(alias)||[]),account]);
  if(credit)codes.set(credit,[...(codes.get(credit)||[]),account]);
 }
 return {names,codes};
}
// 只允许全称或信用代码匹配，简称相近不能证明是同一个主体。
export function matchBusiness(row:BusinessRow,accounts:Account[],scopeId?:string,index=indexAccounts(accounts)):{account?:Account;create?:boolean;reason:string}{
 const name=row.fields['企业名称']||'', credit=validCredit(row.fields['统一社会信用代码']);
 if(isMissing(name))return {reason:'缺少企业名称'};
 if(name.length>150)return {reason:'企业名称超过150字，请检查是否为正确表头或数据'};
 const warning=!isMissing(row.fields['统一社会信用代码'])&&!credit?' · 原始信用代码待核实':'';
 const byCode=credit?index.codes.get(credit)||[]:[];
 const byName=index.names.get(normalizeCompany(name))||[];
 if(byCode.length>1||byName.length>1)return {reason:'匹配到多个账户，请先核对主体'};
 if(byCode.length&&byName.length&&byCode[0].id!==byName[0].id)return {reason:'企业名称与信用代码指向不同账户'};
 const account=byCode[0]||byName[0];
 if(!account)return scopeId?{reason:'当前账户不匹配，请前往设置导入新企业'}:{create:true,reason:'新增企业'+warning};
 if(credit&&validCredit(account.business?.['统一社会信用代码'])&&credit!==validCredit(account.business?.['统一社会信用代码']))return {reason:'信用代码与现有档案冲突'};
 if(scopeId&&account.id!==scopeId)return {reason:'属于其他账户，请从设置批量上传'};
 return {account,reason:(byCode.length?'信用代码匹配':'企业全称匹配')+warning};
}
export function businessChanges(account:Account,fields:BusinessData,mode:ImportMode){
 return businessFields.filter(k=>!isMissing(fields[k])&&!(k==='统一社会信用代码'&&!validCredit(fields[k])&&validCredit(account.business?.[k]))&&fields[k]!==account.business?.[k]&&(mode==='overwrite'||isMissing(account.business?.[k]))).map(field=>({field,before:account.business?.[field]||'',after:fields[field]!}));
}
export function planBusinessImport(rows:BusinessRow[],accounts:Account[],mode:ImportMode,scopeId?:string){
 const index=indexAccounts(accounts);
 const matches=rows.map(row=>({row:row.row,fields:row.fields,...matchBusiness(row,accounts,scopeId,index)}));
 const counts=new Map<string,number>();
 const keys=(r:BusinessRow & {account?:Account})=>[
  'name:'+normalizeCompany(r.fields['企业名称']||''),
  ...(validCredit(r.fields['统一社会信用代码'])?['code:'+validCredit(r.fields['统一社会信用代码'])]:[]),
  ...(r.account?['account:'+r.account.id]:[]),
 ];
 matches.forEach(r=>keys(r).forEach(k=>counts.set(k,(counts.get(k)||0)+1)));
 return matches.map(r=>{
  if(keys(r).some(k=>counts.get(k)!>1))return {...r,account:undefined,create:false,reason:'文件内企业名称、信用代码或关联账户重复，请合并后重新上传',changes:[]};
  return {...r,changes:r.account?businessChanges(r.account,r.fields,mode):r.create?businessFields.filter(k=>!isMissing(r.fields[k])).map(field=>({field,before:'',after:r.fields[field]!})):[]};
 });
}
export function mergeBusiness(account:Account,row:BusinessRow,mode:ImportMode,fileName:string,date:string):Account{
 const changes=businessChanges(account,row.fields,mode), business={...account.business};
 changes.forEach(c=>business[c.field]=c.after);
 // 登记资料单独保存，避免经营状态、参保人数覆盖运营状态和员工规模。
 return withIndustryClassification({...account,business,businessImport:{fileName,at:date},updated:date.slice(0,10)});
}

export function createBusinessAccount(row:BusinessRow,id:string,fileName:string,date:string):Account{
 const get=(field:BusinessField,fallback='待核实')=>isMissing(row.fields[field])?fallback:row.fields[field]!;
 const region=(['所属省份','所属城市','所属区县'] as BusinessField[]).map(k=>get(k,'')).filter(Boolean).join(' · ')||'待核实';
 const account:Account={id,name:get('企业名称'),short:get('企业名称'),logo:get('企业名称').slice(0,2),industry:get('所属行业'),region,
  founded:get('成立日期'),scope:get('经营范围'),website:get('网址'),size:'待核实',listed:'待核实',
  scene:'待分配',owner:'待分配',status:'待验证',next:'分配负责人、战役并完善评分依据',source:'爱企查 Excel 导入',
  icp:0,signal:0,timing:0,reach:0,fit:0,confidence:0,risk:0,score:0,grade:'暂缓',created:date.slice(0,10),updated:date.slice(0,10)};
 return mergeBusiness(account,row,'fill',fileName,date);
}
// 规范化主体标识用于并发新增去重；保存在现有元数据表，与档案在同一批事务写入。
export function businessIdentityKeys(fields:BusinessData){
 return ['business-name:'+normalizeCompany(fields['企业名称']||''),...(validCredit(fields['统一社会信用代码'])?['business-code:'+validCredit(fields['统一社会信用代码'])]:[])];
}

export function parseBusinessSheet(data:unknown[][]):{rows:BusinessRow[];ignored:string[];recognized:number}{
 const value=(v:unknown)=>v instanceof Date?v.toISOString().slice(0,10):v==null?'':String(v).trim();
 const headerIndex=data.findIndex(r=>r.some(v=>value(v)==='企业名称'));
 if(headerIndex<0)throw Error('未找到“企业名称”表头。请使用爱企查导出格式或下载模板。');
 const headers=data[headerIndex].map(value);
 const known=headers.filter(h=>businessFields.includes(h as typeof businessFields[number]));
 if(new Set(known).size!==known.length)throw Error('存在重复字段列，请删除重复列后上传。');
 if(known.length<2)throw Error('请至少提供企业名称和一个可补全字段。');
 const rows:BusinessRow[]=[];
 data.slice(headerIndex+1).forEach((r,i)=>{
  if(!r.some(v=>value(v)))return;
  const fields:BusinessData={};
  headers.forEach((h,j)=>{if(businessFields.includes(h as typeof businessFields[number])){const v=value(r[j]);if(v.length>15000)throw Error(`第 ${headerIndex+i+2} 行的“${h}”过长，最多 15000 字。`);fields[h as typeof businessFields[number]]=v;}});
  rows.push({row:headerIndex+i+2,fields});
 });
 if(!rows.length)throw Error('工作表只有表头，没有企业数据。');
 return {rows,ignored:headers.filter(h=>h&&!businessFields.includes(h as typeof businessFields[number])),recognized:known.length};
}

export type BusinessImportRow=BusinessRow & {accountId?:string;create?:boolean};
// 上传不限制总行数，请求按行数和实际 UTF-8 字节拆分，避免长经营范围导致单次保存过大。
export function batchBusinessRows(rows:BusinessImportRow[]){
 const batches:BusinessImportRow[][]=[];let batch:BusinessImportRow[]=[],bytes=0;
 const encoder=new TextEncoder();
 for(const row of rows){
  const size=encoder.encode(JSON.stringify(row)).length;
  if(size>700000)throw Error(`第 ${row.row} 行内容过大，请缩短该行的超长字段后重试。`);
  if(batch.length&&(batch.length>=15||bytes+size>700000)){batches.push(batch);batch=[];bytes=0;}
  batch.push(row);bytes+=size+1;
 }
 if(batch.length)batches.push(batch);
 return batches;
}
