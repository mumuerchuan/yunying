"use client";
import {useState,useEffect} from 'react';
export default function BusinessPagination({total,page,pageSize,onPage,onPageSize}:{total:number;page:number;pageSize:number;onPage:(page:number)=>void;onPageSize:(size:number)=>void}){
 const pages=Math.max(1,Math.ceil(total/pageSize));
 const [sizeDraft,setSizeDraft]=useState(String(pageSize)),[pageDraft,setPageDraft]=useState(String(page));
 useEffect(()=>setSizeDraft(String(pageSize)),[pageSize]);
 useEffect(()=>setPageDraft(String(page)),[page]);
 const presets=[20,50,100,200];
 return <div className="business-pagination" aria-label="工商企业分页"><div className="business-pagination-summary" aria-live="polite">共 {total.toLocaleString('zh-CN')} 条{total>0&&<> · 当前 {(page-1)*pageSize+1}–{Math.min(page*pageSize,total)} 条</>}</div><div className="business-pagination-controls">
  <label>每页 <select aria-label="工商每页条数" value={presets.includes(pageSize)?String(pageSize):'custom'} onChange={e=>{if(e.target.value==='custom'){document.getElementById('business-page-size')?.focus();}else onPageSize(Number(e.target.value))}}>{presets.map(n=><option key={n} value={n}>{n} 条</option>)}<option value="custom">自定义</option></select></label>
  <form onSubmit={e=>{e.preventDefault();const input=e.currentTarget.elements.namedItem('size') as HTMLInputElement;const n=Number(sizeDraft);if(!Number.isSafeInteger(n)||n<1){input.setCustomValidity('请输入大于 0 的整数');input.reportValidity();return;}input.setCustomValidity('');onPageSize(n);}}><input id="business-page-size" name="size" aria-label="自定义每页条数" type="number" min="1" step="1" required value={sizeDraft} onChange={e=>{e.target.setCustomValidity('');setSizeDraft(e.target.value)}}/><button className="btn" type="submit">应用</button></form>
  <div className="business-pagination-buttons"><button className="btn" disabled={page<=1} onClick={()=>onPage(1)}>首页</button><button className="btn" disabled={page<=1} onClick={()=>onPage(page-1)}>上一页</button><span aria-live="polite">{page} / {pages}</span><button className="btn" disabled={page>=pages} onClick={()=>onPage(page+1)}>下一页</button><button className="btn" disabled={page>=pages} onClick={()=>onPage(pages)}>末页</button></div>
  <form onSubmit={e=>{e.preventDefault();const n=Number(pageDraft);if(Number.isSafeInteger(n))onPage(Math.max(1,Math.min(pages,n)));}}><label>跳至 <input name="page" aria-label="工商跳转页码" type="number" min="1" max={pages} step="1" required value={pageDraft} onChange={e=>setPageDraft(e.target.value)}/></label><button className="btn" type="submit">跳转</button></form>
 </div></div>;
}
