import type {IndustryClassification} from './industry';
import type {BusinessData} from './business-import';
import original from './reference-data.json';

export type Account = typeof original.accounts[number] & {confidence:number; created:string; industryClassification?:IndustryClassification; business?:BusinessData; businessImport?:{fileName:string;at:string}};
export type Signal = typeof original.signals[number] & {id:string};
export type Job = typeof original.jobs[number] & {id:string;accountId:string;city:string};
export type Handoff = {id:string;accountId:string;role:string;signal:string;case:string;angle:string;entry:string;owner:string;status:string;deadline:string;created:string;icp:string};
export type Feedback = {id:string;handoffId:string;accountId:string;result:string;reason:string;note:string;created:string};
export type Rule = {id:string;weights:number[];note:string;created:string};
export type Store = {accounts:Account[];signals:Signal[];handoffs:Handoff[];feedback:Feedback[];rules:Rule[]};
export const weightNames=['ICP 匹配度','信号强度','时机匹配','角色可达性','产品适配度','数据置信度'];
export const defaultWeights=[25,20,15,15,15,10];
export function score(a:Account,weights=defaultWeights){return Math.max(0,Math.min(100,Math.round([a.icp,a.signal,a.timing,a.reach,a.fit,a.confidence].reduce((s,n,i)=>s+n*weights[i]/100,0)-a.risk/5)));}
export function grade(n:number){return n>=75?'A':n>=60?'B':'暂缓';}
const dates=['2026-09-17','2026-09-16','2026-09-15','2026-09-14','2026-09-13'];
export const seedAccounts:Account[]=original.accounts.map((a,i)=>({...a,confidence:90,created:'2026-08-'+String(10+i).padStart(2,'0'),short:a.id==='saic'?'上汽集团':a.short,updated:dates[Math.min(Math.floor(i/2),4)],scene:a.scene==='组织调整'?'质量追溯':a.scene,next:'验证信号并补充触达角色'}));
const more=[['金山办公','互联网 / 软件','北京','工具替换','WPS'],['科大讯飞','人工智能','安徽·合肥','工具替换','iFLY'],['迈瑞医疗','医疗健康','广东·深圳','质量追溯','MR'],['中芯国际','电子 / 半导体','上海','质量追溯','SMIC'],['用友网络','企业服务','北京','工具替换','UF'],['三一重工','智能制造','湖南·长沙','质量追溯','SANY']];
more.forEach((v,i)=>seedAccounts.push({...seedAccounts[0],id:'sample-'+i,name:v[0]+'（示例账户）',short:v[0],industry:v[1],region:v[2],scene:v[3],logo:v[4],size:'1,000-5,000',icp:88-i*7,signal:86-i*8,timing:80-i*6,reach:76-i*4,fit:85-i*5,risk:8+i*6,confidence:85,scope:v[1]+'相关产品研发与服务',listed:'待核实',website:'待核实',founded:'待核实',owner:['程飞飞','李思思','张伟'][i%3],updated:dates[i%5],status:i<3?'可立即触达':'待补充信号'}));
seedAccounts.forEach(a=>{a.score=score(a);a.grade=grade(a.score);});
export const seedSignals:Signal[]=original.signals.map((s,i)=>({...s,id:'sig-'+i,scene:i%2?'工具替换':'质量追溯',owner:['程飞飞','李思思','张伟'][i%3]}));
seedSignals[0]={...seedSignals[0],name:'集中招聘测试 / 质量岗位',type:'招聘信号',definition:'近30天集中发布5个及以上测试、质量或研发效能岗位，JD包含测试管理、需求追溯或质量体系关键词。'};
export const jobs:Job[]=original.jobs.map((j,i)=>({...j,id:'job-'+i,accountId:['byd','sample-1','catl','sample-0','nio','li','xpeng','saic'][i],company:seedAccounts.find(a=>a.id===['byd','sample-1','catl','sample-0','nio','li','xpeng','saic'][i])!.name,date:dates[i%5],city:['深圳','合肥','宁德','北京','上海','北京','广州','上海'][i],scene:i%2?'工具替换':'质量追溯'}));
jobs[0]={...jobs[0],title:'测试开发工程师',group:'研发 / 测试',keywords:['自动化测试','需求追溯','质量体系'],count:8};
export const seedHandoffs:Handoff[]=seedAccounts.slice(0,6).map((a,i)=>({id:'handoff-'+i,accountId:a.id,role:a.scene==='质量追溯'?'质量负责人 / 测试负责人':'研发效能负责人',signal:i%2?'招聘 JD 出现 Jira 与工具迁移关键词':'集中招聘测试开发，出现需求追溯关键词',case:a.scene+'场景案例',angle:'关注到贵司近期在扩充研发团队，想了解目前'+(a.scene==='质量追溯'?'需求到测试的追溯管理方式。':'研发工具之间的协作与数据流转方式。'),entry:'企业官网 / 官方招聘页',owner:['李思思','张伟','陈晨'][i%3],status:['待交付','已交付','SDR已接受','已交付','待补充信息','SDR已接受'][i],deadline:'2026-09-'+(18+i),created:'2026-09-'+(10+i),icp:a.industry+'，多团队研发协同，ICP '+a.icp+' 分'}));
export const seedFeedback:Feedback[]=[{id:'feedback-0',handoffId:'handoff-2',accountId:'saic',result:'有效交流',reason:'信号成立',note:'已与测试负责人交流，确认需求与测试之间存在追溯断点。',created:'2026-09-16'},{id:'feedback-1',handoffId:'handoff-5',accountId:'nio',result:'进入诊断',reason:'信号成立',note:'已约定场景诊断，重点讨论跨团队测试与版本管理。',created:'2026-09-17'}];
export const initial:Store={accounts:seedAccounts,signals:seedSignals,handoffs:seedHandoffs,feedback:seedFeedback,rules:[{id:'V1.0',weights:defaultWeights,note:'初始规则：A类 ≥75；B类 60–74；风险按20%扣分。',created:'2026-09-01'}]};
