"use client";
import {useRef,useState,useMemo} from 'react';
import {Upload,Download,CheckCircle2,AlertCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {batchBusinessRows,parseBusinessSheet,isMissing,planBusinessImport,type BusinessRow,type ImportMode} from '@/lib/business-import';
import type {Account} from '@/lib/model';
import {toast} from 'sonner';

type Sheet={sheet:string;data:unknown[][]};
export default function BusinessImport({accounts,scopeId,onSaved}:{accounts:Account[];scopeId?:string;onSaved:()=>Promise<void>}){
 const input=useRef<HTMLInputElement>(null);
 const [open,setOpen]=useState(false),[sheets,setSheets]=useState<Sheet[]>([]),[sheet,setSheet]=useState(''),[fileName,setFileName]=useState(''),[mode,setMode]=useState<ImportMode>('fill'),[rows,setRows]=useState<BusinessRow[]>([]),[ignored,setIgnored]=useState<string[]>([]),[recognized,setRecognized]=useState(0),[selected,setSelected]=useState<number[]>([]),[detail,setDetail]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[result,setResult]=useState<{created:number;updated:number;fields:number}|null>(null),[progress,setProgress]=useState<{done:number;total:number}|null>(null),[previewPage,setPreviewPage]=useState(1);
 const plan=useMemo(()=>planBusinessImport(rows,accounts,mode,scopeId),[rows,accounts,mode,scopeId]);
 const selectedSet=useMemo(()=>new Set(selected),[selected]);
 const eligible=useMemo(()=>plan.filter(r=>(r.account||r.create)&&r.changes.length),[plan]);
 const chosen=useMemo(()=>eligible.filter(r=>selectedSet.has(r.row)),[eligible,selectedSet]);
 const totalPages=Math.max(1,Math.ceil(plan.length/50)),currentPage=Math.min(previewPage,totalPages),visible=plan.slice((currentPage-1)*50,currentPage*50);
 const showSheet=(next:Sheet)=>{
  setSheet(next.sheet);setError('');setRows([]);setSelected([]);setDetail(null);setPreviewPage(1);setProgress(null);setResult(null);
  try{const parsed=parseBusinessSheet(next.data);setRows(parsed.rows);setIgnored(parsed.ignored);setRecognized(parsed.recognized);setSelected(parsed.rows.map(r=>r.row));}catch(e){setError(e instanceof Error?e.message:'读取工作表失败');}
 };
 const read=async(file:File)=>{
  setError('');setResult(null);setProgress(null);setRows([]);setSheets([]);setSheet('');setFileName(file.name);
  if(!/\.xlsx$/i.test(file.name)){setError('请上传 .xlsx 文件；旧版 .xls 请在 Excel 中另存为 .xlsx。');return;}
  if(file.size>5*1024*1024){setError('文件不能超过 5 MB，请分批上传。');return;}
  setReading(true);
  try{const {default:readExcel}=await import('read-excel-file/browser');const parsed=await readExcel(file,{parseNumber:v=>v}) as Sheet[];if(!parsed.length)throw Error('没有可读取的工作表');setSheets(parsed);showSheet(parsed[0]);}
  catch(e){setError(e instanceof Error&&e.message.startsWith('没有')?e.message:'无法读取 Excel，请确认文件未加密、未损坏，并另存为 .xlsx 后重试。');}
  finally{setReading(false);}
 };
 const save=async()=>{
  setBusy(true);setError('');setResult(null);setProgress({done:0,total:chosen.length});
  let done=0,created=0,updated=0,fields=0;
  try{
   const batches=batchBusinessRows(chosen.map(r=>({row:r.row,fields:r.fields,accountId:r.account?.id,create:!!r.create})));
   for(const batch of batches){
    const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'businessImport',data:{rows:batch,mode,fileName,scopeId}})});
    const data=await response.json() as {error?:string;created:number;updated:number;fields:number};
    if(!response.ok)throw Error(data.error||'导入失败，请重试');
    done+=batch.length;created+=data.created||0;updated+=data.updated;fields+=data.fields;
    const saved=new Set(batch.map(r=>r.row));
    setRows(previous=>previous.filter(r=>!saved.has(r.row)));setSelected(previous=>previous.filter(r=>!saved.has(r)));setDetail(null);
    setProgress({done,total:chosen.length});setResult({created,updated,fields});
   }
   setSheets([]);toast.success(`已处理 ${done} 家企业，新增 ${created} 家，更新 ${updated} 家`);
  }catch(e){setError((e instanceof Error?e.message:'导入失败')+`。本次已完成 ${done} / ${chosen.length} 家，已完成的数据已保留，可点击“继续导入”重试剩余记录。`);}
  finally{await onSaved();setBusy(false);}
 };
 return <><button className="btn" onClick={()=>{setOpen(true);setError('');}}><Upload size={15}/>上传工商 Excel</button><Dialog open={open} onOpenChange={v=>{if(!busy&&!reading)setOpen(v)}}><DialogContent className="business-import-dialog"><DialogHeader><DialogTitle>Excel 导入企业与工商信息</DialogTitle><DialogDescription>{scopeId?'仅补全当前账户的登记资料。':'根据 Excel 新增企业，已有企业自动匹配并补全登记资料。'}支持爱企查的 27 个字段，按企业全称或统一社会信用代码匹配。</DialogDescription></DialogHeader>
  <div className="business-import-body">
   <div className="business-import-upload"><div><b>上传爱企查 Excel 文件</b><p>.xlsx · 最大 5 MB · 企业数量不限 · 不执行文件中的公式</p></div><button className="btn primary" disabled={reading||busy} onClick={()=>input.current?.click()}><Upload size={16}/>{reading?'读取中…':fileName?'重新选择文件':'选择 Excel'}</button><input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void read(f);}}/></div>
   <div className="business-import-meta"><a className="text-button" href="/business-import-template.xlsx" download><Download size={14}/>下载空白模板</a>{fileName&&<span>{fileName}</span>}{sheets.length>1&&<label>工作表 <select disabled={busy||reading} value={sheet} onChange={e=>showSheet(sheets.find(s=>s.sheet===e.target.value)!)}>{sheets.map(s=><option key={s.sheet}>{s.sheet}</option>)}</select></label>}</div>
   {progress&&<div className="business-import-progress" role="status" aria-live="polite"><span>{busy?'正在保存':'本次处理进度'}：{progress.done} / {progress.total} 家</span><progress max={progress.total||1} value={progress.done}/></div>}
   {result&&<div className="business-import-success" role="status"><CheckCircle2 size={20}/>已新增 {result.created} 家企业，更新 {result.updated} 家企业，共 {result.fields} 个工商字段。剩余 {rows.length} 行中，需核对 {plan.filter(r=>!r.account&&!r.create).length} 行，已有资料无需更新 {plan.filter(r=>r.account&&!r.changes.length).length} 行。</div>}
   {error&&<div className="business-import-error" role="alert"><AlertCircle size={18}/>{error}</div>}
   {rows.length>0&&<>
    <div className="business-import-options"><label><input type="radio" name={'import-mode-'+(scopeId||'all')} checked={mode==='fill'} disabled={busy} onChange={()=>setMode('fill')}/>已有企业：仅补全空字段（推荐）</label><label><input type="radio" name={'import-mode-'+(scopeId||'all')} checked={mode==='overwrite'} disabled={busy} onChange={()=>setMode('overwrite')}/>已有企业：用 Excel 非空值更新工商字段</label></div>
    <p className="business-import-hint">已识别 {recognized} / 27 个字段 · 共 {rows.length} 行 · 可导入 {eligible.length} 行（新增 {eligible.filter(r=>r.create).length} 家，更新 {eligible.filter(r=>r.account).length} 家）。空单元格和“-”不会清空已有数据；已有企业的运营负责人、评分和状态不受影响；新企业负责人和战役为待分配。</p>
    {ignored.length>0&&<p className="business-import-hint">忽略未识别列：{ignored.join('、')}</p>}
    <div className="business-import-table"><table><thead><tr><th><input aria-label="全选可导入行" type="checkbox" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(r=>selectedSet.has(r.row))} onChange={e=>setSelected(e.target.checked?eligible.map(r=>r.row):[])}/></th><th>Excel 行</th><th>企业名称</th><th>匹配结果</th><th>变更</th></tr></thead><tbody>{visible.map(r=><tr key={r.row}><td><input aria-label={'选择第 '+r.row+' 行'} type="checkbox" checked={!!(r.account||r.create)&&!!r.changes.length&&selectedSet.has(r.row)} disabled={busy||(!r.account&&!r.create)||!r.changes.length} onChange={e=>setSelected(e.target.checked?[...selected,r.row]:selected.filter(i=>i!==r.row))}/></td><td>{r.row}</td><td>{r.fields['企业名称']||'（空）'}{r.account&&<small>→ {r.account.name}</small>}</td><td><span className={r.account||r.create?'import-match':'import-skip'}>{r.reason}</span></td><td>{r.account||r.create?<button className="text-button" onClick={()=>setDetail(detail===r.row?null:r.row)}>{r.changes.length} 个字段 · 预览</button>:'跳过'}</td></tr>)}</tbody></table></div>
    {totalPages>1&&<div className="business-import-pagination"><span>第 {currentPage} / {totalPages} 页 · 共 {plan.length} 行，每页 50 行</span><button className="btn" disabled={busy||currentPage<=1} onClick={()=>setPreviewPage(currentPage-1)}>上一页</button><button className="btn" disabled={busy||currentPage>=totalPages} onClick={()=>setPreviewPage(currentPage+1)}>下一页</button></div>}
    {detail!==null&&<div className="business-import-changes"><b>第 {detail} 行 · 字段变更预览</b>{plan.find(r=>r.row===detail)?.changes.length?<table><thead><tr><th>字段</th><th>原值</th><th>导入值</th></tr></thead><tbody>{plan.find(r=>r.row===detail)!.changes.map(c=><tr key={c.field}><th>{c.field}</th><td>{isMissing(c.before)?'待核实':c.before}</td><td>{c.after}</td></tr>)}</tbody></table>:<p>没有可更新的字段。可切换更新模式查看。</p>}</div>}
   </>}
   <p className="business-import-hint">未匹配企业将自动新增。非18位信用代码按原样保存并标为待核实，按企业全称导入，不参与代码匹配或去重。主体冲突、文件内重复及缺少名称等异常行仍需核对。</p>
  </div><div className="business-import-footer"><span>{chosen.length>0?`已选 ${chosen.length} 家企业 · ${chosen.reduce((n,r)=>n+r.changes.length,0)} 个字段`:result?(plan.some(r=>!r.account&&!r.create)?'可导入记录已完成，剩余异常记录需核对':'导入完成'):'选择文件并核对匹配结果后导入'}</span><button className="btn" disabled={busy||reading} onClick={()=>setOpen(false)}>关闭</button><button className="btn primary" disabled={busy||reading||!chosen.length} onClick={()=>void save()}>{busy?'保存中…':error&&progress?'继续导入':'确认导入'}</button></div>
 </DialogContent></Dialog></>;
}
