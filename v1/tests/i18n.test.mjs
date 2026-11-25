import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadLanguage, getLanguage, t, formatPartialDate, supportedLanguages } from '../js/i18n.js';
import { Viewport } from '../js/viewport.js';

const localeURL = lang => new URL(`../locales/${lang}.json`, import.meta.url);

test('all language dictionaries have identical nonempty keys and parameter names', async () => {
  const dictionaries = await Promise.all(supportedLanguages.map(async lang => JSON.parse(await readFile(localeURL(lang), 'utf8'))));
  const keys = Object.keys(dictionaries[0]).sort();
  for (const dictionary of dictionaries) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.length > 0, key);
      const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(parameters(value), parameters(dictionaries[0][key]), key);
    }
  }
});

test('language loading preserves user parameters and unknown date precision', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, 'utf8')) });
  try {
    await loadLanguage('en');
    assert.equal(getLanguage(), 'en');
    assert.equal(t('label.before', { name: 'Nguyễn <example>' }), 'Before Nguyễn <example>');
    assert.equal(formatPartialDate(19800000), '1980');
    assert.equal(formatPartialDate(19800500), '1980-05');
    await loadLanguage('ja');
    assert.equal(formatPartialDate(19800521), '1980年5月21日');
    await loadLanguage('vi');
    assert.equal(formatPartialDate(19800500), 'Tháng 5/1980');
    assert.equal(formatPartialDate(19800521), '21/5/1980');
    await loadLanguage('unsupported');
    assert.equal(getLanguage(), 'ja');
  } finally { globalThis.fetch = originalFetch; }
});

class Surface extends EventTarget {
  style = {};
  clientWidth = 400;
  clientHeight = 500;
  captured = new Set();
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
const point = (surface, id, x, y) => ({ pointerId: id, button: 0, clientX: x, clientY: y, target: surface, preventDefault() {} });

test('tap leaves card events available while dragging captures pointers and suppresses click', () => {
  const surface = new Surface();
  const viewport = new Viewport(surface, { style: {} });
  const initialX = viewport.x;
  viewport.pointerDown(point(surface, 1, 10, 20));
  viewport.pointerMove(point(surface, 1, 14, 23));
  assert.equal(viewport.x, initialX);
  assert.equal(surface.captured.size, 0);
  viewport.pointerEnd(point(surface, 1, 14, 23));
  assert.equal(viewport.suppressClickUntil, 0);
  viewport.pointerDown(point(surface, 2, 10, 20));
  viewport.pointerMove(point(surface, 2, 30, 20));
  assert.equal(viewport.x, initialX + 20);
  assert.ok(surface.captured.has(2));
  viewport.pointerEnd(point(surface, 2, 30, 20));
  assert.ok(viewport.suppressClickUntil > performance.now());
  viewport.destroy();
});

test('pinch preserves midpoint and redraw anchor preserves scale and screen position', () => {
  const surface = new Surface();
  const viewport = new Viewport(surface, { style: {} });
  viewport.pointerDown(point(surface, 1, 100, 100));
  viewport.pointerDown(point(surface, 2, 200, 100));
  viewport.pointerMove(point(surface, 2, 300, 100));
  assert.equal(viewport.scale, 2);
  const nodes = [{ personId: 1, x: 100, y: 120, width: 176, height: 104 }];
  const snapshot = viewport.snapshot(nodes, 1);
  const moved = [{ ...nodes[0], x: 500, y: 400 }];
  viewport.restore(snapshot, moved);
  assert.equal(viewport.scale, 2);
  assert.equal((moved[0].x + 88) * viewport.scale + viewport.x, snapshot.anchorX);
  assert.equal((moved[0].y + 52) * viewport.scale + viewport.y, snapshot.anchorY);
  assert.equal(viewport.pointers.size, 0);
  viewport.fit({ width: 10000, height: 1000 });
  assert.ok(viewport.scale < 0.25);
  viewport.destroy();
});
