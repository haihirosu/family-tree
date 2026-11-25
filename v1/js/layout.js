import { createIndexes } from './selectors.js';

const DEFAULT = Object.freeze({ cardWidth: 176, cardHeight: 104, gap: 32, lane: 24, componentGap: 96, margin: 24 });
const keySort = (a, b) => Number(a.slice(2)) - Number(b.slice(2)) || a.localeCompare(b, 'en');
const position = (x, y) => ({ x, y });
const failed = code => ({ nodes: [], personNodes: [], families: [], familyAnchors: [], edges: [], components: [], bounds: { width: 1, height: 1 }, issues: [{ code, path: 'layout', severity: 'error', params: {} }] });

/** Deterministic layered layout. This does not mutate the document or repair exceptional relationships. */
export function layout(document, options = {}) {
  const m = { ...DEFAULT, ...options };
  const ix = createIndexes(document);
  const graph = new Map();
  for (const person of document.persons) graph.set(`p:${person.id}`, []);
  for (const family of document.families) graph.set(`f:${family.id}`, []);
  const connect = (from, to, delta) => {
    graph.get(from).push({ key: to, delta });
    graph.get(to).push({ key: from, delta: -delta });
  };
  for (const family of document.families) {
    for (const parent of [family.partner1_id, family.partner2_id]) if (parent !== null) connect(`f:${family.id}`, `p:${parent}`, 0);
    for (const child of ix.childrenByFamily.get(family.id)) connect(`f:${family.id}`, `p:${child.child_id}`, 1);
  }
  for (const neighbors of graph.values()) neighbors.sort((a, b) => keySort(a.key, b.key) || a.delta - b.delta);
  const visited = new Set(), scopes = [];
  for (const seed of [...graph.keys()].sort(keySort)) {
    if (visited.has(seed)) continue;
    const keys = [seed]; visited.add(seed);
    for (let q = 0; q < keys.length; q++) for (const edge of graph.get(keys[q])) if (!visited.has(edge.key)) {
      visited.add(edge.key); keys.push(edge.key);
    }
    keys.sort(keySort);
    const people = keys.filter(key => key.startsWith('p:')).map(key => Number(key.slice(2)));
    const families = keys.filter(key => key.startsWith('f:')).map(key => Number(key.slice(2)));
    scopes.push({ keys, people, families, sortKey: people.length ? people[0] : Infinity, familyKey: families[0] ?? 0 });
  }
  scopes.sort((a, b) => a.sortKey - b.sortKey || a.familyKey - b.familyKey);
  const nodes = [], familyNodes = [], edges = [], components = [];
  let offsetX = 0, globalHeight = 0;
  for (const scope of scopes) {
    const g = new Map([[scope.keys[0], 0]]), queue = [scope.keys[0]];
    for (let q = 0; q < queue.length; q++) for (const edge of graph.get(queue[q])) {
      const expected = g.get(queue[q]) + edge.delta;
      if (g.has(edge.key)) { if (g.get(edge.key) !== expected) return failed('LAYOUT_GENERATION_CONFLICT'); }
      else { g.set(edge.key, expected); queue.push(edge.key); }
    }
    const minG = Math.min(...g.values());
    for (const [key, value] of g) g.set(key, value - minG);
    const maxG = Math.max(...g.values());
    const rows = Array.from({ length: maxG + 1 }, () => []);
    const widths = new Map(), hard = new Map(), neighbors = new Map();
    for (const personId of scope.people) {
      const key = `p:${personId}`; rows[g.get(key)].push(key); widths.set(key, m.cardWidth); hard.set(key, new Set()); neighbors.set(key, new Set());
    }
    for (const familyId of scope.families) {
      const f = ix.familiesById.get(familyId);
      if (f.partner1_id === null && f.partner2_id === null) {
        const key = `f:${familyId}`; rows[g.get(key)].push(key); widths.set(key, 48); hard.set(key, new Set()); neighbors.set(key, new Set());
      }
    }
    const relate = (a, b) => { neighbors.get(a)?.add(b); neighbors.get(b)?.add(a); };
    for (const familyId of scope.families) {
      const family = ix.familiesById.get(familyId), children = ix.childrenByFamily.get(familyId);
      const parents = [family.partner1_id, family.partner2_id].filter(id => id !== null).map(id => `p:${id}`);
      if (parents.length === 2) relate(parents[0], parents[1]);
      for (const child of children) for (const parent of parents.length ? parents : [`f:${familyId}`]) relate(parent, `p:${child.child_id}`);
      for (let i = 1; i < children.length; i++) hard.get(`p:${children[i - 1].child_id}`).add(`p:${children[i].child_id}`);
    }
    const x = new Map();
    const measureRows = () => {
      const rowWidths = rows.map(row => row.reduce((sum, key) => sum + widths.get(key), 0) + Math.max(0, row.length - 1) * m.gap);
      const maxWidth = Math.max(48, ...rowWidths);
      rows.forEach((row, r) => {
        let left = (maxWidth - rowWidths[r]) / 2 + m.margin;
        for (const key of row) { x.set(key, left + widths.get(key) / 2); left += widths.get(key) + m.gap; }
      });
      return maxWidth;
    };
    const sortRow = (row, useBarycenter) => {
      const degree = new Map(row.map(key => [key, 0]));
      for (const key of row) for (const to of hard.get(key)) degree.set(to, degree.get(to) + 1);
      const previous = new Map(row.map((key, i) => [key, i]));
      const priority = key => {
        if (!useBarycenter) return Number(key.slice(2));
        const values = [...neighbors.get(key)].filter(other => x.has(other)).map(other => x.get(other));
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : x.get(key);
      };
      const priorities = new Map(row.map(key => [key, priority(key)]));
      const available = row.filter(key => degree.get(key) === 0), sorted = [];
      while (available.length) {
        available.sort((a, b) => priorities.get(a) - priorities.get(b) || previous.get(a) - previous.get(b) || keySort(a, b));
        const key = available.shift(); sorted.push(key);
        for (const to of hard.get(key)) { degree.set(to, degree.get(to) - 1); if (degree.get(to) === 0) available.push(to); }
      }
      return sorted.length === row.length ? sorted : null;
    };
    for (let r = 0; r < rows.length; r++) {
      rows[r].sort(keySort);
      const sorted = sortRow(rows[r], false);
      if (!sorted) return failed('LAYOUT_ORDER_CONFLICT');
      rows[r] = sorted;
    }
    measureRows();
    for (let sweep = 0; sweep < 4; sweep++) {
      const indexes = [...rows.keys()]; if (sweep % 2) indexes.reverse();
      for (const r of indexes) { rows[r] = sortRow(rows[r], true); measureRows(); }
    }
    const rowFamilies = rows.map((_, rank) => scope.families.filter(id => g.get(`f:${id}`) === rank).sort((a, b) => a - b));
    const y = [], gapHeight = [];
    let top = m.margin;
    for (let rank = 0; rank < rows.length; rank++) {
      y[rank] = top;
      const withChildren = rowFamilies[rank].filter(id => ix.childrenByFamily.get(id).length);
      gapHeight[rank] = 3 * m.lane + rowFamilies[rank].length * m.lane + withChildren.length * m.lane;
      top += m.cardHeight + gapHeight[rank];
    }
    const scopeNodes = scope.people.map(personId => ({ viewKey: `person:${personId}`, personId, x: x.get(`p:${personId}`) - m.cardWidth / 2, y: y[g.get(`p:${personId}`)], width: m.cardWidth, height: m.cardHeight }));
    const nodeMap = new Map(scopeNodes.map(node => [node.personId, node]));
    const localEdges = [], localFamilies = [];
    const parentPorts = new Map(), childPorts = new Map();
    for (const personId of scope.people) {
      const outgoing = [...ix.familiesByPartner.get(personId)].sort((a, b) => a.id - b.id);
      const incoming = [...ix.parentLinksByChild.get(personId)].sort((a, b) => a.id - b.id);
      const node = nodeMap.get(personId);
      outgoing.forEach((f, index) => parentPorts.set(`${f.id}:${personId}`, node.x + 16 + (m.cardWidth - 32) * (index + 1) / (outgoing.length + 1)));
      incoming.forEach((c, index) => childPorts.set(c.id, node.x + 16 + (m.cardWidth - 32) * (index + 1) / (incoming.length + 1)));
    }
    const usedTrunks = new Set([...parentPorts.values(), ...childPorts.values()]);
    const edge = (edgeKey, familyId, kind, points, extra = {}) => localEdges.push({ edgeKey, familyId, kind, points, ...extra });
    for (const familyId of scope.families) {
      const family = ix.familiesById.get(familyId), children = ix.childrenByFamily.get(familyId), rank = g.get(`f:${familyId}`);
      const parents = [family.partner1_id, family.partner2_id].filter(id => id !== null);
      const ports = parents.map(personId => parentPorts.get(`${familyId}:${personId}`));
      const busY = y[rank] + m.cardHeight + m.lane + rowFamilies[rank].indexOf(familyId) * m.lane;
      const center = ports.length ? (Math.min(...ports) + Math.max(...ports)) / 2 : x.get(`f:${familyId}`);
      let trunkX = center;
      for (let attempt = 1; usedTrunks.has(trunkX); attempt++) trunkX = center + (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 3;
      usedTrunks.add(trunkX);
      const left = Math.min(trunkX, ...ports), right = Math.max(trunkX, ...ports);
      edge(`family:${familyId}:partners`, familyId, 'partner', [position(left - (ports.length < 2 ? 12 : 0), busY), position(right + (ports.length < 2 ? 12 : 0), busY)]);
      for (const personId of parents) {
        const portX = parentPorts.get(`${familyId}:${personId}`), node = nodeMap.get(personId);
        edge(`family:${familyId}:partner:${personId}`, familyId, 'partner', [position(portX, node.y + node.height), position(portX, busY)]);
      }
      const anchor = { viewKey: `family:${familyId}`, familyId, x: trunkX, y: busY };
      localFamilies.push(anchor);
      if (children.length) {
        const childFamilies = rowFamilies[rank].filter(id => ix.childrenByFamily.get(id).length);
        const railY = y[rank] + m.cardHeight + 2 * m.lane + rowFamilies[rank].length * m.lane + childFamilies.indexOf(familyId) * m.lane;
        const childXs = children.map(c => childPorts.get(c.id));
        edge(`family:${familyId}:trunk`, familyId, 'child-bus', [position(trunkX, busY), position(trunkX, railY)]);
        edge(`family:${familyId}:children`, familyId, 'child-bus', [position(Math.min(trunkX, ...childXs), railY), position(Math.max(trunkX, ...childXs), railY)]);
        for (const child of children) {
          const childX = childPorts.get(child.id), node = nodeMap.get(child.child_id);
          edge(`child:${child.id}`, familyId, 'child', [position(childX, railY), position(childX, node.y)], { childLinkId: child.id, relationType: child.relation_type });
        }
      }
    }
    const allX = [...scopeNodes.flatMap(node => [node.x, node.x + node.width]), ...localEdges.flatMap(line => line.points.map(p => p.x)), ...localFamilies.flatMap(f => [f.x - 24, f.x + 24])];
    const allY = [...scopeNodes.flatMap(node => [node.y, node.y + node.height]), ...localEdges.flatMap(line => line.points.map(p => p.y)), ...localFamilies.map(f => f.y + 24)];
    const minX = Math.min(...allX), maxX = Math.max(...allX), maxY = Math.max(...allY);
    const dx = offsetX + m.margin - minX, width = maxX - minX + 2 * m.margin, height = maxY + m.margin;
    const componentKey = scope.people.length ? `person:${scope.people[0]}` : `family:${scope.families[0]}`;
    for (const node of scopeNodes) nodes.push({ ...node, x: node.x + dx, componentKey });
    for (const family of localFamilies) familyNodes.push({ ...family, x: family.x + dx, componentKey });
    for (const line of localEdges) edges.push({ ...line, points: line.points.map(p => position(p.x + dx, p.y)) });
    components.push({ componentKey, bounds: { x: offsetX, y: 0, width, height } });
    offsetX += width + m.componentGap;
    globalHeight = Math.max(globalHeight, height);
  }
  return { nodes, personNodes: nodes, families: familyNodes, familyAnchors: familyNodes, edges, components,
    relationTargets: familyNodes.map(f => ({ familyId: f.familyId, anchor: position(f.x, f.y), componentKey: f.componentKey })),
    bounds: { width: Math.max(1, offsetX ? offsetX - m.componentGap : 1), height: Math.max(1, globalHeight) }, issues: [] };
}
