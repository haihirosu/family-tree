import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseDocument,serializeDocument,readFamilyFile,MAX_FILE_BYTES} from '../js/io.js';

test('BOM import and canonical JSON export retain IDs, counters and partial dates',async()=>{
  const text=await readFile(new URL('../../samples/sample_family.json',import.meta.url),'utf8');
  const loaded=parseDocument('\ufeff'+text);
  assert.equal(loaded.ok,true);
  const serialized=serializeDocument(loaded.document);
  assert.equal(serialized.ok,true);
  assert.deepEqual(parseDocument(serialized.text).document,loaded.document);
  const keys=Object.keys(JSON.parse(serialized.text));
  assert.deepEqual(keys,['schema_version','auto_increment','persons','families','family_children']);
});

test('invalid JSON and oversized file imports fail without accepting replacement data',async()=>{
  assert.equal(parseDocument('{"schema_version":').ok,false);
  const tooLarge=await readFamilyFile({size:MAX_FILE_BYTES+1,text(){throw Error('Must not read oversize input');}});
  assert.equal(tooLarge.ok,false);
  assert.equal(tooLarge.issues[0].code,'LIMIT_EXCEEDED');
  const rejected=await readFamilyFile(new Blob(['{bad']));
  assert.equal(rejected.ok,false);
});

test('sample is fictional, has nullable life status and preserves arbitrary Unicode',async()=>{
  const text=await readFile(new URL('../../samples/sample_family.json',import.meta.url),'utf8');
  const loaded=parseDocument(text);
  assert.equal(loaded.ok,true);
  assert.ok(loaded.document.persons.every(p=>p.name.startsWith('（架空）')));
  assert.ok(loaded.document.persons.some(p=>p.is_alive===null));
  assert.ok(loaded.document.persons.some(p=>p.is_alive===false));
  assert.ok(text.includes('Trần'));
});


test('malformed UTF-8 is rejected rather than replacing characters in names',async()=>{
  const file=new Blob([new Uint8Array([0x7b,0x22,0xff,0x22,0x7d])]);
  const result=await readFamilyFile(file);
  assert.equal(result.ok,false);
  assert.equal(result.issues[0].code,'READ_FAILED');
});
