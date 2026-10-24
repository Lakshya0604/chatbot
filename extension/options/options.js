// options.js - settings page ka logic.
// Fields ko chrome.storage.sync mein save karta hai, taaki content script
// har chat mein same character use kare.

const FIELDS = [
  'name', 'gender', 'role', 'tone', 'humour', 'replyLength',
  'age', 'backstory', 'vocabulary', 'defaultMood',
  'topics', 'boundaries', 'styleExamples', 'backendUrl', 'authToken',
];
const CHECKBOXES = ['playful', 'flirting'];

function loadSettings() {
  chrome.storage.sync.get(['character', 'backendUrl', 'authToken'], (result) => {
    const character = result.character || {};
    FIELDS.forEach((field) => {
      const el = document.getElementById(field);
      if (!el) return;
      if (field === 'backendUrl') {
        el.value = result.backendUrl || 'http://127.0.0.1:8787';
      } else if (field === 'authToken') {
        el.value = result.authToken || '';
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

  chrome.storage.sync.set({ character, backendUrl, authToken }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

document.getElementById('save').addEventListener('click', saveSettings);
loadSettings();


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
