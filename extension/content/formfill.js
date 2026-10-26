// formfill.js - user ki APPROVED details se web form fields bharna.
//
// RULES (hard):
//   - Sirf user ne options page par jo details di hain wahi bharti hai. Kuch
//     invent nahi karti. Character/persona ka FICTIONAL data form mein nahi
//     jaata - forms mein asli facts chahiye, character sirf chat ke liye hai.
//   - Submit KABHI nahi dabati. Fill ke baad fields highlight + review banner;
//     final Submit user khud karta hai.
//   - Sensitive fields skip: password, OTP/verification codes, payment/card,
//     government IDs (PAN/Aadhaar/SSN), captcha. Inhe apne aap kabhi nahi bharti.
//   - Sirf tab chalti hai jab user explicitly "Fill form" command de
//     (toolbar/options se CC_FILL_FORM message). Page load par apne aap nahi.

(function () {
  'use strict';

  const esc = (typeof CSS !== 'undefined' && CSS.escape)
    ? CSS.escape
    : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);

  // Field synonyms -> formProfile keys. Order matters: pehla match jeet-ta hai.
  const FIELD_MAP = [
    [/first.?name|given.?name|fname/i, 'firstName'],
    [/last.?name|surname|family.?name|lname/i, 'lastName'],
    [/full.?name|^name$|your.?name|candidate.?name/i, 'name'],
    [/e.?mail/i, 'email'],
    [/phone|mobile|contact.?no|whatsapp.?no/i, 'phone'],
    [/address.?line.?1|street|^address$/i, 'address1'],
    [/address.?line.?2|landmark/i, 'address2'],
    [/city|town/i, 'city'],
    [/state|province/i, 'state'],
    [/zip|pin.?code|postal/i, 'zip'],
    [/country/i, 'country'],
    [/birth|dob/i, 'dob'],
    [/linkedin/i, 'linkedin'],
    [/github/i, 'github'],
    [/portfolio|website|url/i, 'portfolio'],
    [/company|current.?employer|organization/i, 'company'],
    [/college|university|institute/i, 'college'],
    [/degree|qualification|course/i, 'degree'],
    [/graduation|passing.?year/i, 'graduationYear'],
    [/experience.?years|years.?of.?experience/i, 'experienceYears'],
    [/current.?ctc|current.?salary/i, 'currentCtc'],
    [/expected.?ctc|expected.?salary/i, 'expectedCtc'],
    [/notice.?period/i, 'noticePeriod'],
    [/cover.?letter|about.?you|summary|why.*role/i, 'coverNote'],
  ];

  // In patterns wale fields KABHI auto-fill nahi hote.
  const SENSITIVE = /pass(word)?|otp|one.?time|2fa|verification.?code|security.?code|captcha|card.?num|cardnumber|cvv|cvc|expir|ssn|pan.?card|aadhaar|aadhar|account.?num|ifsc|upi|pin(?!.?code)/i;

  function labelTextFor(el, doc) {
    let t = '';
    if (el.id) {
      const l = doc.querySelector('label[for="' + esc(el.id) + '"]');
      if (l) t += ' ' + l.textContent;
    }
    const pl = el.closest('label');
    if (pl) t += ' ' + pl.textContent;
    if (el.getAttribute('aria-label')) t += ' ' + el.getAttribute('aria-label');
    if (el.getAttribute('aria-labelledby')) {
      const ref = doc.getElementById(el.getAttribute('aria-labelledby'));
      if (ref) t += ' ' + ref.textContent;
    }
    return t;
  }

  function fieldSignature(el, doc) {
    return [
      el.getAttribute('autocomplete') || '',
      el.name || '', el.id || '',
      el.placeholder || '',
      labelTextFor(el, doc),
    ].join(' ');
  }

  function classify(el, doc) {
    const sig = fieldSignature(el, doc);
    if (SENSITIVE.test(sig) || SENSITIVE.test(el.type || '')) return { skip: 'sensitive' };
    if (el.type === 'password') return { skip: 'sensitive' };
    // Input TYPE ka bharosa label-text se zyada strong hai.
    if (el.type === 'email') return { key: 'email' };
    if (el.type === 'tel') return { key: 'phone' };
    for (const [re, key] of FIELD_MAP) {
      if (re.test(sig)) return { key };
    }
    return { skip: 'unknown' };
  }

  function setNativeValue(el, value) {
    // React/controlled inputs bhi value accept karein isliye native setter.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillForm(profile) {
    const result = { filled: [], skippedSensitive: 0, unknown: 0 };
    const els = document.querySelectorAll('input, textarea, select');
    els.forEach((el) => {
      if (el.disabled || el.readOnly) return;
      if (el.offsetParent === null) return; // hidden
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'file', 'image', 'reset', 'hidden', 'checkbox', 'radio'].includes(type)) return;
      const c = classify(el, document);
      if (c.skip === 'sensitive') { result.skippedSensitive++; return; }
      if (c.skip === 'unknown' || !c.key) { result.unknown++; return; }
      const value = profile[c.key];
      if (!value) return;
      if (tag === 'select') {
        const opt = Array.from(el.options).find(
          (o) => o.value.toLowerCase() === String(value).toLowerCase() || o.textContent.trim().toLowerCase() === String(value).toLowerCase()
        );
        if (!opt) { result.unknown++; return; }
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        setNativeValue(el, String(value));
      }
      el.setAttribute('style', (el.getAttribute('style') || '') + ';outline:2px solid #25d366;outline-offset:1px;');
      result.filled.push(c.key);
    });
    // Review banner
    let banner = document.getElementById('cc-fill-banner');
    if (banner) banner.remove();
    banner = document.createElement('div');
    banner.id = 'cc-fill-banner';
    banner.setAttribute('style', [
      'position:fixed', 'bottom:16px', 'left:16px', 'z-index:2147483647',
      'background:#1f2c33', 'color:#fff', 'padding:10px 14px', 'border-radius:10px',
      'font:13px sans-serif', 'max-width:340px', 'box-shadow:0 2px 10px rgba(0,0,0,.4)',
    ].join(';'));
    banner.textContent =
      'Form auto-fill: ' + result.filled.length + ' fields bhari (' + result.filled.join(', ') + '). ' +
      result.skippedSensitive + ' sensitive fields skip. Sab REVIEW karo, phir Submit KHUD dabao - main submit nahi karti.';
    document.body.appendChild(banner);
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'CC_FILL_FORM') return false;
    chrome.storage.sync.get('formProfile', (r) => {
      const profile = (r && r.formProfile) || {};
      if (!Object.keys(profile).length) {
        sendResponse({ ok: false, error: 'formProfile khaali hai - pehle extension settings mein apni details bharo.' });
        return;
      }
      try {
        sendResponse({ ok: true, result: fillForm(profile) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  });
})();
