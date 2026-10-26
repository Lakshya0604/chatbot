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
  const authToken = document.getElementById('authToken').value.trim();
  out.textContent = 'AI se poochha ja raha hai...';
  try {
    const res = await fetch(backendUrl.replace(/\/$/, '') + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chatbot-Token': authToken },
      body: JSON.stringify({
        character: collectCharacter(),
        messages: [{ role: 'user', content: sample }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { out.textContent = 'Error: ' + (data.error || res.status); return; }
    out.textContent = data.reply ? ('AI: ' + data.reply) : '(khaali reply aaya)';
  } catch (e) {
    out.textContent = 'Backend se connect nahi hua: ' + e.message;
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
