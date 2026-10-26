// formfill.test.mjs - form-fill module ke tests (jsdom).
// PROVE karta hai: sirf profile ke known fields bharte hain; sensitive fields
// (password/OTP/card/PAN) SKIP; submit button click NAHI hota; select dropdown
// value se match hota hai; review banner aata hai.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const SCRIPT = fs.readFileSync(new URL('../content/formfill.js', import.meta.url), 'utf8');

function makeWorld(html, profile, t) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://jobs.example.com/apply', runScripts: 'dangerously' });
  const { window } = dom;
  t.after(() => window.close());
  // jsdom mein offsetParent hamesha null hota hai - test ke liye visible maano.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this; }, configurable: true });
  let listener = null;
  window.chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { sync: { get: (key, cb) => cb({ formProfile: profile }) } },
  };
  window.eval(SCRIPT);
  return { window, listener };
}

function runFill(listener) {
  return new Promise((resolve) => listener({ type: 'CC_FILL_FORM' }, null, resolve));
}

const PROFILE = {
  name: 'Lakshya Yadav', email: 'lakshya@example.com', phone: '9258048164',
  city: 'Noida', country: 'India', linkedin: 'linkedin.com/in/lakshya',
};

test('known fields bharti hai, unknown chhod deti hai, banner aata hai', async (t) => {
  const { window, listener } = makeWorld(`
    <form>
      <label for="nm">Full Name</label><input id="nm" name="full_name">
      <input id="em" type="email" placeholder="Your email">
      <input id="ph" name="mobile_number">
      <input id="xx" name="favourite_color">
      <button type="submit" id="submitBtn">Submit</button>
    </form>`, PROFILE, t);
  const res = await runFill(listener);
  assert.equal(res.ok, true);
  assert.equal(window.document.getElementById('nm').value, 'Lakshya Yadav');
  assert.equal(window.document.getElementById('em').value, 'lakshya@example.com');
  assert.equal(window.document.getElementById('ph').value, '9258048164');
  assert.equal(window.document.getElementById('xx').value, '', 'unknown field khaali');
  assert.ok(window.document.getElementById('cc-fill-banner'), 'review banner');
  assert.ok(/REVIEW/.test(window.document.getElementById('cc-fill-banner').textContent));
});

test('sensitive fields (password/OTP/card/PAN) SKIP hote hain', async (t) => {
  const { window, listener } = makeWorld(`
    <form>
      <input id="pw" type="password" name="password">
      <input id="otp" name="otp_code" placeholder="Enter OTP">
      <input id="card" name="card_number">
      <input id="pan" name="pan_card">
      <input id="em" type="email">
    </form>`, PROFILE, t);
  const res = await runFill(listener);
  assert.equal(res.ok, true);
  assert.equal(res.result.skippedSensitive, 4, '4 sensitive skip: ' + JSON.stringify(res.result));
  assert.equal(window.document.getElementById('pw').value, '');
  assert.equal(window.document.getElementById('otp').value, '');
  assert.equal(window.document.getElementById('card').value, '');
  assert.equal(window.document.getElementById('pan').value, '');
  assert.equal(window.document.getElementById('em').value, 'lakshya@example.com');
});

test('select dropdown value/text se match hota hai', async (t) => {
  const { window, listener } = makeWorld(`
    <form><select id="co" name="country">
      <option value="">Choose</option><option value="in">India</option><option value="us">USA</option>
    </select></form>`, PROFILE, t);
  const res = await runFill(listener);
  assert.equal(res.ok, true);
  assert.equal(window.document.getElementById('co').value, 'in');
});

test('khaali profile par error, kuch nahi bharta', async (t) => {
  const { window, listener } = makeWorld('<form><input id="em" type="email"></form>', {}, t);
  const res = await runFill(listener);
  assert.equal(res.ok, false);
  assert.equal(window.document.getElementById('em').value, '');
});
