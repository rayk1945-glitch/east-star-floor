/* Note photo upload queue (20261017d). Shared by the page (index.html) and the service worker (sw.js).
 * Every new note photo is written here (IndexedDB "esPhotoQ") BEFORE it is sent, so backing out of the app, the app going
 * to the background, a reload or a lost connection never loses it. Whoever runs first (page, Background Sync in sw.js,
 * or the next app open) claims the entry with a short lease and sends it with the same customerFileAdd call the page always
 * used (the server attaches the photo to its note in that call). The server has no upload id, so duplicates are avoided by
 * the queue: one owner at a time (lease, renewed while sending), and an entry that was already sent once without a clear
 * answer is first looked for on the server (same bytes in that note) before it is sent again. */
(function (G) {
  'use strict';
  var DB = 'esPhotoQ', ST = 'q', LEASE = 25000, BEAT = 8000;
  function open() { return new Promise(function (res, rej) { var o = indexedDB.open(DB, 1);
    o.onupgradeneeded = function () { o.result.createObjectStore(ST, { keyPath: 'uid' }); };
    o.onerror = function () { rej(o.error); }; o.onsuccess = function () { res(o.result); }; }); }
  function tx(mode, fn) { return open().then(function (db) { return new Promise(function (res, rej) {
    var t = db.transaction(ST, mode), st = t.objectStore(ST), out; fn(st, function (v) { out = v; });
    t.oncomplete = function () { db.close(); res(out); }; t.onerror = t.onabort = function () { db.close(); rej(t.error); }; }); }); }
  function put(e) { return tx('readwrite', function (st) { st.put(e); }); }
  function get(uid) { return tx('readonly', function (st, set) { var r = st.get(uid); r.onsuccess = function () { set(r.result || null); }; }); }
  function all() { return tx('readonly', function (st, set) { var r = st.getAll(); r.onsuccess = function () { set(r.result || []); }; }); }
  function del(uid) { return tx('readwrite', function (st) { st.delete(uid); }); }
  /** Atomic read-modify-write (one IndexedDB transaction, so page and service worker never both win). fn(e) -> new e | null to leave it. */
  function update(uid, fn) { return tx('readwrite', function (st, set) { var r = st.get(uid);
    r.onsuccess = function () { var e = r.result; if (!e) { set(null); return; } var n = fn(e); if (n) { st.put(n); set(n); } else set(null); }; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function realNote(e) { return e && e.noteId && String(e.noteId).indexOf('tmp-') !== 0; }
  function open_(e, now) { return e.state === 'pending' || (e.state === 'sending' && (e.lease || 0) < now); }
  function sendable(e) { return realNote(e) && e.token && !e.authWait && open_(e, Date.now()); }
  function b64(d) { return String(d || '').replace(/^data:[^,]*,/, ''); }
  function post(e, body, keepalive) { body.token = e.token;
    var ac = !keepalive && typeof AbortController === 'function' ? new AbortController() : null, to = ac ? setTimeout(function () { ac.abort(); }, 90000) : 0;   // a hung request never holds a photo forever
    return fetch(e.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', keepalive: !!keepalive, signal: ac ? ac.signal : undefined })
      .then(function (r) { clearTimeout(to); return r; }, function (er) { clearTimeout(to); throw er; })
      .then(function (r) { return r.text().then(function (t) { var j; try { j = JSON.parse(typeof window !== 'undefined' && typeof window.unMoji === 'function' ? window.unMoji(t) : t); } catch (x) { var er = new Error('Unexpected server reply (HTTP ' + r.status + ').'); er.net = true; throw er; }
        if (!j.ok) { var e2 = new Error(j.error || 'Something went wrong.'); e2.auth = !!j.auth; throw e2; } return j.data; }); },
        function () { var er = new Error('No connection to the server. Check your internet and try again.'); er.net = true; throw er; }); }
  function claim(uid, owner) { return update(uid, function (e) { var now = Date.now(); if (!realNote(e) || !e.token || e.authWait || !open_(e, now)) return null;
    e.state = 'sending'; e.lease = now + LEASE; e.owner = owner; e.tries = (e.tries || 0) + 1; return e; }); }
  /** Was it stored on the server by an earlier send whose answer never came back? Same bytes in that note = yes. */
  function findSent(e) {
    return post(e, { action: 'customerGet', id: e.custId }).then(function (c) {
      var n = (c.notes || []).filter(function (x) { return x.id === e.noteId; })[0];
      if (!n) { var gone = new Error('The note for this photo is gone.'); gone.perm = true; throw gone; }
      return all().then(function (list) {
        var mine = {}; list.forEach(function (x) { if (x.fileId && x.uid !== e.uid) mine[x.fileId] = 1; });
        var before = {}; (e.before || []).forEach(function (f) { before[f] = 1; });
        var cand = (n.photos || []).filter(function (f) { return !before[f] && !mine[f]; }).reverse().slice(0, 8), want = b64(e.data);
        var i = 0; function next() { if (i >= cand.length) return null; var f = cand[i++];
          return post(e, { action: 'customerFile', id: e.custId, fileId: f }).then(function (r) { return r && b64(r.data) === want ? { fileId: f, photos: n.photos, noteId: n.id, id: e.custId, note: null, found: true } : next(); }, function (er) { if (er.net) throw er; return next(); }); }
        return next();
      });
    });
  }
  /** Claim + send one entry. Resolves with the entry after (done | failed | pending), or null when someone else holds it. */
  function send(uid, owner) {
    return claim(uid, owner).then(function (e) { if (!e) return null;
      var beat = setInterval(function () { update(uid, function (x) { if (x.state !== 'sending' || x.owner !== owner) return null; x.lease = Date.now() + LEASE; return x; }).catch(function () {}); }, BEAT);
      var first = e.sent ? findSent(e) : Promise.resolve(null);
      return first.then(function (hit) { if (hit) return hit;
        if (e.cancel) { var cx = new Error('Removed before it was sent.'); cx.perm = true; throw cx; }   // removed while pending: never send it
        return update(uid, function (x) { x.sent = true; return x; }).then(function () {
          return post(e, { action: 'customerFileAdd', id: e.custId, noteId: e.noteId, kind: 'photo', file: { data: e.data, mimeType: e.mime || 'image/jpeg' } }); });
      }).then(function (r) {
        return update(uid, function (x) { x.state = 'done'; x.fileId = r.fileId; x.result = { fileId: r.fileId, photos: r.photos || null, noteId: r.noteId || x.noteId, note: r.note || null }; x.lease = 0; x.doneAt = Date.now(); x.by = owner; return x; });
      }, function (er) {
        return update(uid, function (x) { x.lease = 0; x.err = er.message;
          if (er.net) x.state = 'pending';                                // answer lost: x.sent stays, so the next try looks on the server first
          else if (er.auth) { x.state = 'pending'; x.authWait = true; }   // signed out: waits for the next sign-in (new token)
          else if (er.perm || /not found|gone|max \d+ photos|not allowed|too big|no file/i.test(er.message)) x.state = 'failed';
          else { x.state = 'pending'; x.sent = false; } return x; }).then(function (x) { if (x) { x._net = !!er.net; x._auth = !!er.auth; } return x; });
      }).then(function (x) { clearInterval(beat); return x; }, function (er) { clearInterval(beat); throw er; });
    });
  }
  /** Page: send this one or wait for whoever has it. Rejects (so the page's save status shows "Not saved, tap to retry") on a failed try. */
  function wait(uid, owner) {
    function loop() { return get(uid).then(function (e) {
      if (!e || e.state === 'acked') return { gone: true, uid: uid };
      if (e.state === 'done' || e.state === 'failed') return e;
      if (!realNote(e)) return sleep(800).then(loop);
      if (e.authWait) throw new Error('Sign in again to send this photo.');
      if (sendable(e)) return send(uid, owner).then(function (x) { if (!x) return sleep(300).then(loop);
        if (x.state === 'pending') { var er = new Error(x.err || 'Photo not sent yet.'); er.network = !!x._net; throw er; } return x; });
      return sleep(1000).then(loop); }); }
    return loop();
  }
  /** Service worker / hand-off: send everything sendable, waiting out other owners' leases within a time budget. */
  function drain(owner, budgetMs) { var end = Date.now() + (budgetMs || 150000), done = [], left = false;
    function round() { return all().then(function (list) { var now = Date.now(), todo = list.filter(sendable), held = list.filter(function (e) { return realNote(e) && e.state === 'sending' && (e.lease || 0) >= now; });
      var p = todo.reduce(function (acc, e) { return acc.then(function () { return send(e.uid, owner).then(function (x) { if (x && x.state === 'done') done.push(x.uid); if (x && x.state === 'pending') left = true; }, function () { left = true; }); }); }, Promise.resolve());
      return p.then(function () { if (left || !held.length || Date.now() > end) return;
        var soon = Math.min.apply(null, held.map(function (e) { return e.lease; })) - Date.now() + 500;
        if (Date.now() + soon > end) { left = true; return; } return sleep(Math.max(500, soon)).then(round); }); }); }
    return round().then(function () { return all(); }).then(function (list) {
      var still = list.some(function (e) { return realNote(e) && e.token && !e.authWait && (e.state === 'pending' || e.state === 'sending'); });
      return { done: done, retry: left || still }; });
  }
  /** pagehide: a small photo (<60 KB) can still go out with keepalive; the answer may never come, so it counts as sent once. */
  function keepaliveSmall(owner) { return all().then(function (list) { list.filter(function (e) { return sendable(e) && !e.sent && String(e.data || '').length < 60000; }).forEach(function (e) {
    claim(e.uid, owner).then(function (x) { if (!x) return; return update(x.uid, function (y) { y.sent = true; y.lease = Date.now() + 15000; return y; }).then(function () {
      return post(x, { action: 'customerFileAdd', id: x.custId, noteId: x.noteId, kind: 'photo', file: { data: x.data, mimeType: x.mime || 'image/jpeg' } }, true).then(function (r) {
        return update(x.uid, function (y) { y.state = 'done'; y.fileId = r.fileId; y.result = { fileId: r.fileId, photos: r.photos || null, noteId: r.noteId || y.noteId, note: r.note || null }; y.lease = 0; y.by = owner + '-keepalive'; return y; }); }); }); }).catch(function () {}); }); }); }
  /** The page has the photo in its note: keep a small marker (no bytes) for a day so its id is never taken for another upload. */
  function ack(uid) { return update(uid, function (x) { x.state = 'acked'; x.data = null; x.ackAt = Date.now(); return x; }); }
  function prune() { return all().then(function (list) { return Promise.all(list.filter(function (e) { return e.state === 'acked' && Date.now() - (e.ackAt || 0) > 86400000; }).map(function (e) { return del(e.uid); })); }); }
  function retoken(user, token) { return all().then(function (list) { return Promise.all(list.filter(function (e) { return e.state !== 'acked' && e.user === user && (e.token !== token || e.authWait); }).map(function (e) {
    return update(e.uid, function (x) { x.token = token; x.authWait = false; return x; }); })); }); }
  G.PQ = { put: put, get: get, all: all, del: del, update: update, send: send, wait: wait, drain: drain, keepaliveSmall: keepaliveSmall, retoken: retoken, ack: ack, prune: prune, LEASE: LEASE, ok: typeof indexedDB !== 'undefined' };
})(typeof self !== 'undefined' ? self : this);
