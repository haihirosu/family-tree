/** Persisted schema. UI state and unplaced drafts never belong here. */
export const PERSON_FIELDS = Object.freeze([
  'name', 'nickname', 'gender', 'residence', 'birth_place', 'birth_date',
  'occupation', 'is_alive', 'death_date', 'notes',
]);
export const TABLES = Object.freeze(['persons', 'families', 'family_children']);
export const LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024, persons: 2000, families: 3000,
  family_children: 6000, text: 500, code: 100, notes: 20000,
});
export function blankPerson() {
  return Object.fromEntries(PERSON_FIELDS.map(field => [field, null]));
}
export function emptyDocument() {
  return { schema_version: 1,
    auto_increment: { persons: 1, families: 1, family_children: 1 },
    persons: [], families: [], family_children: [] };
}
