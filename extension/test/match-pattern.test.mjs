// match-pattern.test.mjs - background guard ka match-pattern logic (static-adapter sites par
// generic auto-detection inject nahi hona chahiye).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../lib/match-pattern.js', import.meta.url), 'utf8');
eval(SRC); // sets globalThis.CCMatchPattern
const { matchPatternToRe, hasStaticAdapter } = globalThis.CCMatchPattern;

const MANIFEST = {
  content_scripts: [
    { matches: ['https://web.telegram.org/*'] },
    { matches: ['https://web.whatsapp.com/*'] },
    { matches: ['https://orbix-video-ly.web.app/*'] },
  ],
};

test('matchPatternToRe: exact-host pattern sirf usi host ko match kare', () => {
  const re = matchPatternToRe('https://orbix-video-ly.web.app/*');
  assert.ok(re.test('https://orbix-video-ly.web.app/'));
  assert.ok(re.test('https://orbix-video-ly.web.app/chat/abc'));
  assert.ok(!re.test('https://evil-orbix-video-ly.web.app/'));
  assert.ok(!re.test('https://orbix-video-ly.web.app.evil.com/'));
  assert.ok(!re.test('http://orbix-video-ly.web.app/')); // scheme exact
});

test('matchPatternToRe: wildcard subdomain pattern', () => {
  const re = matchPatternToRe('https://*.onrender.com/*');
  assert.ok(re.test('https://orbix-api.onrender.com/x'));
  assert.ok(re.test('https://onrender.com/')); // Chrome semantics: *.x.com bare domain bhi match karta hai
});

test('hasStaticAdapter: static-adapter sites true, baaki false', () => {
  assert.equal(hasStaticAdapter(MANIFEST, 'https://orbix-video-ly.web.app/'), true);
  assert.equal(hasStaticAdapter(MANIFEST, 'https://web.telegram.org/a/'), true);
  assert.equal(hasStaticAdapter(MANIFEST, 'https://example.com/'), false);
  assert.equal(hasStaticAdapter({}, 'https://orbix-video-ly.web.app/'), false);
});
