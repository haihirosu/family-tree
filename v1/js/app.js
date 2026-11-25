import {emptyDocument,blankPerson} from './model.js';
import {runCommand} from './commands.js';
import {layout} from './layout.js';
import {Viewport} from './viewport.js';
import {loadLanguage,t,initialLanguage,getLanguage,formatPartialDate} from './i18n.js';
import {readSample,readFamilyFile,downloadDocument} from './io.js';
import {el,button,showSheet,closeSheet,toast,translateStatic,showIssues} from './ui.js';
import {renderTree,renderRoster,displayName} from './render.js';

const $=window.jQuery;
const state={document:emptyDocument(),drafts:new Map(),nextDraft:1,view:'tree',query:'',mode:null,selected:null,ready:false};
let geometry={nodes:[],families:[],edges:[],bounds:{width:1,height:1},issues:[]};
let readToken=0;
let candidates=[];
let viewport;
viewport=new Viewport(document.getElementById('viewport'),document.getElementById('world'),{
  onTransform:()=>{document.getElementById('zoom-value').textContent=Math.round((viewport?.scale??1)*100)+'%';}
});

const person=id=>state.document.persons.find(p=>p.id===id);
const family=id=>state.document.families.find(f=>f.id===id);
const links=id=>state.document.family_children.filter(c=>c.family_id===id).sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id);
const parents=id=>state.document.family_children.filter(c=>c.child_id===id);
const partners=id=>state.document.families.filter(f=>f.partner1_id===id||f.partner2_id===id);
const subjectPerson=subject=>subject.draftKey?state.drafts.get(subject.draftKey):person(subject.personId);
const subjectName=subject=>displayName(subjectPerson(subject));
const familyName=f=>{
  const names=[f.partner1_id,f.partner2_id].filter(id=>id!==null).map(id=>displayName(person(id)));
  const status=f.marital_status===null?'':['married','divorced','separated','unmarried','widowed'].includes(f.marital_status)?t('marital.'+f.marital_status):f.marital_status;
  return (names.length?t('label.family',{id:f.id})+' · '+names.join(' / '):t('label.familyUnknown',{id:f.id}))+' · '+t('label.childCount',{count:links(f.id).length})+(status?' · '+status:'');
};
const actionRow=(...items)=>el('div',{class:'sheet-actions'},...items);

function render({fit=false,preserve=true}={}) {
  const snapshot=preserve?viewport.snapshot(geometry.nodes,state.selected):null;
  geometry=layout(state.document);
  candidates=state.mode?.kind==='placement'?makeCandidates(state.mode):[];
  renderTree(state.document,geometry,state.selected,candidates);
  renderRoster(state.document,state.drafts,state.query,openPerson,openDraft);
  document.getElementById('summary').textContent=state.document.persons.length+' '+t('label.persons')+' · '+state.document.families.length+' '+t('label.families');
  document.getElementById('empty-state').hidden=Boolean(state.document.persons.length||state.document.families.length||!state.ready||geometry.issues?.length);
  document.getElementById('loading').hidden=state.ready;
  const tray=document.getElementById('draft-tray');
  tray.hidden=!state.drafts.size;
  tray.replaceChildren(el('h3',{text:t('label.drafts')+' · '+state.drafts.size}),...[...state.drafts].slice(0,4).map(([key,p])=>button(displayName(p),()=>openDraft(key))));
  document.getElementById('status-message').textContent=geometry.issues?.length?t('label.layoutError'):t('label.saveReminder');
  if(fit&&!document.getElementById('tree-view').hidden)viewport.fit(geometry.bounds);
  else if(snapshot)viewport.restore(snapshot,geometry.nodes);
  updateMode();
}

function setView(view) {
  const previous=state.view;
  state.view=view;
  document.getElementById('tree-view').hidden=view!=='tree';
  document.getElementById('roster-view').hidden=view!=='roster';
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
  document.getElementById('view-title').textContent=t(view==='tree'?'nav.tree':'nav.roster');
  if(view==='tree'&&previous!=='tree')viewport.apply();
}

function updateMode() {
  const mode=state.mode;
  const banner=document.getElementById('interaction-banner');
  banner.hidden=!mode;
  document.getElementById('place-root').hidden=!(mode?.kind==='placement'&&mode.subject.draftKey);
  if(!mode)return;
  document.getElementById('interaction-title').textContent=mode.kind==='pick'?mode.title:subjectName(mode.subject)+' · '+t(mode.move?'action.move':'action.place');
  document.getElementById('interaction-detail').textContent=mode.move&&parents(mode.subject.personId).length>=2?t('label.moveAdds'):t('label.chooseTarget');
}

/** Commands only mutate a private candidate document; the UI commits once after every step succeeds. */
function transact(work,{message='label.updated',removeDrafts=[],focusId=null,after}={}) {
  let next=state.document;
  const command=(type,args)=>{
    const result=runCommand(next,type,args);
    if(!result.ok)throw result.issues;
    next=result.document;return result;
  };
  try {
    const output=work(command);
    state.document=next;
    for(const key of removeDrafts)state.drafts.delete(key);
    state.mode=null;
    state.selected=focusId??(typeof output==='number'?output:null);
    closeSheet();render();toast(t(message));
    after?.();return true;
  }catch(issues){showIssues(Array.isArray(issues)?issues:[{code:'GENERIC',severity:'error',path:''}]);return false;}
}

function promote(subject,command) {
  if(subject.personId)return subject.personId;
  const value=state.drafts.get(subject.draftKey);
  if(!value)throw [{code:'REFERENCE_NOT_FOUND',path:'draft'}];
  return command('addPerson',{person:value}).personId;
}
const draftKeys=subjects=>subjects.filter(s=>s?.draftKey).map(s=>s.draftKey);

function graphReachable(id,{reverse=false,excludeLinkId=null}={}) {
  const graph=new Map(state.document.persons.map(p=>[p.id,[]]));
  const byFamily=new Map(state.document.families.map(f=>[f.id,f]));
  for(const c of state.document.family_children) {
    if(c.id===excludeLinkId)continue;
    const f=byFamily.get(c.family_id);
    for(const p of [f.partner1_id,f.partner2_id])if(p!==null)graph.get(reverse?c.child_id:p).push(reverse?p:c.child_id);
  }
  const seen=new Set([id]),queue=[id];
  for(let i=0;i<queue.length;i++)for(const next of graph.get(queue[i])??[])if(!seen.has(next)){seen.add(next);queue.push(next);}
  return seen;
}

function makeCandidates(mode) {
  const out=[];
  const id=mode.subject.personId;
  const memberships=id?parents(id):[];
  const descendants=id?graphReachable(id,{excludeLinkId:mode.move&&memberships.length===1?memberships[0].id:null}):new Set();
  const ancestors=id?graphReachable(id,{reverse:true}):new Set();
  const nodeById=new Map(geometry.nodes.map(n=>[n.personId,n]));
  const anchorById=new Map(geometry.families.map(f=>[f.familyId,f]));
  if(mode.subject.draftKey)out.push({key:'root',kind:'root',label:t('action.newRoot')});
  for(const f of [...state.document.families].sort((a,b)=>a.id-b.id)) {
    const own=memberships.find(c=>c.family_id===f.id);
    const canChild=(!id||![f.partner1_id,f.partner2_id].includes(id))&&(!id||![f.partner1_id,f.partner2_id].some(p=>p!==null&&descendants.has(p)));
    if(canChild&&(mode.move||!own)) {
      const children=links(f.id).filter(c=>!(mode.move&&c.child_id===id));
      const positions=children.map(c=>nodeById.get(c.child_id)).filter(Boolean);
      const anchor=anchorById.get(f.id);
      for(let i=0;i<=children.length;i++) {
        const before=children[i]??null;
        const label=familyName(f)+' · '+(before?t('label.before',{name:displayName(person(before.child_id))}):t('label.append'));
        let position;
        if(positions.length===children.length&&positions.length) {
          const x=i===0?positions[0].x-22:i===children.length?positions.at(-1).x+positions.at(-1).width+22:(positions[i-1].x+positions[i-1].width+positions[i].x)/2;
          position={x,y:positions[0].y-27};
        }else if(anchor)position={x:anchor.x,y:anchor.y+54};
        out.push({key:'child:'+f.id+':'+(before?.id??'end'),kind:'child-slot',familyId:f.id,beforeChildLinkId:before?.id??null,label,position});
      }
    }
    if(!mode.move)for(const slot of ['partner1_id','partner2_id']) {
      if(f[slot]!==null||[f.partner1_id,f.partner2_id].includes(id)||links(f.id).some(c=>ancestors.has(c.child_id)))continue;
      const anchor=anchorById.get(f.id);
      out.push({key:'partner:'+f.id+':'+slot,kind:'partner-slot',familyId:f.id,slot,label:familyName(f)+' · '+t('label.emptyPartnerSlot'),position:anchor?{x:anchor.x+(slot==='partner1_id'?-38:38),y:anchor.y-32}:null});
    }
  }
  if(!mode.move)for(const p of [...state.document.persons].sort((a,b)=>a.id-b.id)) {
    if(p.id===id)continue;
    if(id&&partners(id).some(f=>[f.partner1_id,f.partner2_id].includes(p.id)))continue;
    // New-family candidates are kept in the list; empty slots and child slots are the canvas targets.
    out.push({key:'new-partner:'+p.id,kind:'new-partner-family',anchorPersonId:p.id,label:t('label.newPartnerFamily',{name:displayName(p)})});
  }
  return out;
}

function startPlacement(subject,move=false) {
  closeSheet();state.mode={kind:'placement',subject,move};state.selected=subject.personId??null;
  setView('tree');render();toast(t('notice.placementReady'));
}
function applyCandidate(candidate) {
  if(!state.mode||state.mode.kind!=='placement')return;
  const mode=state.mode;
  transact(command=>{
    const id=promote(mode.subject,command);
    if(candidate.kind==='child-slot')command(mode.move?'moveChildByPerson':'addChild',{personId:id,childId:id,familyId:candidate.familyId,beforeChildLinkId:candidate.beforeChildLinkId,relationType:null});
    if(candidate.kind==='partner-slot')command('setFamilyPartner',{familyId:candidate.familyId,slot:candidate.slot,personId:id});
    if(candidate.kind==='new-partner-family')command('createFamily',{partner1Id:candidate.anchorPersonId,partner2Id:id,status:null});
    return id;
  },{message:'label.created',removeDrafts:draftKeys([mode.subject])});
}
function showCandidateList() {
  if(state.mode?.kind==='pick'){showPersonChooser(state.mode.title,state.mode.callback,state.mode.excludeId);return;}
  if(state.mode?.kind!=='placement')return;
  const content=el('div');
  const search=el('input',{type:'search',class:'choice-search',placeholder:t('label.search'),'aria-label':t('label.search')});
  const list=el('div',{class:'choice-list'});
  const paint=()=>{
    const q=search.value.toLocaleLowerCase();
    list.replaceChildren(...candidates.filter(c=>c.label.toLocaleLowerCase().includes(q)).map(c=>button(c.label,()=>applyCandidate(c))));
    if(!list.childNodes.length)list.append(el('p',{text:t('label.noResults')}));
  };
  search.addEventListener('input',paint);paint();content.append(search,list);
  showSheet(t('label.selectPosition'),content);
}

function showPersonChooser(title,callback,excludeId=null) {
  const content=el('div');
  const search=el('input',{type:'search',class:'choice-search',placeholder:t('label.search'),'aria-label':t('label.search')});
  const list=el('div',{class:'choice-list'});
  const paint=()=>{
    const q=search.value.toLocaleLowerCase();
    const entries=[...state.drafts].map(([draftKey,p])=>({subject:{draftKey},p})).concat(state.document.persons.filter(p=>p.id!==excludeId).map(p=>({subject:{personId:p.id},p})));
    list.replaceChildren(...entries.filter(({p})=>!q||[p.name,p.nickname].some(v=>v?.toLocaleLowerCase().includes(q))).map(({subject,p})=>{
      const b=button(displayName(p),()=>{closeSheet();state.mode=null;callback(subject);});
      b.append(el('small',{text:subject.draftKey?t('label.unplaced'):'#'+p.id}));return b;
    }));
    if(!list.childNodes.length)list.append(el('p',{text:t('label.noResults')}));
  };
  search.addEventListener('input',paint);paint();
  content.append(search,button(t('action.showTree'),()=>{closeSheet();state.mode={kind:'pick',title,callback,excludeId};setView('tree');render();}),list,
    actionRow(button(t('action.addPerson'),()=>openPersonForm(null,callback),'primary')));
  showSheet(title,content);
}

function chooseFamily(title,choices,callback) {
  const content=el('div',{class:'choice-list'});
  for(const choice of choices)content.append(button(choice.label,()=>{closeSheet();callback(choice.value);}));
  if(!choices.length)content.append(el('p',{class:'notice',text:t('label.noFamilies')}));
  showSheet(title,content);
}
function choosePosition(familyId,callback) {
  const content=el('div',{class:'choice-list'});
  content.append(button(t('label.append'),()=>{closeSheet();callback(null);},'primary'));
  for(const c of links(familyId))content.append(button(t('label.before',{name:displayName(person(c.child_id))}),()=>{closeSheet();callback(c.id);}));
  showSheet(t('label.selectPosition'),content);
}

function connectPartner(id) {
  const choices=partners(id).filter(f=>f.partner1_id===null||f.partner2_id===null).map(f=>({label:familyName(f)+' · '+t('label.emptyPartnerSlot'),value:{familyId:f.id,slot:f.partner1_id===null?'partner1_id':'partner2_id'}}));
  choices.push({label:t('action.newFamily'),value:null});
  chooseFamily(t('label.selectFamily'),choices,target=>showPersonChooser(t('action.partner'),other=>transact(command=>{
    const otherId=promote(other,command);
    const existing=state.document.families.find(f=>f.partner1_id!==null&&f.partner2_id!==null&&[f.partner1_id,f.partner2_id].includes(id)&&[f.partner1_id,f.partner2_id].includes(otherId));
    if(existing){queueMicrotask(()=>openFamily(existing.id));return id;}
    if(target)command('setFamilyPartner',{...target,personId:otherId});
    else command('createFamily',{partner1Id:id,partner2Id:otherId,status:null});
    return id;
  },{removeDrafts:draftKeys([other])}),id));
}
function addChild(id) {
  const choices=partners(id).map(f=>({label:familyName(f),value:f.id}));
  choices.push({label:t('action.newFamily')+' · '+displayName(person(id)),value:null});
  chooseFamily(t('label.selectFamily'),choices,familyId=>showPersonChooser(t('action.addChild'),child=>{
    const connect=before=>transact(command=>{
      const childId=promote(child,command);
      const target=familyId??command('createFamily',{partner1Id:id,partner2Id:null,status:null}).familyId;
      command('addChild',{familyId:target,childId,beforeChildLinkId:before,relationType:null});return childId;
    },{removeDrafts:draftKeys([child])});
    if(familyId)choosePosition(familyId,connect);else connect(null);
  },id));
}
function connectParentFamily(id) {
  const available=state.document.families.filter(f=>!links(f.id).some(c=>c.child_id===id));
  const choices=available.map(f=>({label:familyName(f),value:f.id}));
  choices.push({label:t('action.newFamily'),value:null});
  chooseFamily(t('label.selectFamily'),choices,familyId=>{
    if(familyId===null){addParent(id,true);return;}
    choosePosition(familyId,before=>transact(command=>{command('addChild',{familyId,childId:id,beforeChildLinkId:before,relationType:null});return id;}));
  });
}
function addParent(id,forceNew=false) {
  const choices=forceNew?[]:parents(id).map(c=>family(c.family_id)).filter(f=>f.partner1_id===null||f.partner2_id===null).map(f=>({label:familyName(f)+' · '+t('label.emptyPartnerSlot'),value:{familyId:f.id,slot:f.partner1_id===null?'partner1_id':'partner2_id'}}));
  const select=target=>showPersonChooser(t('action.addParent'),parent=>transact(command=>{
    const parentId=promote(parent,command);
    if(target)command('setFamilyPartner',{...target,personId:parentId});
    else {
      const familyId=command('createFamily',{partner1Id:parentId,partner2Id:null,status:null}).familyId;
      command('addChild',{familyId,childId:id,beforeChildLinkId:null,relationType:null});
    }
    return id;
  },{removeDrafts:draftKeys([parent])}),id);
  if(forceNew){select(null);return;}
  choices.push({label:t('action.newFamily'),value:null});chooseFamily(t('label.selectFamily'),choices,select);
}

function openPerson(id) {
  const p=person(id);if(!p)return;
  if(state.mode?.kind==='pick') {
    if(id===state.mode.excludeId)return;
    const callback=state.mode.callback;state.mode=null;render();callback({personId:id});return;
  }
  state.selected=id;render();
  const content=el('div',{},el('div',{class:'detail-avatar','aria-hidden':'true',text:Array.from(displayName(p))[0]}),el('p',{class:'detail-id',text:'#'+id}));
  const details=el('dl',{class:'detail-list'});
  for(const key of ['nickname','gender','birth_date','residence','birth_place','occupation','is_alive','death_date','notes']) {
    const value=p[key];if(value===null)continue;
    const text=key.endsWith('_date')?formatPartialDate(value):key==='is_alive'?t('alive.'+value):key==='gender'&&['male','female','other'].includes(value)?t('gender.'+value):String(value);
    details.append(el('dt',{text:t('field.'+key)}),el('dd',{text}));
  }
  if(details.childNodes.length)content.append(details);
  const menu=el('div',{class:'menu-list'});
  const actions=[['action.edit',()=>openPersonForm({personId:id})],['action.showTree',()=>{closeSheet();setView('tree');viewport.focus(geometry.nodes.find(n=>n.personId===id));}],['action.move',()=>startPlacement({personId:id},true)],['action.partner',()=>connectPartner(id)],['action.addChild',()=>addChild(id)],['action.connectParentFamily',()=>connectParentFamily(id)],['action.addParent',()=>addParent(id)],['action.relations',()=>openRelations(id)],['action.delete',()=>confirmDeletePerson(id)]];
  for(const [key,fn]of actions)menu.append(button(t(key),fn,key==='action.delete'?'danger':''));
  content.append(menu);showSheet(displayName(p),content);
}
function openDraft(key) {
  if(!state.drafts.has(key))return;
  if(state.mode?.kind==='pick'){const callback=state.mode.callback;state.mode=null;callback({draftKey:key});return;}
  const content=el('div',{},el('p',{class:'notice',text:t('label.unplaced')}),el('div',{class:'menu-list'},
    button(t('action.edit'),()=>openPersonForm({draftKey:key})),
    button(t('action.place'),()=>startPlacement({draftKey:key}),'primary'),
    button(t('action.discard'),()=>{state.drafts.delete(key);closeSheet();state.mode=null;render();toast(t('label.removed'));},'danger')));
  showSheet(displayName(state.drafts.get(key)),content);
}

function selectControl(values,translationPrefix,current,{nullable=true}={}) {
  const wrap=el('div');
  const select=el('select');
  if(nullable)select.append(el('option',{value:'',text:t('label.unknown')}));
  for(const value of values)select.append(el('option',{value,text:t(translationPrefix+'.'+value)}));
  select.append(el('option',{value:'__custom',text:t('label.custom')}));
  const custom=el('input',{class:'custom-input',type:'text',maxlength:100,'aria-label':t('label.custom'),value:current&&!values.includes(current)?current:''});
  select.value=current===null?'':values.includes(current)?current:'__custom';
  custom.hidden=select.value!=='__custom';
  select.addEventListener('change',()=>{custom.hidden=select.value!=='__custom';if(!custom.hidden)custom.focus();});
  wrap.append(select,custom);return {wrap,value:()=>select.value==='__custom'?custom.value||null:select.value||null};
}
function dateControl(value,label) {
  const wrap=el('div',{class:'date-inputs'});
  const parts=value===null?['','','']:[Math.floor(value/10000),Math.floor(value/100)%100||'',value%100||''];
  const inputs=['year','month','day'].map((key,i)=>el('input',{type:'number',min:1,max:[9999,12,31][i],step:1,placeholder:t('label.'+key),'aria-label':label+' · '+t('label.'+key),value:parts[i]}));
  wrap.append(...inputs);return {wrap,value:()=>inputs.every(n=>!n.value)?null:Number(inputs[0].value)*10000+Number(inputs[1].value)*100+Number(inputs[2].value)};
}
function openPersonForm(subject=null,onSaved=null) {
  const original=subject?subjectPerson(subject):blankPerson();
  const form=el('form');
  const grid=el('div',{class:'person-form'}),controls={};
  for(const key of ['name','nickname','gender','residence','birth_place','birth_date','occupation','is_alive','death_date','notes']) {
    const field=el('label',{class:'field'+(key==='notes'?' full':'')},el('span',{text:t('field.'+key)}));
    let control;
    if(key==='gender')control=selectControl(['male','female','other'],'gender',original[key]);
    else if(key.endsWith('_date'))control=dateControl(original[key],t('field.'+key));
    else if(key==='is_alive') {
      const select=el('select',{},el('option',{value:'',text:t('alive.unknown')}),el('option',{value:'true',text:t('alive.true')}),el('option',{value:'false',text:t('alive.false')}));
      select.value=original[key]===null?'':String(original[key]);control={wrap:select,value:()=>select.value===''?null:select.value==='true'};
    }else {
      const input=el(key==='notes'?'textarea':'input',{type:key==='notes'?null:'text',maxlength:key==='notes'?20000:500,value:key==='notes'?null:original[key]??''});
      if(key==='notes')input.value=original[key]??'';
      control={wrap:input,value:()=>input.value||null};
    }
    controls[key]=control;field.append(control.wrap);grid.append(field);
  }
  const error=el('div',{role:'alert'});
  const submit=el('button',{type:'submit',class:'primary',text:t('action.save')});
  form.append(grid,error,actionRow(button(t('action.cancel'),closeSheet),submit));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const data=Object.fromEntries(Object.entries(controls).map(([key,c])=>[key,c.value()]));
    const checked=runCommand(emptyDocument(),'addPerson',{person:data});
    if(!checked.ok){error.replaceChildren(el('p',{class:'notice error',text:checked.issues.map(i=>t('error.'+i.code)).join(' / ')}));return;}
    const normalized={...checked.document.persons[0]};delete normalized.id;
    if(subject?.personId){transact(command=>command('updatePerson',{personId:subject.personId,patch:normalized}),{focusId:subject.personId});return;}
    const draftKey=subject?.draftKey??'draft-'+state.nextDraft++;
    state.drafts.set(draftKey,normalized);closeSheet();render();
    if(onSaved)onSaved({draftKey});else startPlacement({draftKey});
  });
  showSheet(t(subject?'action.edit':'action.addPerson'),form);
}

function confirmAction(title,text,onConfirm) {
  showSheet(title,el('div',{},el('p',{class:'notice',text}),actionRow(button(t('action.cancel'),closeSheet),button(t('action.delete'),onConfirm,'danger'))));
}
function confirmDeletePerson(id) {
  const p=person(id);
  const text=t('confirm.deletePerson',{name:displayName(p),families:partners(id).length,count:parents(id).length});
  confirmAction(t('action.delete'),text,()=>transact(command=>command('deletePerson',{personId:id}),{message:'label.removed'}));
}
function openRelations(id) {
  const content=el('div');
  content.append(el('h3',{text:t('label.parentFamilies')}));
  for(const c of parents(id))content.append(el('div',{class:'relation-block'},
    button(familyName(family(c.family_id)),()=>openFamily(c.family_id)),
    el('div',{class:'relation-row'},el('span',{text:relationText(c.relation_type)}),button(t('action.edit'),()=>editRelation(c.id)),button(t('action.unlink'),()=>transact(command=>command('removeChildLink',{childLinkId:c.id}),{message:'label.removed',after:()=>openRelations(id)}),'danger'))));
  if(!parents(id).length)content.append(el('p',{class:'muted',text:t('label.none')}));
  content.append(el('h3',{text:t('label.partnerFamilies')}));
  for(const f of partners(id))content.append(el('div',{class:'relation-block'},button(familyName(f),()=>openFamily(f.id))));
  if(!partners(id).length)content.append(el('p',{class:'muted',text:t('label.none')}));
  showSheet(displayName(person(id))+' · '+t('action.relations'),content);
}
function relationText(value) {
  if(value===null)return t('label.unknown');
  return ['biological','adopted','step','foster'].includes(value)?t('relation.'+value):value;
}
function editRelation(id) {
  const link=state.document.family_children.find(c=>c.id===id);if(!link)return;
  const control=selectControl(['biological','adopted','step','foster'],'relation',link.relation_type);
  showSheet(t('label.relationType'),el('div',{},control.wrap,actionRow(button(t('action.cancel'),closeSheet),button(t('action.save'),()=>transact(command=>command('updateChildRelation',{childLinkId:id,relationType:control.value()})),'primary'))));
}
function openFamily(id) {
  const f=family(id);if(!f)return;
  document.querySelectorAll('.relation-line').forEach(line=>line.classList.toggle('selected',Number(line.dataset.familyId)===id));
  const content=el('div');
  const controls=selectControl(['married','divorced','separated','unmarried','widowed'],'marital',f.marital_status);
  content.append(el('label',{class:'field'},el('span',{text:t('label.maritalStatus')}),controls.wrap),actionRow(button(t('action.save'),()=>transact(command=>command('updateFamilyStatus',{familyId:id,status:controls.value()}),{after:()=>openFamily(id)}))));
  for(const slot of ['partner1_id','partner2_id']) {
    const p=f[slot]===null?null:person(f[slot]);
    content.append(el('div',{class:'relation-row'},el('span',{text:p?displayName(p):t('label.emptyPartnerSlot')}),p?
      button(t('action.unlink'),()=>transact(command=>command('setFamilyPartner',{familyId:id,slot,personId:null}),{after:()=>openFamily(id)}),'danger'):
      button(t('action.addParent'),()=>showPersonChooser(t('label.selectPerson'),subject=>transact(command=>{const personId=promote(subject,command);command('setFamilyPartner',{familyId:id,slot,personId});},{removeDrafts:draftKeys([subject]),after:()=>openFamily(id)})))));
  }
  content.append(el('h3',{text:t('label.children')}));
  for(const c of links(id))content.append(el('div',{class:'relation-row'},el('span',{text:c.sort_order+'. '+displayName(person(c.child_id))+' · '+relationText(c.relation_type)}),button(t('action.edit'),()=>editRelation(c.id)),button(t('action.unlink'),()=>transact(command=>command('removeChildLink',{childLinkId:c.id}),{after:()=>openFamily(id)}),'danger')));
  content.append(button(t('action.addChild'),()=>showPersonChooser(t('label.selectPerson'),subject=>choosePosition(id,before=>transact(command=>{const childId=promote(subject,command);command('addChild',{familyId:id,childId,beforeChildLinkId:before,relationType:null});},{removeDrafts:draftKeys([subject]),after:()=>openFamily(id)})))));
  content.append(actionRow(button(t('action.delete'),()=>confirmAction(t('action.delete'),t('confirm.deleteFamily',{id,count:links(id).length}),()=>transact(command=>command('deleteFamily',{familyId:id}),{message:'label.removed'})),'danger')));
  showSheet(t('label.family',{id}),content);
}

async function importFile(file) {
  if(!file)return;
  const token=++readToken;
  const result=await readFamilyFile(file);
  if(token!==readToken)return;
  if(!result.ok){if(!state.ready){state.ready=true;render();}showIssues(result.issues);return;}
  replaceDocument(result.document,result.issues??[]);
}
function replaceDocument(next,warnings=[]) {
  closeSheet();state.document=next;state.drafts.clear();state.mode=null;state.selected=null;state.query='';state.ready=true;
  document.getElementById('roster-search').value='';
  setView('tree');render({fit:true,preserve:false});
  toast(t('notice.loaded',{persons:next.persons.length,families:next.families.length})+(warnings.length?' · '+t('label.importWarnings')+' '+warnings.length+': '+[...new Set(warnings.map(w=>t('error.'+w.code)))].slice(0,3).join(' / '):''));
}
async function startSample() {
  const token=++readToken;
  document.getElementById('loading').hidden=false;
  const result=await readSample();
  if(token!==readToken)return;
  if(result.ok){replaceDocument(result.document,result.issues??[]);return;}
  state.ready=true;render();
  showSheet(t('label.sampleError'),el('div',{},el('p',{class:'notice error',text:t('label.sampleError')}),el('div',{class:'menu-list'},
    button(t('action.retry'),()=>{closeSheet();startSample();},'primary'),
    button(t('action.import'),()=>document.getElementById('file-input').click()),
    button(t('action.startEmpty'),()=>{++readToken;replaceDocument(emptyDocument());}))));
}

function help() {
  showSheet(t('help.title'),el('div',{class:'help-copy'},el('p',{text:t('help.body')}),el('p',{text:t('help.storage')}),el('p',{text:t('help.exceptions')})));
}

$(document).on('click','[data-person-id]',function(){openPerson(Number(this.dataset.personId));});
$(document).on('click','button.family-anchor',function(){openFamily(Number(this.dataset.familyId));});
$(document).on('click','[data-candidate-key]',function(){const c=candidates.find(c=>c.key===this.dataset.candidateKey);if(c)applyCandidate(c);});
$(document).on('click','[data-view]',function(){setView(this.dataset.view);});
$('#add-button, #empty-add').on('click',()=>openPersonForm());
$('#import-button').on('click',()=>document.getElementById('file-input').click());
$('#file-input').on('change',function(){const file=this.files[0];this.value='';importFile(file);});
$('#export-button').on('click',()=>{
  const result=downloadDocument(state.document);
  if(!result.ok){showIssues(result.issues);return;}
  toast(state.drafts.size?t('notice.draftsExcluded',{count:state.drafts.size}):t('label.saved'));
});
$('#zoom-in').on('click',()=>viewport.zoomBy(1.25));
$('#zoom-out').on('click',()=>viewport.zoomBy(.8));
$('#fit-button').on('click',()=>viewport.fit(geometry.bounds));
$('#cancel-mode').on('click',()=>{state.mode=null;render();});
$('#target-list').on('click',showCandidateList);
$('#place-root').on('click',()=>{const root=candidates.find(c=>c.kind==='root');if(root)applyCandidate(root);});
$('#sheet-close').on('click',closeSheet);
$('#help-button').on('click',help);
$('#roster-search').on('input',function(){state.query=this.value;renderRoster(state.document,state.drafts,state.query,openPerson,openDraft);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('sheet').open){state.mode=null;render();}});
document.getElementById('sheet').addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSheet();}});
$('#language').on('change',async function(){
  try{await loadLanguage(this.value);}catch{toast(t('error.GENERIC'));}
  this.value=getLanguage();closeSheet();translateStatic();setView(state.view);render();
});
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>render(),100);});

try {
  await loadLanguage(initialLanguage());
  document.getElementById('language').value=getLanguage();translateStatic();render({preserve:false});await startSample();
}catch {
  document.getElementById('loading').textContent='Unable to load local application files. Serve the repository over HTTP and retry.';
}
