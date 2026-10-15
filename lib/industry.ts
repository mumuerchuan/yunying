import taxonomy from './industry-taxonomy.json';
import type {Account} from './model';

export type IndustryClassification={level1:string;level2:string;level3:string;codes:string[];source:string;standard:string;status:'matched'|'partial'|'unmatched'|'empty'|'inferred'|'provisional';basis?:string;method?:'standard'|'scope'|'fallback'};
const standard='GB/T 4754—2017（2019年修改）';
const normalize=(v:string)=>v.trim().replace(/\s/g,'').replace(/[（(]/g,'(').replace(/[）)]/g,')');
const byName=new Map<string,typeof taxonomy>(),byCode=new Map(taxonomy.map(r=>[r.code,r]));
for(const row of taxonomy){const key=normalize(row.name);byName.set(key,[...(byName.get(key)||[]),row]);}
const cache=new Map<string,IndustryClassification>();
export function classifyIndustry(source:string):IndustryClassification{
 if(cache.has(source))return cache.get(source)!;
 const missing=!source.trim()||['待核实','暂无','-','—'].includes(source.trim());
 let matches=byName.get(normalize(source))||[];
 // 只接受标准名称、代码或明确的层级路径，不根据公司名称和经营范围猜测细分行业。
 if(!matches.length){
  const code=source.trim().match(/^([A-T]|\d{2,4})(?:\s*[-：:]?\s*([^\d].*))?$/i);
  if(code){const row=byCode.get(code[1].toUpperCase());if(row&&(!code[2]||normalize(code[2])===normalize(row.name)))matches=[row];}
 }
 if(!matches.length&&/[>＞→]/.test(source)){
  const parts=source.split(/[>＞→]/).map(normalize).filter(Boolean);
  matches=(byName.get(parts.at(-1)||'')||[]).filter(r=>parts.every(p=>r.path.some(([,label])=>normalize(label)===p)));
 }
 const unique=new Map(matches.map(r=>[r.path.slice(0,3).map(p=>p[0]).join('/'),r]));
 const row=unique.size===1?[...unique.values()][0]:undefined;
 const result:IndustryClassification=row?{level1:row.path[0][1],level2:row.path[1]?.[1]||'待细分',level3:row.path[2]?.[1]||'待细分',codes:row.path.slice(0,3).map(p=>p[0]),source,standard,status:row.path.length>=3?'matched':'partial'}:{level1:'待分类',level2:'待细分',level3:'待细分',codes:[],source,standard,status:missing?'empty':'unmatched'};
 if(cache.size>10000)cache.clear();cache.set(source,result);return result;
}
// 规则只在已有大类内细分，避免经营范围中的附带业务改变登记行业的上级分类。
const scopeRules:{code:string;terms:string[];weight:number}[]=[
 {code:'641',terms:['互联网接入','宽带接入','接入服务','网吧','上网服务','网络接入'],weight:8},
 {code:'642',terms:['互联网信息服务','互联网新闻','信息发布平台','网络资讯','网络出版','互联网视听'],weight:7},
 {code:'643',terms:['电子商务平台','交易平台','电商平台','互联网平台','网络交易','在线交易','互联网销售','网上销售'],weight:8},
 {code:'644',terms:['网络安全','信息安全','互联网安全','安全防护','安全评估','网络攻防'],weight:9},
 {code:'645',terms:['互联网数据','大数据服务','数据中心','云计算','云服务','数据存储','数据处理','数据分析'],weight:8},
 {code:'651',terms:['软件开发','软件研发','软件设计','应用软件','基础软件'],weight:8},
 {code:'652',terms:['集成电路设计','芯片设计','半导体设计'],weight:10},
 {code:'653',terms:['系统集成','物联网技术服务','信息系统集成','物联网应用'],weight:8},
 {code:'654',terms:['运行维护','运维服务','系统维护','信息系统运行'],weight:8},
 {code:'655',terms:['数据处理','数据存储','信息处理','存储支持'],weight:7},
 {code:'656',terms:['信息技术咨询','信息咨询服务','信息化咨询','计算机技术咨询'],weight:5},
 {code:'657',terms:['数字内容','动漫设计','游戏动漫','数字文化创意','数字出版'],weight:8},
];
export function withIndustryClassification(a:Account):Account{
 const raw=a.business?.['所属行业'];const source=raw&&!['待核实','-','—','暂无'].includes(raw.trim())?raw:a.industry;
 let classification:IndustryClassification={...classifyIndustry(source||''),method:'standard'};
 // 历史演示档案的明确同义名称也映射到国标路径，保留推断标记。
 const aliases:Record<string,string>={'汽车制造 > 整车制造':'361','汽车制造 > 新能源汽车':'361','电子 / 半导体':'397'};
 if(classification.status==='unmatched'&&aliases[source])classification={...classifyIndustry(aliases[source]),source,status:'inferred',method:'scope',basis:'原始行业名称与标准行业的同义映射，待核实'};
 if(classification.level3==='待细分'&&classification.codes.length>=2){
  const parent=classification.codes[1];
  const scope=a.business?.['经营范围']||a.scope||'';
  const candidates=scopeRules.filter(r=>r.code.startsWith(parent)).map(rule=>{
   const terms=rule.terms.filter(term=>scope.split(/[；;。]/).some(clause=>clause.includes(term)&&!/(?:不含|不从事|不得|禁止)/.test(clause)));
   return {...rule,terms,score:terms.length?rule.weight+Math.min(terms.length-1,3):0};
  });
  // 对其他大类，经营范围直接出现该大类下的标准中类名称时才使用。
  for(const row of taxonomy.filter(r=>r.path.length===3&&r.path[1][0]===parent)){
   if(scope.includes(row.name)&&!candidates.some(r=>r.code===row.code))candidates.push({code:row.code,terms:[row.name],weight:10,score:10});
  }
  const ranked=candidates.filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
  const winner=ranked[0];
  if(winner&&(!ranked[1]||winner.score-ranked[1].score>=2)){
   classification={...classification,level3:byCode.get(winner.code)!.name,codes:[...classification.codes.slice(0,2),winner.code],status:'inferred',method:'scope',basis:'经营范围关键词：'+winner.terms.join('、')+'；为运营细分推断，需核实主营业务'};
  }else{
   const fallback=taxonomy.find(r=>r.path.length===3&&r.path[1][0]===parent&&r.name.startsWith('其他'));
   if(fallback)classification={...classification,level3:fallback.name,codes:[...classification.codes.slice(0,2),fallback.code],status:'provisional',method:'fallback',basis:winner?'经营范围涉及多个细分方向，暂归其他，待核实主营业务':'经营范围未提供明确细分依据，按所属行业暂归其他，待核实'};
  }
 }
 return {...a,industryClassification:classification};
}
