/* Service worker (20261017d): ONLY finishes queued note photo uploads (photoq.js) in the background.
 * No fetch handler and no cache: every page request still goes to the network as before, so the version.json update check
 * and GitHub Pages caching work exactly as without it. Background Sync ("photoq") where the browser has it (Android Chrome);
 * the page also hands the queue over here when it goes to the background. iOS: the page retries on open / return instead. */
importScripts('photoq.js');
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
function tell(r) { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: 'photoq', done: r.done }); }); return r; }); }
self.addEventListener('sync', function (e) {
  if (e.tag !== 'photoq') return;
  e.waitUntil(PQ.drain('sw-sync', 150000).then(tell).then(function (r) { if (r.retry) throw new Error('photos left, retry later'); }));   // a rejected sync is retried by the browser with back-off
});
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'photoq-drain') return;
  e.waitUntil(PQ.drain('sw-msg', 120000).then(tell).catch(function () {}));
});
