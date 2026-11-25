import {el,button} from './ui.js';
import {t,formatPartialDate} from './i18n.js';
export const displayName=p=>p.name||p.nickname||(t('label.unnamed')+(p.id?' #'+p.id:''));
const initial=p=>Array.from(displayName(p)).slice(0,1).join('');
const subtitle=p=>p.birth_date?formatPartialDate(p.birth_date):p.residence||p.nickname||'—';
export function renderTree(document,geometry,selectedPersonId,candidates=[]) {
  const people=new Map(document.persons.map(p=>[p.id,p]));
  const cards=window.document.getElementById('cards');
  const fragment=window.document.createDocumentFragment();
  for(const n of geometry.nodes) {
    const p=people.get(n.personId);
    const node=el('button',{type:'button',class:'person-card'+(p.is_alive===false?' deceased':'')+(p.id===selectedPersonId?' selected':''),'data-person-id':p.id,'aria-label':displayName(p)});
    Object.assign(node.style,{left:n.x+'px',top:n.y+'px',width:n.width+'px',height:n.height+'px'});
    node.append(el('span',{class:'avatar','aria-hidden':'true',text:initial(p)}),el('span',{class:'person-text'},el('span',{class:'person-name',text:displayName(p)}),el('span',{class:'person-meta',text:subtitle(p)})),el('span',{class:'person-id',text:'#'+p.id}));
    fragment.append(node);
  }
  cards.replaceChildren(fragment);
  const svg=window.document.getElementById('relations');
  svg.setAttribute('width',geometry.bounds.width);
  svg.setAttribute('height',geometry.bounds.height);
  const lines=window.document.createDocumentFragment();
  for(const e of geometry.edges) {
    if(!e.points?.length)continue;
    const path=window.document.createElementNS('http://www.w3.org/2000/svg','polyline');
    path.setAttribute('points',e.points.map(p=>p.x+','+p.y).join(' '));
    path.setAttribute('class','relation-line'+(e.relationType==='adopted'?' adopted':''));
    path.setAttribute('data-family-id',e.familyId);
    if(e.childLinkId)path.setAttribute('data-child-link-id',e.childLinkId);
    lines.append(path);
  }
  svg.replaceChildren(lines);
  const fams=window.document.getElementById('family-anchors');
  fams.replaceChildren(...geometry.families.map(f=>{
    const b=el('button',{type:'button',class:'family-anchor','data-family-id':f.familyId,text:'F'+f.familyId,title:t('label.family',{id:f.familyId}),'aria-label':t('label.family',{id:f.familyId})});
    Object.assign(b.style,{left:f.x+'px',top:f.y+'px'});return b;
  }));
  window.document.getElementById('placement-targets').replaceChildren(...candidates.filter(c=>c.position).map(c=>{
    const b=el('button',{type:'button',class:'placement-target','data-candidate-key':c.key,title:c.label,'aria-label':c.label,text:'＋'});
    Object.assign(b.style,{left:c.position.x+'px',top:c.position.y+'px'});return b;
  }));
  const world=window.document.getElementById('world');
  world.style.width=geometry.bounds.width+'px';world.style.height=geometry.bounds.height+'px';
}
export function renderRoster(document,drafts,query,onPerson,onDraft) {
  const fragment=window.document.createDocumentFragment();
  const q=query.toLocaleLowerCase();
  const filtered=p=>!q||[p.name,p.nickname].some(s=>s?.toLocaleLowerCase().includes(q));
  function section(label,entries,handler,isDraft) {
    if(!entries.length)return;
    const wrap=el('section',{class:'roster-section'},el('h3',{text:label+' · '+entries.length}));
    const grid=el('div',{class:'roster-grid'});
    for(const [key,p]of entries) {
      const b=button('',()=>handler(key),'roster-person');
      b.append(el('span',{class:'avatar','aria-hidden':'true',text:initial(p)}),el('span',{},el('strong',{text:displayName(p)}),el('small',{text:subtitle(p)})),el('span',{text:isDraft?t('label.unplaced'):'#'+p.id}));
      grid.append(b);
    }
    wrap.append(grid);fragment.append(wrap);
  }
  section(t('label.drafts'),[...drafts].filter(([,p])=>filtered(p)),onDraft,true);
  section(t('label.placed'),document.persons.filter(filtered).sort((a,b)=>a.id-b.id).map(p=>[p.id,p]),onPerson,false);
  if(!fragment.childNodes.length)fragment.append(el('p',{class:'notice',text:t('label.noResults')}));
  window.document.getElementById('roster-content').replaceChildren(fragment);
}
