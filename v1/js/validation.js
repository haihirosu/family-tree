import { PERSON_FIELDS, TABLES, LIMITS, emptyDocument } from './model.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
export const daysInMonth = (year, month) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

/** Return exact representable bounds without Date's special treatment of years 0–99. */
export function partialDateBounds(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const year = Math.floor(value / 10000), month = Math.floor(value / 100) % 100, day = value % 100;
  if (year < 1 || year > 9999 || month < 0 || month > 12 || day < 0) return null;
  if (month === 0) return day === 0 ? { min: year * 10000 + 101, max: year * 10000 + 1231 } : null;
  if (day > daysInMonth(year, month)) return null;
  return day === 0
    ? { min: year * 10000 + month * 100 + 1, max: year * 10000 + month * 100 + daysInMonth(year, month) }
    : { min: value, max: value };
}

export function validateDocument(input) {
  const issues = [];
  const issue = (code, path, severity = 'error', params = {}) => issues.push({ code, path, severity, params });
  const unknown = (obj, fields, path) => {
    for (const key of Object.keys(obj)) if (!fields.includes(key)) issue('UNKNOWN_FIELD', path ? `${path}.${key}` : key);
  };
  if (!record(input)) return { ok: false, issues: [{ code: 'INVALID_TYPE', path: '', severity: 'error', params: {} }] };
  unknown(input, ['schema_version', 'auto_increment', ...TABLES], '');
  if (input.schema_version !== 1) issue('INVALID_SCHEMA_VERSION', 'schema_version');
  if (!record(input.auto_increment)) issue('INVALID_TYPE', 'auto_increment');
  else {
    unknown(input.auto_increment, TABLES, 'auto_increment');
    for (const table of TABLES) if (!id(input.auto_increment[table])) issue('INVALID_TYPE', `auto_increment.${table}`);
  }
  for (const table of TABLES) {
    if (!Array.isArray(input[table])) issue('INVALID_TYPE', table);
    else if (input[table].length > LIMITS[table]) issue('LIMIT_EXCEEDED', table, 'error', { limit: LIMITS[table] });
  }
  if (issues.some(x => x.severity === 'error')) return { ok: false, issues };
  const doc = emptyDocument();
  doc.auto_increment = { ...input.auto_increment };
  const seen = Object.fromEntries(TABLES.map(t => [t, new Set()]));
  const text = (value, path, max) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') { issue('INVALID_TYPE', path); return null; }
    const normalized = value.trim();
    if (normalized.length > max) issue('LIMIT_EXCEEDED', path, 'error', { limit: max });
    return normalized || null;
  };
  const nullableId = (value, path) => {
    if (value === undefined || value === null) return null;
    if (!id(value)) issue('INVALID_TYPE', path);
    return value;
  };
  const requiredId = (value, path) => { if (!id(value)) issue('INVALID_TYPE', path); return value; };
  for (const table of TABLES) {
    input[table].forEach((source, index) => {
      const path = `${table}[${index}]`;
      if (!record(source)) { issue('INVALID_TYPE', path); return; }
      const fields = table === 'persons' ? ['id', ...PERSON_FIELDS]
        : table === 'families' ? ['id', 'partner1_id', 'partner2_id', 'marital_status']
          : ['id', 'family_id', 'child_id', 'sort_order', 'relation_type'];
      unknown(source, fields, path);
      const target = { id: requiredId(source.id, `${path}.id`) };
      if (seen[table].has(source.id)) issue('DUPLICATE_ID', `${path}.id`);
      seen[table].add(source.id);
      if (table === 'persons') {
        for (const field of PERSON_FIELDS) {
          const value = own(source, field) ? source[field] : null;
          if (field === 'birth_date' || field === 'death_date') {
            target[field] = value;
            if (value !== null && !partialDateBounds(value)) issue('INVALID_PARTIAL_DATE', `${path}.${field}`);
          } else if (field === 'is_alive') {
            target[field] = value;
            if (value !== null && typeof value !== 'boolean') issue('INVALID_TYPE', `${path}.${field}`);
          } else target[field] = text(value, `${path}.${field}`, field === 'notes' ? LIMITS.notes : field === 'gender' ? LIMITS.code : LIMITS.text);
        }
        if (target.is_alive === true && target.death_date !== null) issue('LIFE_STATUS_CONFLICT', `${path}.death_date`);
        const birth = partialDateBounds(target.birth_date), death = partialDateBounds(target.death_date);
        if (birth && death && birth.min > death.max) issue('LIFE_STATUS_CONFLICT', `${path}.death_date`);
      } else if (table === 'families') {
        target.partner1_id = nullableId(source.partner1_id, `${path}.partner1_id`);
        target.partner2_id = nullableId(source.partner2_id, `${path}.partner2_id`);
        target.marital_status = text(source.marital_status, `${path}.marital_status`, LIMITS.code);
      } else {
        target.family_id = requiredId(source.family_id, `${path}.family_id`);
        target.child_id = requiredId(source.child_id, `${path}.child_id`);
        target.sort_order = requiredId(source.sort_order, `${path}.sort_order`);
        target.relation_type = text(source.relation_type, `${path}.relation_type`, LIMITS.code);
      }
      doc[table].push(target);
    });
  }
  if (issues.some(x => x.severity === 'error')) return { ok: false, issues };
  const families = new Map(doc.families.map(f => [f.id, f]));
  const partnerPairs = new Set(), childPairs = new Set();
  doc.families.forEach((f, index) => {
    const path = `families[${index}]`;
    for (const field of ['partner1_id', 'partner2_id']) {
      if (f[field] !== null && !seen.persons.has(f[field])) issue('REFERENCE_NOT_FOUND', `${path}.${field}`);
    }
    if (f.partner1_id !== null && f.partner1_id === f.partner2_id) issue('SELF_PARTNER', path);
    if (f.partner1_id !== null && f.partner2_id !== null) {
      const pair = [f.partner1_id, f.partner2_id].sort((a, b) => a - b).join(':');
      if (partnerPairs.has(pair)) issue('DUPLICATE_PARTNER_PAIR', path);
      partnerPairs.add(pair);
    }
  });
  doc.family_children.forEach((c, index) => {
    const path = `family_children[${index}]`;
    if (!seen.families.has(c.family_id)) issue('REFERENCE_NOT_FOUND', `${path}.family_id`);
    if (!seen.persons.has(c.child_id)) issue('REFERENCE_NOT_FOUND', `${path}.child_id`);
    const pair = `${c.family_id}:${c.child_id}`;
    if (childPairs.has(pair)) issue('DUPLICATE_CHILD', path);
    childPairs.add(pair);
    const family = families.get(c.family_id);
    if (family && [family.partner1_id, family.partner2_id].includes(c.child_id)) issue('SELF_PARENT', path);
  });
  if (issues.some(x => x.severity === 'error')) return { ok: false, issues };
  // Sets preserve independent family edges without duplicate indegree increments.
  const next = new Map(doc.persons.map(p => [p.id, new Set()]));
  const indegree = new Map(doc.persons.map(p => [p.id, 0]));
  for (const child of doc.family_children) {
    const family = families.get(child.family_id);
    for (const parent of [family.partner1_id, family.partner2_id]) {
      if (parent !== null && !next.get(parent).has(child.child_id)) {
        next.get(parent).add(child.child_id);
        indegree.set(child.child_id, indegree.get(child.child_id) + 1);
      }
    }
  }
  const queue = doc.persons.filter(p => indegree.get(p.id) === 0).map(p => p.id);
  for (let q = 0; q < queue.length; q++) for (const child of next.get(queue[q])) {
    indegree.set(child, indegree.get(child) - 1);
    if (indegree.get(child) === 0) queue.push(child);
  }
  if (queue.length !== doc.persons.length) issue('ANCESTRY_CYCLE', 'family_children');
  for (const table of TABLES) {
    const maxId = doc[table].reduce((max, row) => Math.max(max, row.id), 0);
    if (maxId >= Number.MAX_SAFE_INTEGER) issue('LIMIT_EXCEEDED', `auto_increment.${table}`);
    else if (doc.auto_increment[table] <= maxId) {
      doc.auto_increment[table] = maxId + 1;
      issue('COUNTER_NORMALIZED', `auto_increment.${table}`, 'warning');
    }
  }
  const groups = new Map();
  for (const child of doc.family_children) {
    if (!groups.has(child.family_id)) groups.set(child.family_id, []);
    groups.get(child.family_id).push(child);
  }
  for (const [familyId, children] of groups) {
    children.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    let changed = false;
    children.forEach((child, index) => { changed ||= child.sort_order !== index + 1; child.sort_order = index + 1; });
    if (changed) issue('ORDER_NORMALIZED', 'family_children', 'warning', { familyId });
  }
  doc.persons.sort((a, b) => a.id - b.id);
  doc.families.sort((a, b) => a.id - b.id);
  doc.family_children.sort((a, b) => a.family_id - b.family_id || a.sort_order - b.sort_order || a.id - b.id);
  return issues.some(x => x.severity === 'error') ? { ok: false, issues } : { ok: true, document: doc, issues };
}
