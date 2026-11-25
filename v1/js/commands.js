import { PERSON_FIELDS, blankPerson } from './model.js';
import { validateDocument } from './validation.js';

const error = (code, path, params = {}) => ({ ok: false, issues: [{ code, path, severity: 'error', params }] });
const clone = document => structuredClone(document);
class CommandError extends Error {
  constructor(code, path) { super(code); this.code = code; this.path = path; }
}

/** Every command returns a new validated document. The caller commits only complete UI transactions. */
export function runCommand(document, type, args = {}) {
  const candidate = clone(document), result = {};
  const fail = (code, path) => { throw new CommandError(code, path); };
  const row = (table, key, value) => {
    const found = candidate[table].find(item => item[key] === value);
    if (!found) fail('REFERENCE_NOT_FOUND', `${table}.${key}`);
    return found;
  };
  const issueId = table => {
    const value = candidate.auto_increment[table];
    if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail('LIMIT_EXCEEDED', `auto_increment.${table}`);
    candidate.auto_increment[table]++;
    return value;
  };
  const reindex = familyId => candidate.family_children.filter(c => c.family_id === familyId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    .forEach((c, index) => { c.sort_order = index + 1; });
  const insert = (link, familyId, beforeId = null) => {
    row('families', 'id', familyId);
    if (beforeId === link.id && link.family_id === familyId) return;
    const previousFamily = link.family_id;
    const list = candidate.family_children.filter(c => c.family_id === familyId && c.id !== link.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const index = beforeId === null ? list.length : list.findIndex(c => c.id === beforeId);
    if (index < 0) fail('REFERENCE_NOT_FOUND', 'beforeChildLinkId');
    link.family_id = familyId;
    list.splice(index, 0, link);
    list.forEach((c, i) => { c.sort_order = i + 1; });
    if (previousFamily !== familyId) reindex(previousFamily);
  };
  const addChild = ({ familyId, childId, beforeChildLinkId = null, relationType = null }) => {
    row('families', 'id', familyId); row('persons', 'id', childId);
    if (candidate.family_children.some(c => c.family_id === familyId && c.child_id === childId)) fail('DUPLICATE_CHILD', 'family_children');
    const link = { id: issueId('family_children'), family_id: familyId, child_id: childId, sort_order: Number.MAX_SAFE_INTEGER, relation_type: relationType };
    candidate.family_children.push(link);
    insert(link, familyId, beforeChildLinkId);
    result.childLinkId = link.id;
  };
  try {
    switch (type) {
      case 'addPerson': {
        const person = args.person ?? {};
        if (person === null || typeof person !== 'object' || Array.isArray(person)) fail('INVALID_TYPE', 'person');
        for (const key of Object.keys(person)) if (!PERSON_FIELDS.includes(key)) fail('UNKNOWN_FIELD', `person.${key}`);
        const personId = issueId('persons');
        candidate.persons.push({ id: personId, ...blankPerson(), ...person });
        result.personId = personId;
        break;
      }
      case 'updatePerson': {
        const target = row('persons', 'id', args.personId);
        if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) fail('INVALID_TYPE', 'patch');
        for (const key of Object.keys(args.patch)) {
          if (!PERSON_FIELDS.includes(key)) fail('UNKNOWN_FIELD', `patch.${key}`);
          target[key] = args.patch[key];
        }
        result.personId = target.id;
        break;
      }
      case 'deletePerson': {
        row('persons', 'id', args.personId);
        candidate.persons = candidate.persons.filter(p => p.id !== args.personId);
        for (const family of candidate.families) for (const slot of ['partner1_id', 'partner2_id']) if (family[slot] === args.personId) family[slot] = null;
        const affected = new Set(candidate.family_children.filter(c => c.child_id === args.personId).map(c => c.family_id));
        candidate.family_children = candidate.family_children.filter(c => c.child_id !== args.personId);
        for (const familyId of affected) reindex(familyId);
        break;
      }
      case 'createFamily': {
        const familyId = issueId('families');
        candidate.families.push({ id: familyId, partner1_id: args.partner1Id ?? null, partner2_id: args.partner2Id ?? null, marital_status: args.status ?? null });
        result.familyId = familyId;
        break;
      }
      case 'setFamilyPartner': {
        const target = row('families', 'id', args.familyId);
        if (!['partner1_id', 'partner2_id'].includes(args.slot)) fail('INVALID_TYPE', 'slot');
        if (args.personId !== null) row('persons', 'id', args.personId);
        if (target[args.slot] !== null && args.personId !== null && target[args.slot] !== args.personId) fail('PARTNER_SLOT_OCCUPIED', `families.${args.slot}`);
        target[args.slot] = args.personId;
        result.familyId = target.id;
        break;
      }
      case 'updateFamilyStatus': row('families', 'id', args.familyId).marital_status = args.status; break;
      case 'addChild': addChild(args); break;
      case 'moveChildByPerson': {
        row('persons', 'id', args.personId); row('families', 'id', args.familyId);
        const links = candidate.family_children.filter(c => c.child_id === args.personId);
        const existing = links.find(c => c.family_id === args.familyId);
        if (existing) { insert(existing, args.familyId, args.beforeChildLinkId ?? null); result.childLinkId = existing.id; }
        else if (links.length === 1) { insert(links[0], args.familyId, args.beforeChildLinkId ?? null); result.childLinkId = links[0].id; }
        else addChild({ familyId: args.familyId, childId: args.personId, beforeChildLinkId: args.beforeChildLinkId ?? null });
        break;
      }
      case 'reorderChild': {
        const target = row('family_children', 'id', args.childLinkId);
        insert(target, target.family_id, args.beforeChildLinkId ?? null);
        result.childLinkId = target.id;
        break;
      }
      case 'updateChildRelation': row('family_children', 'id', args.childLinkId).relation_type = args.relationType; break;
      case 'removeChildLink': {
        const target = row('family_children', 'id', args.childLinkId);
        candidate.family_children = candidate.family_children.filter(c => c.id !== target.id);
        reindex(target.family_id);
        break;
      }
      case 'deleteFamily': {
        row('families', 'id', args.familyId);
        candidate.families = candidate.families.filter(f => f.id !== args.familyId);
        candidate.family_children = candidate.family_children.filter(c => c.family_id !== args.familyId);
        break;
      }
      default: return error('UNKNOWN_COMMAND', 'command');
    }
  } catch (problem) {
    if (problem instanceof CommandError) return error(problem.code, problem.path);
    throw problem;
  }
  const checked = validateDocument(candidate);
  return checked.ok ? { ...checked, ...result } : checked;
}
