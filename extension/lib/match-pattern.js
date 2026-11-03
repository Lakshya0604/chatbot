// match-pattern.js - Chrome match-pattern string ko RegExp mein (background guard ke liye).
// Plain script: background.js importScripts karta hai, tests node mein load kar sakte hain.
(function (global) {
  'use strict';
  function matchPatternToRe(p) {
    const m = String(p || '').match(/^(\*|http|https|file|ftp):\/\/([^/]*)(\/.*)$/);
    if (!m) return null;
    const scheme = m[1] === '*' ? 'https?' : m[1];
    const host = m[2]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/^\*\\\./, '([^/]*\\.)?') // "*.example.com" -> optional subdomain
      .replace(/\*/g, '[^/]*');
    const path = m[3]
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + scheme + '://' + host + path + '$');
  }
  // Kya is URL ke liye manifest mein pehle se static content-script adapter hai?
  function hasStaticAdapter(manifest, url) {
    const list = (manifest && manifest.content_scripts) || [];
    return list.some((cs) => (cs.matches || []).some((p) => {
      const re = matchPatternToRe(p);
      return re && re.test(url);
    }));
  }
  global.CCMatchPattern = { matchPatternToRe, hasStaticAdapter };
})(typeof self !== 'undefined' ? self : globalThis);
