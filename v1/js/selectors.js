/** Read-only indexes shared by layout and UI. */
export function createIndexes(document) {
  const personsById = new Map(document.persons.map(person => [person.id, person]));
  const familiesById = new Map(document.families.map(family => [family.id, family]));
  const childrenByFamily = new Map(document.families.map(family => [family.id, []]));
  const parentLinksByChild = new Map(document.persons.map(person => [person.id, []]));
  const familiesByPartner = new Map(document.persons.map(person => [person.id, []]));
  for (const family of document.families) for (const parent of [family.partner1_id, family.partner2_id]) {
    if (parent !== null) familiesByPartner.get(parent)?.push(family);
  }
  for (const link of document.family_children) {
    childrenByFamily.get(link.family_id)?.push(link);
    parentLinksByChild.get(link.child_id)?.push(link);
  }
  for (const children of childrenByFamily.values()) children.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return { personsById, familiesById, childrenByFamily, parentLinksByChild, familiesByPartner };
}
export const parentLinks = (document, personId) => document.family_children.filter(link => link.child_id === personId);
export const partnerFamilies = (document, personId) => document.families.filter(family => family.partner1_id === personId || family.partner2_id === personId);
export const familyChildren = (document, familyId) => document.family_children.filter(link => link.family_id === familyId).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
