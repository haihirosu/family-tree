import {t} from './i18n.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  node.append(...children.filter(x => x != null).map(x => typeof x === 'string' ? document.createTextNode(x) : x));
  return node;
}
export function button(label, onClick, className = '') {
  return el('button', {type:'button',class:className,text:label,onClick});
}
let lastFocus;
export function showSheet(title,content) {
  const sheet = document.getElementById('sheet');
  if (!sheet.open) lastFocus = document.activeElement;
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-body').replaceChildren(content);
  if (!sheet.open) sheet.showModal();
}
export function closeSheet() {
  const sheet = document.getElementById('sheet');
  if (sheet.open) sheet.close();
  if (lastFocus?.isConnected) lastFocus.focus({preventScroll:true});
}
let toastTimer;
export function toast(message) {
  const node = document.getElementById('toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 5500);
}
export function translateStatic() {
  document.documentElement.lang = document.getElementById('language').value;
  document.getElementById('language').setAttribute('aria-label',t('label.language'));
  document.querySelector('.view-tabs').setAttribute('aria-label',t('nav.tree')+' / '+t('nav.roster'));
  document.getElementById('tree-view').setAttribute('aria-label',t('nav.tree'));
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
    node.setAttribute('aria-label',node.title);
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
    node.setAttribute('aria-label',node.placeholder);
  }
}
export function showIssues(issues = []) {
  const wrap = el('div');
  wrap.append(el('p',{class:'notice error',text:t('label.documentError')}));
  const list=el('ul');
  for(const issue of issues.slice(0,50)) {
    const key='error.'+issue.code;
    const translated=t(key,issue.params??{});
    list.append(el('li',{text:(translated===key?t('error.GENERIC'):translated)+(issue.path?' · '+issue.path:'')}));
  }
  if(issues.length>50)list.append(el('li',{text:'… '+(issues.length-50)}));
  wrap.append(list,button(t('action.close'),closeSheet,'primary'));
  showSheet(t('label.documentError'),wrap);
}
