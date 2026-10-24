// memory.test.js - per-contact memory isolation ke unit tests.
// Fake in-memory collection use hoti hai - real MongoDB server ki zaroorat nahi.
// Isliye ye tests storage LOGIC (isolation, ordering, limit, deletion) prove
// karte hain, MongoDB server connectivity nahi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/memory.js';

// Minimal MongoDB-collection-compatible fake: sirf wahi methods jo memory.js use karta hai.
function fakeCollection() {
  const docs = [];
  let idc = 0;
  const match = (d, q) => Object.entries(q).every(([k, v]) => d[k] === v);
  return {
    docs,
    async insertOne(doc) { doc._id = ++idc; docs.push(doc); },
    find(q) {
      let out = docs.filter((d) => match(d, q));
      return {
        sort(spec) { const [k, dir] = Object.entries(spec)[0]; out = [...out].sort((a, b) => (a[k] < b[k] ? -dir : dir)); return this; },
        limit(n) { out = out.slice(0, n); return this; },
        async toArray() { return out; },
      };
    },
    async deleteMany(q) {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--) if (match(docs[i], q)) docs.splice(i, 1);
      return { deletedCount: before - docs.length };
    },
    async createIndex() {},
  };
}

const T = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)); // deterministic order

test('ISOLATION: Adarsh ki memory doosri chat mein kabhi nahi aati', async () => {
  const store = createMemoryStore(fakeCollection());
  await store.appendMessage({ ownerId: 'me', chatId: 'adarsh-101', role: 'user', text: 'bhai exam kab hai', ts: T(1) });
  await store.appendMessage({ ownerId: 'me', chatId: 'adarsh-101', role: 'assistant', text: 'kal hai', ts: T(2) });
  await store.appendMessage({ ownerId: 'me', chatId: 'priya-202', role: 'user', text: 'movie plan?', ts: T(3) });

  const adarsh = await store.getRecentMessages({ ownerId: 'me', chatId: 'adarsh-101' });
  assert.deepEqual(adarsh.map((m) => m.text), ['bhai exam kab hai', 'kal hai']);
  assert.ok(!adarsh.some((m) => m.text === 'movie plan?'), 'doosri chat ka text leak nahi');

  const priya = await store.getRecentMessages({ ownerId: 'me', chatId: 'priya-202' });
  assert.deepEqual(priya.map((m) => m.text), ['movie plan?']);
});

test('ISOLATION: same chatId par do alag owners ka data alag rehta hai', async () => {
  const store = createMemoryStore(fakeCollection());
  await store.appendMessage({ ownerId: 'user-A', chatId: 'adarsh-101', role: 'user', text: 'A wali baat', ts: T(1) });
  await store.appendMessage({ ownerId: 'user-B', chatId: 'adarsh-101', role: 'user', text: 'B wali baat', ts: T(2) });

  const a = await store.getRecentMessages({ ownerId: 'user-A', chatId: 'adarsh-101' });
  assert.deepEqual(a.map((m) => m.text), ['A wali baat']);
});

test('ORDER + LIMIT: recent messages purane->naye, limit se sirf latest aate hain', async () => {
  const store = createMemoryStore(fakeCollection());
  for (let i = 0; i < 30; i++) {
    await store.appendMessage({ ownerId: 'me', chatId: 'c1', role: 'user', text: `msg-${i}`, ts: T(i) });
  }
  const recent = await store.getRecentMessages({ ownerId: 'me', chatId: 'c1', limit: 5 });
  assert.deepEqual(recent.map((m) => m.text), ['msg-25', 'msg-26', 'msg-27', 'msg-28', 'msg-29']);
});

test('DELETION: clearChat sirf wahi chat saaf karta hai, baaki mehfooz', async () => {
  const store = createMemoryStore(fakeCollection());
  await store.appendMessage({ ownerId: 'me', chatId: 'adarsh-101', role: 'user', text: 'x', ts: T(1) });
  await store.appendMessage({ ownerId: 'me', chatId: 'priya-202', role: 'user', text: 'y', ts: T(2) });
  const n = await store.clearChat({ ownerId: 'me', chatId: 'adarsh-101' });
  assert.equal(n, 1);
  assert.deepEqual(await store.getRecentMessages({ ownerId: 'me', chatId: 'adarsh-101' }), []);
  assert.equal((await store.getRecentMessages({ ownerId: 'me', chatId: 'priya-202' })).length, 1);

  const all = await store.clearAllForOwner('me');
  assert.equal(all, 1);
  assert.deepEqual(await store.getRecentMessages({ ownerId: 'me', chatId: 'priya-202' }), []);
});

test('FAIL CLOSED: ownerId ya chatId missing to store nahi hota', async () => {
  const store = createMemoryStore(fakeCollection());
  await assert.rejects(() => store.appendMessage({ ownerId: '', chatId: 'c1', role: 'user', text: 'x' }));
  await assert.rejects(() => store.appendMessage({ ownerId: 'me', chatId: null, role: 'user', text: 'x' }));
  await assert.rejects(() => store.getRecentMessages({ ownerId: 'me', chatId: '' }));
});
