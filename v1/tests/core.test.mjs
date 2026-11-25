import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDocument, blankPerson } from '../js/model.js';
import { validateDocument, partialDateBounds } from '../js/validation.js';
import { runCommand } from '../js/commands.js';
import { layout } from '../js/layout.js';

function fixture(people = 6, families = 3) {
  const d = emptyDocument();
  d.persons = Array.from({ length: people }, (_, i) => ({ id: i + 1, ...blankPerson(), name: `架空${i + 1}` }));
  d.families = Array.from({ length: families }, (_, i) => ({ id: i + 1, partner1_id: null, partner2_id: null, marital_status: null }));
  d.auto_increment.persons = people + 1; d.auto_increment.families = families + 1;
  return d;
}
function command(d, type, args) {
  const result = runCommand(d, type, args);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result;
}
function link(d, familyId, childId, relationType = null, beforeChildLinkId = null) {
  return command(d, 'addChild', { familyId, childId, relationType, beforeChildLinkId }).document;
}
const issues = value => value.issues.map(i => i.code);

test('empty document and fully unknown person are valid', () => {
  assert.equal(validateDocument(emptyDocument()).ok, true);
  const added = command(emptyDocument(), 'addPerson', { person: {} });
  assert.equal(added.personId, 1); assert.equal(added.document.persons[0].name, null);
  assert.equal(added.document.auto_increment.persons, 2);
});

test('only permitted null fields, whitespace and order/counter are normalized', () => {
  const d = fixture(3, 1);
  d.persons = [{ id: 1, name: '  仮 名  ', gender: '  自由値  ' }, { id: 2 }, { id: 3, notes: 'a\nb' }];
  d.auto_increment.persons = 1; d.auto_increment.family_children = 1;
  d.family_children = [
    { id: 2, family_id: 1, child_id: 2, sort_order: 8 },
    { id: 1, family_id: 1, child_id: 3, sort_order: 8 },
  ];
  const before = structuredClone(d), v = validateDocument(d);
  assert.equal(v.ok, true); assert.deepEqual(d, before);
  assert.equal(v.document.persons[0].name, '仮 名'); assert.equal(v.document.persons[0].gender, '自由値');
  assert.equal(v.document.persons[1].is_alive, null); assert.equal(v.document.persons[2].notes, 'a\nb');
  assert.deepEqual(v.document.family_children.map(c => [c.id, c.sort_order]), [[1, 1], [2, 2]]);
  assert.equal(v.document.auto_increment.persons, 4); assert.equal(v.document.auto_increment.family_children, 3);
  assert.ok(issues(v).includes('COUNTER_NORMALIZED')); assert.ok(issues(v).includes('ORDER_NORMALIZED'));
});

test('high counters survive empty tables and deletions; IDs are never reused', () => {
  let d = fixture(1, 0); d.auto_increment.persons = 40;
  d = command(d, 'deletePerson', { personId: 1 }).document;
  const next = command(d, 'addPerson', { person: { name: '架空新規' } });
  assert.equal(next.personId, 40); assert.equal(next.document.auto_increment.persons, 41);
  assert.equal(validateDocument(next.document).document.auto_increment.persons, 41);
});

test('unknown fields, dangerous JSON keys and type coercions are rejected', () => {
  const cases = [
    d => { d.persons[0].is_placed = true; },
    d => { d.persons[0].is_alive = 1; },
    d => { d.persons[0].birth_date = '19800000'; },
    d => { d.auto_increment.persons = '10'; },
    d => { d.schema_version = '1'; },
    d => { d.auto_increment.extra = 2; },
    d => { d.persons[0].id = 1.2; },
    d => { d.persons[0].residence = {}; },
  ];
  for (const mutate of cases) { const d = fixture(); mutate(d); assert.equal(validateDocument(d).ok, false); }
  const json = JSON.parse(JSON.stringify(fixture()).replace('"schema_version":1', '"schema_version":1,"__proto__":{"polluted":true}'));
  assert.ok(issues(validateDocument(json)).includes('UNKNOWN_FIELD')); assert.equal({}.polluted, undefined);
});

test('unknown string values and Unicode names are preserved as text', () => {
  const d = fixture(1, 1); d.persons[0].name = 'Nguyễn <script>alert(1)</script>';
  d.persons[0].gender = 'custom gender'; d.families[0].marital_status = 'custom status';
  const v = validateDocument(d); assert.equal(v.ok, true);
  assert.equal(v.document.persons[0].name, d.persons[0].name);
  assert.equal(v.document.persons[0].gender, 'custom gender');
});

test('partial dates handle year/month precision, leap years and years before 100', () => {
  for (const value of [19800000, 19800500, 19800521, 20000229, 10000, 990101]) assert.ok(partialDateBounds(value), value);
  for (const value of [0, -1, 19800015, 20230229, 19000229, 19801300, 19800431, 100000000, 12.5, '19800000']) assert.equal(partialDateBounds(value), null, String(value));
  assert.deepEqual(partialDateBounds(19800000), { min: 19800101, max: 19801231 });
  assert.deepEqual(partialDateBounds(20000200), { min: 20000201, max: 20000229 });
});

test('life status conflicts are rejected, uncertain chronology stays valid', () => {
  let d = fixture(1, 0); d.persons[0].is_alive = true; d.persons[0].death_date = 20000000;
  assert.ok(issues(validateDocument(d)).includes('LIFE_STATUS_CONFLICT'));
  d.persons[0].is_alive = null; d.persons[0].birth_date = 20001200;
  assert.equal(validateDocument(d).ok, true);
  d.persons[0].birth_date = 20010100;
  assert.equal(validateDocument(d).ok, false);
  d.persons[0].is_alive = false; d.persons[0].death_date = null;
  assert.equal(validateDocument(d).ok, true);
});

test('mandatory fields, duplicates, references and safety limits reject entire document', () => {
  const cases = [
    [d => delete d.auto_increment, 'INVALID_TYPE'],
    [d => d.persons.push(structuredClone(d.persons[0])), 'DUPLICATE_ID'],
    [d => { d.families[0].partner1_id = 900; }, 'REFERENCE_NOT_FOUND'],
    [d => { d.family_children = [{ id: 1, family_id: 1, child_id: 1 }]; }, 'INVALID_TYPE'],
    [d => { d.family_children = [{ id: 1, family_id: 1, child_id: 1, sort_order: 0 }]; }, 'INVALID_TYPE'],
    [d => { d.persons[0].id = Number.MAX_SAFE_INTEGER; }, 'LIMIT_EXCEEDED'],
    [d => { d.persons[0].name = 'x'.repeat(501); }, 'LIMIT_EXCEEDED'],
  ];
  for (const [mutate, code] of cases) { const d = fixture(); mutate(d); assert.ok(issues(validateDocument(d)).includes(code), code); }
  assert.ok(issues(validateDocument(fixture(2001, 0))).includes('LIMIT_EXCEEDED'));
});

test('move with zero parent links adds a child relation', () => {
  const before = fixture(), r = command(before, 'moveChildByPerson', { personId: 4, familyId: 1 });
  assert.equal(r.document.family_children.length, 1); assert.equal(r.childLinkId, 1);
  assert.equal(r.document.family_children[0].relation_type, null); assert.equal(before.family_children.length, 0);
});

test('move with one parent link retains link ID/type and renumbers both families', () => {
  let d = fixture(); d = link(d, 1, 3); d = link(d, 1, 4, 'adopted'); d = link(d, 1, 5); d = link(d, 2, 6);
  const moving = d.family_children.find(c => c.child_id === 4), beforeLink = d.family_children.find(c => c.child_id === 6);
  const beforeCounter = d.auto_increment.family_children;
  const r = command(d, 'moveChildByPerson', { personId: 4, familyId: 2, beforeChildLinkId: beforeLink.id });
  assert.equal(r.childLinkId, moving.id); assert.equal(r.document.auto_increment.family_children, beforeCounter);
  const moved = r.document.family_children.find(c => c.id === moving.id);
  assert.equal(moved.relation_type, 'adopted'); assert.equal(moved.family_id, 2);
  assert.deepEqual(r.document.family_children.filter(c => c.family_id === 1).map(c => [c.child_id, c.sort_order]), [[3, 1], [5, 2]]);
  assert.deepEqual(r.document.family_children.filter(c => c.family_id === 2).map(c => [c.child_id, c.sort_order]), [[4, 1], [6, 2]]);
});

test('move with two parent links preserves both and adds a new relation', () => {
  let d = link(link(fixture(), 1, 4, 'biological'), 2, 4, 'adopted');
  const oldLinks = structuredClone(d.family_children);
  const r = command(d, 'moveChildByPerson', { personId: 4, familyId: 3 });
  assert.equal(r.document.family_children.length, 3);
  for (const old of oldLinks) assert.deepEqual(r.document.family_children.find(c => c.id === old.id), old);
  assert.equal(r.document.family_children.find(c => c.id === r.childLinkId).relation_type, null);
});

test('same-family move changes sort only, even with several parent families', () => {
  let d = link(link(link(fixture(), 1, 3), 1, 4), 2, 4);
  const first = d.family_children.find(c => c.family_id === 1 && c.child_id === 3);
  const counter = d.auto_increment.family_children;
  const r = command(d, 'moveChildByPerson', { personId: 4, familyId: 1, beforeChildLinkId: first.id });
  assert.equal(r.document.family_children.length, 3); assert.equal(r.document.auto_increment.family_children, counter);
  assert.deepEqual(r.document.family_children.filter(c => c.family_id === 1).map(c => c.child_id), [4, 3]);
});

test('explicit child connection always preserves an existing parent family', () => {
  let d = link(fixture(), 1, 4);
  const r = command(d, 'addChild', { familyId: 2, childId: 4, relationType: 'adopted' });
  assert.deepEqual(r.document.family_children.map(c => c.family_id), [1, 2]);
});

test('reordering to own position is a harmless no-op, others retain relative order', () => {
  let d = link(link(link(fixture(), 1, 3), 1, 4), 1, 5);
  const target = d.family_children.find(c => c.child_id === 3);
  assert.deepEqual(command(d, 'reorderChild', { childLinkId: target.id, beforeChildLinkId: target.id }).document, d);
  d = command(d, 'reorderChild', { childLinkId: target.id, beforeChildLinkId: null }).document;
  assert.deepEqual(d.family_children.map(c => c.child_id), [4, 5, 3]);
  assert.deepEqual(d.family_children.map(c => c.sort_order), [1, 2, 3]);
});

test('deleting person nulls partner slots and cascades only their child links', () => {
  let d = fixture(); d.families[0].partner1_id = 1; d.families[1].partner2_id = 1;
  d = link(link(link(d, 1, 4), 3, 1), 3, 5);
  const counts = structuredClone(d.auto_increment);
  const r = command(d, 'deletePerson', { personId: 1 });
  assert.equal(r.document.persons.length, 5); assert.equal(r.document.families.length, 3);
  assert.equal(r.document.families[0].partner1_id, null); assert.equal(r.document.families[1].partner2_id, null);
  assert.deepEqual(r.document.family_children.map(c => c.child_id), [4, 5]);
  assert.equal(r.document.family_children.find(c => c.family_id === 3).sort_order, 1);
  assert.deepEqual(r.document.auto_increment, counts);
});

test('family deletion keeps all persons; individual link removal preserves other families', () => {
  let d = link(link(link(fixture(), 1, 3), 1, 4), 2, 4);
  const linkId = d.family_children.find(c => c.family_id === 1 && c.child_id === 4).id;
  let r = command(d, 'removeChildLink', { childLinkId: linkId });
  assert.equal(r.document.family_children.filter(c => c.child_id === 4).length, 1);
  r = command(d, 'deleteFamily', { familyId: 1 });
  assert.equal(r.document.persons.length, 6); assert.equal(r.document.families.length, 2);
  assert.deepEqual(r.document.family_children.map(c => c.family_id), [2]);
});

test('duplicates and invalid operations are atomic including counters', () => {
  let d = fixture(); d.families[0].partner1_id = 1; d.families[0].partner2_id = 2;
  d = link(d, 1, 3); const before = structuredClone(d);
  for (const [type, args, code] of [
    ['createFamily', { partner1Id: 2, partner2Id: 1 }, 'DUPLICATE_PARTNER_PAIR'],
    ['createFamily', { partner1Id: 1, partner2Id: 1 }, 'SELF_PARTNER'],
    ['addChild', { familyId: 1, childId: 3 }, 'DUPLICATE_CHILD'],
    ['addChild', { familyId: 1, childId: 1 }, 'SELF_PARENT'],
    ['addChild', { familyId: 1, childId: 4, beforeChildLinkId: 999 }, 'REFERENCE_NOT_FOUND'],
    ['setFamilyPartner', { familyId: 1, slot: 'partner2_id', personId: 4 }, 'PARTNER_SLOT_OCCUPIED'],
    ['updatePerson', { personId: 1, patch: { id: 2 } }, 'UNKNOWN_FIELD'],
  ]) {
    const r = runCommand(d, type, args); assert.equal(r.ok, false); assert.ok(issues(r).includes(code), code); assert.deepEqual(d, before);
  }
});

test('adding child or filling a parent slot cannot introduce ancestor cycles', () => {
  let d = fixture(); d.families[0].partner1_id = 1; d.families[1].partner1_id = 2;
  d = link(d, 1, 2); const before = structuredClone(d);
  const r = runCommand(d, 'addChild', { familyId: 2, childId: 1 });
  assert.equal(r.ok, false); assert.ok(issues(r).includes('ANCESTRY_CYCLE')); assert.deepEqual(d, before);
  d = link(d, 3, 1);
  const fill = runCommand(d, 'setFamilyPartner', { familyId: 3, slot: 'partner1_id', personId: 2 });
  assert.equal(fill.ok, false); assert.ok(issues(fill).includes('ANCESTRY_CYCLE'));
});

test('counters never overflow the safe integer range', () => {
  const d = emptyDocument(); d.auto_increment.persons = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(d), r = runCommand(d, 'addPerson', { person: {} });
  assert.equal(r.ok, false); assert.deepEqual(d, before);
});

test('serialization roundtrip has stable canonical semantics and counters', () => {
  let d = link(link(fixture(), 1, 3, 'custom'), 2, 4); d.auto_increment.persons = 500;
  const once = validateDocument(d).document, twice = validateDocument(JSON.parse(JSON.stringify(once))).document;
  assert.deepEqual(once, twice);
});

function treeFixture() {
  let d = fixture(9, 4);
  d.families[0].partner1_id = 1; d.families[0].partner2_id = 2;
  d.families[1].partner1_id = 3; d.families[1].partner2_id = 4;
  d.families[2].partner1_id = 3; d.families[2].partner2_id = 5;
  d = link(link(link(link(d, 1, 3), 2, 6), 2, 7), 3, 8);
  return d;
}

test('layout is pure and deterministic, has one card per person, sibling order and ranks', () => {
  const d = treeFixture(), before = structuredClone(d), result = layout(d);
  assert.deepEqual(result.issues, []); assert.equal(result.nodes.length, d.persons.length);
  assert.equal(new Set(result.nodes.map(n => n.personId)).size, d.persons.length);
  const get = id => result.nodes.find(n => n.personId === id);
  assert.equal(get(1).y, get(2).y); assert.equal(get(3).y, get(4).y); assert.equal(get(3).y, get(5).y);
  assert.ok(get(3).y > get(1).y); assert.ok(get(6).y > get(3).y); assert.ok(get(6).x < get(7).x);
  assert.equal(result.families.length, d.families.length);
  assert.equal(result.edges.filter(e => e.kind === 'child').length, d.family_children.length);
  const shuffled = { ...d, persons: [...d.persons].reverse(), families: [...d.families].reverse(), family_children: [...d.family_children].reverse() };
  assert.deepEqual(layout(shuffled), result); assert.deepEqual(d, before);
});

test('layout card rectangles do not overlap and all segments avoid card interiors', () => {
  const result = layout(treeFixture());
  for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
    const a = result.nodes[i], b = result.nodes[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
  for (const edge of result.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i]; assert.ok(a.x === b.x || a.y === b.y);
    for (const n of result.nodes) {
      const verticalCollision = a.x === b.x && a.x > n.x && a.x < n.x + n.width && Math.max(a.y, b.y) > n.y && Math.min(a.y, b.y) < n.y + n.height;
      const horizontalCollision = a.y === b.y && a.y > n.y && a.y < n.y + n.height && Math.max(a.x, b.x) > n.x && Math.min(a.x, b.x) < n.x + n.width;
      assert.equal(verticalCollision || horizontalCollision, false, edge.edgeKey);
    }
  }
});

test('empty/unknown-parent families retain anchors and isolated people stay visible', () => {
  const d = fixture(2, 2), result = layout(d);
  assert.equal(result.nodes.length, 2); assert.equal(result.families.length, 2); assert.equal(result.components.length, 4);
  assert.ok(result.bounds.width > 0); assert.ok(result.bounds.height > 0);
  assert.deepEqual(layout(emptyDocument()).issues, []);
});

test('layout generation conflicts are distinct from valid genealogy validation', () => {
  let d = fixture(3, 3); d.families[0].partner1_id = 1; d.families[1].partner1_id = 2;
  d.families[2].partner1_id = 1; d.families[2].partner2_id = 3;
  d = link(link(d, 1, 2), 2, 3);
  assert.equal(validateDocument(d).ok, true);
  assert.ok(issues(layout(d)).includes('LAYOUT_GENERATION_CONFLICT'));
});

test('opposing sibling orders keep data intact and return a deferred layout error', () => {
  let d = fixture(2, 2); d = link(link(link(link(d, 1, 1), 1, 2), 2, 2), 2, 1);
  const before = structuredClone(d);
  assert.equal(validateDocument(d).ok, true); assert.ok(issues(layout(d)).includes('LAYOUT_ORDER_CONFLICT'));
  assert.deepEqual(d, before);
});

test('deep ancestry validation and layout do not rely on recursive traversal', () => {
  const d = fixture(150, 149);
  for (let i = 1; i < 150; i++) { d.families[i - 1].partner1_id = i; d.family_children.push({ id: i, family_id: i, child_id: i + 1, sort_order: 1, relation_type: null }); }
  d.auto_increment.family_children = 150;
  assert.equal(validateDocument(d).ok, true); assert.equal(layout(d).nodes.length, 150);
});
