export const supportedLanguages = ['ja', 'en', 'vi'];
const dictionaries = new Map();
let language = 'ja';
let languageRequest = 0;

export function initialLanguage() {
  const languages = globalThis.navigator?.languages || [globalThis.navigator?.language || 'ja'];
  for (const candidate of languages) {
    const primary = String(candidate).toLowerCase().split('-')[0];
    if (supportedLanguages.includes(primary)) return primary;
  }
  return 'ja';
}

async function fetchDictionary(code) {
  if (!dictionaries.has(code)) {
    const response = await fetch(new URL(`../locales/${code}.json`, import.meta.url));
    if (!response.ok) throw new Error(`Language dictionary unavailable: ${code}`);
    const dictionary = await response.json();
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) throw new Error('Invalid language dictionary');
    dictionaries.set(code, dictionary);
  }
  return dictionaries.get(code);
}

export async function loadLanguage(code) {
  const chosen = supportedLanguages.includes(code) ? code : 'ja';
  const request = ++languageRequest;
  await fetchDictionary('ja');
  try { await fetchDictionary(chosen); }
  catch (error) {
    if (request === languageRequest) language = 'ja';
    throw error;
  }
  if (request === languageRequest) language = chosen;
  return language;
}

export function getLanguage() { return language; }

export function t(key, params = {}) {
  const text = dictionaries.get(language)?.[key] ?? dictionaries.get('ja')?.[key] ?? key;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

/** Format integer partial dates without inventing an unknown month or day. */
export function formatPartialDate(value) {
  if (value === null || value === undefined) return t('label.unknown');
  const year = Math.floor(value / 10000);
  const month = Math.floor(value / 100) % 100;
  const day = value % 100;
  if (language === 'ja') return `${year}年${month ? `${month}月` : ''}${day ? `${day}日` : ''}`;
  if (language === 'vi') return day ? `${day}/${month}/${year}` : month ? `Tháng ${month}/${year}` : String(year);
  const yearText = String(year).padStart(4, '0');
  return `${yearText}${month ? `-${String(month).padStart(2, '0')}` : ''}${day ? `-${String(day).padStart(2, '0')}` : ''}`;
}
