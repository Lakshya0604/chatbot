// options.js - settings page ka logic.
// Fields ko chrome.storage.sync mein save karta hai, taaki content script
// har chat mein same character use kare.

const FIELDS = [
  'name', 'gender', 'role', 'tone', 'humour', 'replyLength',
  'topics', 'boundaries', 'styleExamples', 'backendUrl', 'authToken',
];
const CHECKBOXES = ['playful', 'flirting'];

function loadSettings() {
  chrome.storage.sync.get(['character', 'backendUrl'], (result) => {
    const character = result.character || {};
    FIELDS.forEach((field) => {
      const el = document.getElementById(field);
      if (!el) return;
      if (field === 'backendUrl') {
        el.value = result.backendUrl || 'http://127.0.0.1:8787';
      } else if (field === 'authToken') {
        el.value = result.authToken || '';
      } else {
        el.value = character[field] || '';
      }
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
