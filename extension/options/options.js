// options.js - settings page ka logic.
// Fields ko chrome.storage.sync mein save karta hai, taaki content script
// har chat mein same character use kare.

const FIELDS = [
  'name', 'gender', 'role', 'tone', 'humour', 'replyLength',
  'age', 'backstory', 'vocabulary', 'defaultMood',
  'topics', 'boundaries', 'styleExamples', 'backendUrl', 'authToken',
];
const CHECKBOXES = ['playful', 'flirting'];
const FORM_FIELDS = [
  'name', 'firstName', 'lastName', 'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'country', 'dob',
  'linkedin', 'github', 'portfolio', 'company', 'college', 'degree',
  'graduationYear', 'experienceYears', 'currentCtc', 'expectedCtc',
  'noticePeriod', 'coverNote',
];

function loadSettings() {
  chrome.storage.sync.get(['character', 'backendUrl', 'authToken'], (result) => {
    const character = result.character || {};
    // Migration: purane versions authToken sync mein rakhte the. Token secret hai,
    // isliye ab sirf storage.local (is device) mein. Sync copy migrate karke delete.
    if (result.authToken) {
      chrome.storage.local.get(['authToken'], (localRes) => {
        if (!localRes.authToken) chrome.storage.local.set({ authToken: result.authToken });
        chrome.storage.sync.remove('authToken');
      });
    }
    FIELDS.forEach((field) => {
      const el = document.getElementById(field);
      if (!el) return;
      if (field === 'backendUrl') {
        el.value = result.backendUrl || 'http://127.0.0.1:8787';
      } else if (field === 'authToken') {
        chrome.storage.local.get(['authToken'], (localRes) => {
          el.value = localRes.authToken || result.authToken || '';
        });
      } else if (character[field]) {
        el.value = character[field];
      } else if (el.tagName !== 'SELECT') {
        el.value = '';
      }
      // SELECT ko blank mat karo: stored value na ho to default selected option hi rahe.
    });
    CHECKBOXES.forEach((field) => {
      const el = document.getElementById(field);
      el.checked = character[field] !== undefined ? Boolean(character[field]) : field === 'playful';
    });
  });
}

function loadFormProfile() {
  chrome.storage.sync.get(['formProfile'], (result) => {
    const profile = result.formProfile || {};
    FORM_FIELDS.forEach((field) => {
      const el = document.getElementById('ff_' + field);
      if (el) el.value = profile[field] || '';
    });
  });
}

function saveFormProfile() {
  const profile = {};
  FORM_FIELDS.forEach((field) => {
    const el = document.getElementById('ff_' + field);
    const v = el ? el.value.trim() : '';
    if (v) profile[field] = v; // khaali fields store hi nahi - kuch invent nahi hoga
  });
  chrome.storage.sync.set({ formProfile: profile }, () => {
    const status = document.getElementById('formStatus');
    status.textContent = ' Form details saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

document.getElementById('saveForm').addEventListener('click', saveFormProfile);

function saveSettings() {
  const character = {};
  FIELDS.forEach((field) => {
    if (field === 'backendUrl' || field === 'authToken') return;
    character[field] = document.getElementById(field).value.trim();
  });
  CHECKBOXES.forEach((field) => {
    character[field] = document.getElementById(field).checked;
  });
  const backendUrl = document.getElementById('backendUrl').value.trim() || 'http://127.0.0.1:8787';
  const authToken = document.getElementById('authToken').value.trim();

  // authToken secret hai: kabhi sync (Google account) mein nahi, sirf is device ke local storage mein.
  chrome.storage.sync.remove('authToken');
  chrome.storage.sync.set({ character, backendUrl }, () => {
    chrome.storage.local.set({ authToken }, () => {
      const status = document.getElementById('status');
      status.textContent = 'Saved.';
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  });
}

document.getElementById('save').addEventListener('click', saveSettings);
loadSettings();
loadFormProfile();


// ---------- Preview: current settings par dummy reply ----------
function collectCharacter() {
  const character = {};
  FIELDS.forEach((field) => {
    if (field === 'backendUrl' || field === 'authToken') return;
    character[field] = document.getElementById(field).value.trim();
  });
  CHECKBOXES.forEach((field) => {
    character[field] = document.getElementById(field).checked;
  });
  return character;
}

async function previewReply() {
  const out = document.getElementById('previewOut');
  const sample = document.getElementById('previewInput').value.trim();
  if (!sample) { out.textContent = 'Pehle ek sample message likho.'; return; }
  const backendUrl = document.getElementById('backendUrl').value.trim() || 'http://127.0.0.1:8787';
  out.textContent = 'AI se poochha ja raha hai...';
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GENERATE_REPLY',
      payload: { backendUrl, character: collectCharacter(), messages: [{ role: 'user', content: sample }] },
    });
    if (!res || !res.ok) { out.textContent = 'Error: ' + ((res && (res.error || (res.data && res.data.error))) || 'unknown'); return; }
    out.textContent = res.data && res.data.reply ? ('AI: ' + res.data.reply) : '(khaali reply aaya)';
  } catch (e) {
    out.textContent = 'AI se connect nahi hua: ' + e.message;
  }
}
document.getElementById('preview').addEventListener('click', previewReply);

// ---------- Global Stop all (engine ke globalStop flag par) ----------
document.getElementById('stopAll').addEventListener('click', () => {
  chrome.storage.local.set({ globalStop: { at: Date.now() } }, () => {
    const s = document.getElementById('stopStatus');
    s.textContent = ' Sab chats band. Dobara on karne tak koi AI request nahi jayegi.';
  });
});


// ---------- Pairing: code paste -> device token (token sirf is device ke local storage mein) ----------
document.getElementById('pairBtn').addEventListener('click', async () => {
  const st = document.getElementById('pairStatus');
  const code = document.getElementById('pairCode').value.trim();
  try {
    const parts = code.split('.');
    if (parts[0] !== 'cc1p' || parts.length !== 3) throw new Error('ye pairing code nahi lagta');
    const meta = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const url = String(meta.u || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9.-]+\.onrender\.com$/i.test(url)) throw new Error('code mein valid hosted URL nahi');
    st.textContent = 'Server so raha ho sakta hai - jaagne mein thoda time lag sakta hai, ruko...';
    const res = await fetch(url + '/pair/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || ('server ne mana kiya (' + res.status + ')'));
    await chrome.storage.local.set({ authToken: data.token });
    await chrome.storage.sync.set({ backendUrl: url });
    document.getElementById('backendUrl').value = url;
    document.getElementById('authToken').value = data.token;
    document.getElementById('pairCode').value = '';
    st.textContent = 'Connected: ' + new URL(url).host + '. Ab character save karke use kar sakte ho.';
  } catch (e) {
    st.textContent = 'Connect nahi hua: ' + (e && e.message ? e.message : e);
  }
});


// ---------- Own-key mode: key sirf chrome.storage.local (is device) mein ----------
(function ownKey() {
  const $ = (id) => document.getElementById(id);
  const st = $('aiStatus');
  function syncRows() {
    const custom = $('aiProvider').value === 'custom';
    $('aiBaseRow').style.display = custom ? '' : 'none';
    $('aiModel').placeholder = custom ? 'model name (zaroori)' : 'openai/gpt-oss-120b';
  }
  $('aiProvider').addEventListener('change', syncRows);
  chrome.storage.local.get('aiConfig', (r) => {
    const c = r.aiConfig;
    if (c && c.apiKey) {
      $('aiProvider').value = c.provider === 'custom' ? 'custom' : 'groq';
      $('aiModel').value = c.model || '';
      $('aiBaseUrl').value = c.baseUrl || '';
      $('aiKey').value = '';
      $('aiKey').placeholder = 'Key saved hai (chhupi hui). Badalni ho to nayi paste karo.';
      st.textContent = 'Own-key mode ON (' + (c.provider === 'custom' ? 'custom' : 'Groq') + '). AI replies seedha provider se aati hain.';
    }
    syncRows();
  });
  $('aiSaveBtn').addEventListener('click', async () => {
    try {
      const prev = (await chrome.storage.local.get('aiConfig')).aiConfig || {};
      const provider = $('aiProvider').value === 'custom' ? 'custom' : 'groq';
      const typed = $('aiKey').value.trim();
      const apiKey = typed || prev.apiKey || '';
      if (!apiKey) throw new Error('pehle API key paste karo');
      const cfg = { provider, apiKey, model: $('aiModel').value.trim(), baseUrl: $('aiBaseUrl').value.trim() };
      const r = self.CCAI.resolveProvider(cfg); // validate
      if (provider === 'custom') {
        const origin = new URL(r.baseUrl).origin + '/*';
        const have = await chrome.permissions.contains({ origins: [origin] });
        if (!have) {
          const ok = await chrome.permissions.request({ origins: [origin] });
          if (!ok) throw new Error('is provider ka access allow nahi hua');
        }
      }
      st.textContent = 'Test ho raha hai...';
      await chrome.storage.local.set({ aiConfig: cfg });
      const res = await chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload: { character: { name: 'Test', tone: 'friendly' }, messages: [{ role: 'user', content: 'hi' }] } });
      if (!res || !res.ok) {
        await chrome.storage.local.set({ aiConfig: prev.apiKey ? prev : null });
        if (!prev.apiKey) await chrome.storage.local.remove('aiConfig');
        throw new Error((res && res.error) || 'test fail');
      }
      $('aiKey').value = '';
      $('aiKey').placeholder = 'Key saved hai (chhupi hui). Badalni ho to nayi paste karo.';
      st.textContent = 'Connected: key kaam kar rahi hai. Test reply mil gaya. Ab character save karke chat mein use karo.';
    } catch (e) {
      st.textContent = 'Save nahi hua: ' + (e && e.message ? e.message : e);
    }
  });
  $('aiClearBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove('aiConfig');
    $('aiKey').value = '';
    $('aiKey').placeholder = 'gsk_...';
    st.textContent = 'Key hata di gayi. Ab hosted backend (pairing) ya nayi key use hogi.';
  });
})();
