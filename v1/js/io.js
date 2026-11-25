import {validateDocument} from './validation.js';
export const MAX_FILE_BYTES=10*1024*1024;
export async function readFamilyFile(file) {
  if(file.size>MAX_FILE_BYTES) return {ok:false,issues:[{severity:'error',code:'LIMIT_EXCEEDED',path:'file'}]};
  try{const bytes=await file.arrayBuffer();return parseDocument(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return {ok:false,issues:[{severity:'error',code:'READ_FAILED',path:'file'}]};}
}
export function parseDocument(text) {
  try{return validateDocument(JSON.parse(text.replace(/^\uFEFF/,'')));}
  catch{return {ok:false,issues:[{severity:'error',code:'INVALID_JSON',path:'file'}]};}
}
export async function readSample() {
  try {
    const response=await fetch(new URL('../../samples/sample_family.json',import.meta.url),{cache:'no-store'});
    if(!response.ok) throw new Error();
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>MAX_FILE_BYTES)return {ok:false,issues:[{severity:'error',code:'LIMIT_EXCEEDED',path:'file'}]};
    return parseDocument(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{return {ok:false,issues:[{severity:'error',code:'READ_FAILED',path:'sample'}]};}
}
export function serializeDocument(document) {
  const checked=validateDocument(document);
  if(!checked.ok)return checked;
  const copy=checked.document;
  copy.persons.sort((a,b)=>a.id-b.id);
  copy.families.sort((a,b)=>a.id-b.id);
  copy.family_children.sort((a,b)=>a.family_id-b.family_id||a.sort_order-b.sort_order||a.id-b.id);
  return {ok:true,text:JSON.stringify(copy,null,2)+'\n'};
}
export function downloadDocument(document) {
  const result=serializeDocument(document);
  if(!result.ok)return result;
  const now=new Date();
  const pad=n=>String(n).padStart(2,'0');
  const name='family-tree-'+now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds())+'.json';
  const url=URL.createObjectURL(new Blob([result.text],{type:'application/json;charset=utf-8'}));
  const a=window.document.createElement('a');
  a.href=url;a.download=name;a.hidden=true;
  window.document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return {ok:true,name};
}
