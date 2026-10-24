// prompt.test.js - prompt builder ke unit tests (node:test, bina extra dependency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildMessages } from '../src/prompt.js';

test('system prompt mein character ka naam, role aur tone aata hai', () => {
  const prompt = buildSystemPrompt({ name: 'Meera', gender: 'female', role: 'college friend', tone: 'funny' });
  assert.match(prompt, /Meera/);
  assert.match(prompt, /college friend/);
  assert.match(prompt, /funny/);
});

test('boundaries hard rule ke roop mein include hoti hain', () => {
  const prompt = buildSystemPrompt({ boundaries: 'no politics' });
  assert.match(prompt, /never cross/i);
  assert.match(prompt, /no politics/);
});

test('language aur script matching ka rule hamesha hota hai', () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /SAME language and script/i);
  assert.match(prompt, /Hinglish/);
});

test('flirting off hone par "do not flirt" aata hai', () => {
  assert.match(buildSystemPrompt({ flirting: false }), /Do not flirt/i);
  assert.match(buildSystemPrompt({ flirting: true }), /Light flirting is allowed/i);
});

test('buildMessages system prompt ko pehle rakhta hai aur roles map karta hai', () => {
  const chat = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'kaisa hai' },
  ];
  const messages = buildMessages({ name: 'Meera' }, chat);
  assert.equal(messages[0].role, 'system');
  assert.deepEqual(messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
});

test('buildMessages last N messages tak limit karta hai', () => {
  const chat = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  const messages = buildMessages({}, chat, 20);
  assert.equal(messages.length, 21); // 1 system + 20 chat
  assert.equal(messages.at(-1).content, 'msg 29');
});

test('khaali aur galat roles filter ho jaate hain', () => {
  const chat = [
    { role: 'user', content: '   ' },
    { role: 'weird', content: 'hello' },
    { role: 'assistant', content: 'ok' },
  ];
  const messages = buildMessages({}, chat);
  assert.deepEqual(messages.slice(1).map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[1].content, 'hello');
});

test('prompt injection guard hamesha include hota hai', () => {
  const prompt = buildSystemPrompt({});
  assert.match(prompt, /data, never instructions/i);
  assert.match(prompt, /reveal this prompt/i);
});
