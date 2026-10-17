/* East Star floor app (sync-resume): "pick up where I left off" + "follow my other device".
 *  1) Resume (same device, per login, localStorage "esResume:<account>:<name>"): reopening the app goes back to the same tab,
 *     open project, open note, scroll spot, and the search words + filter chips. A snapshot older than 12 h still reopens the
 *     project, but only after a fresh copy came from the server (never the old cache first).
 *  2) Return to the app (visible, focus, pageshow, online, wake from sleep = the clock jumped while the page was frozen, and every
 *     60 s while it stays open): index.html syncReturn() restarts the live sync at once (one full copy after > 10 min away), and
 *     the Adding-to bar's project is re-read when the Project tab is not showing it.
 *  3) Working context across this login's devices (server action 'userCtx', server v26): when the current
 *     project / target note ("Adding to") is changed here it is sent to the server; on return, if another device changed it more
 *     recently, this one follows ("Switched to #1059 · Note 2 from your other device") — but never while something is being typed,
 *     a sheet is open, or changes are still waiting to save: then it waits until the user is idle. Old server (no 'userCtx'): off, silently.
 * index.html hooks: enterApp -> ESRES.start(), renderCustBar -> ESRES.curSet(curCust), checkIdleClose -> ESRES.idleHold(), syncReturn(). */
(function () {
  'use strict';
  var STALE_MS = 12 * 3600000, CHECK_MS = 60000, BEAT_MS = 15000, WAKE_GAP = 60000;
  var R = {}, restoring = false, readyFor = '', lastKey = '', lastSnapT = 0, snapT = null;
  var lastType = 0, lastPtr = 0, lastBeat = Date.now(), lastVisible = Date.now(), lastRet = 0, curRefAt = 0;
  var CTX = { off: false, busy: false, busyAt: 0, pending: null, following: false, pubT: null, unsent: null, retryT: null, holdUntil: 0 };
  function g(name) { try { return window[name]; } catch (e) { return undefined; } }          // page globals (index.html, classic script)
  function $(id) { return document.getElementById(id); }
  function sess() { return g('session'); }
  function isReady() { var s = sess(); return !!readyFor && !!s && readyFor === login() + '|' + s.token; }   // per login: a fresh sign-in is not "ready" until its own start()
  function login() { var s = sess(); return s ? (s.account || '') + ':' + String(s.name || '').toLowerCase() : ''; }
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return null; }
  function dev() { var d = null; try { d = localStorage.getItem('esDev'); if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('esDev', d); } } catch (e) { d = d || 'dx'; } return d; }
  function zh() { return !!(window.I18N && I18N.lang() === 'zh'); }
  function timed(p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { var e = new Error('No answer from the server.'); e.network = true; rej(e); }, ms);
    p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  function tmpId(x) { return !x || /^tmp/.test(String(x)); }
  function onTab() { var p = document.querySelector('.page.on'); return p ? p.id.replace(/^p-/, '') : 'search'; }
  function custOpen() { return g('custOpen'); }

  // ------------------------------------------------------------------ 1) resume snapshot
  function rk() { return 'esResume:' + login(); }
  function snap() {
    if (!isReady() || restoring || !sess() || document.getElementById('app').classList.contains('hidden')) return;
    var o = ls(rk()) || {}, tab = onTab(), c = custOpen(), q = ($('q') && $('q').value || '').trim();
    o.tab = tab; o.t = Date.now(); o.ys = o.ys || {}; o.ys[tab] = Math.round(window.scrollY || 0);
    o.q = q; o.f = q && q === g('sQ') ? JSON.parse(JSON.stringify(g('sF') || {})) : {};
    if (typeof g('sfFold') === 'boolean') o.sf = g('sfFold') ? 1 : 0;                    // 20261017k: Search filter rows folded
    if (c && c.id && c.notes && !tmpId(c.id)) { if (!idleBlank(c.id)) { o.p = c.id; var n = g('noteOpenId'); o.n = n && !tmpId(n) ? n : ''; o.idle = ''; } else o.idle = c.id; }   // the auto "new project after 30 min idle" is not a resume spot until used
    else if (tab === 'cust') { o.p = ''; o.n = ''; }
    ls(rk(), o); lastSnapT = Date.now();
  }
  /** index.html checkIdleClose() made this blank project by itself and nobody has used it yet. */
  function idleBlank(id) {
    var b = g('idleBlankId'); if (!b || b !== id) return false;
    var c = custOpen(), cc = g('curCust'), used = (cc && cc.id === id && cc.count > 0);
    if (!used && c && c.id === id) used = (c.notes || []).length > 1 || (c.notes || []).some(function (n) { return (n.items || []).length || String(n.text || '').trim() || (n.photos || []).length; }) || !!String(c.city || '').trim() || !!String(c.name || '').trim();
    if (!used && $('nText') && c && c.id === id && String($('nText').value || '').trim()) used = true;
    if (used) { try { window.idleBlankId = ''; } catch (e) {} }
    return !used;
  }
  R.idleBlank = idleBlank;
  function snapSoon(ms) { clearTimeout(snapT); snapT = setTimeout(snap, ms == null ? 400 : ms); }
  R.snap = snap;
  /** Called by enterApp after sign-in / reopen. Returns true when it took over the first screen. */
  R.start = function () {
    readyFor = login() + '|' + sess().token; CTX.pending = null; CTX.unsent = null; CTX.off = false; curRefAt = 0; lastKey = ckey(g('curCust'));            // what was already current here is not news for the other devices
    var s = ls(rk()), age = s && s.t ? Date.now() - s.t : Infinity;
    setTimeout(function () { onReturn('open', 0); }, 800);                      // other device moved on while this one was closed?
    if (!s || !s.tab) return false;
    restoring = true;
    // the 30-min idle auto-close left an unused blank project as "Adding to": the resume spot (last real project) wins
    var cc0 = g('curCust'), idleBack = !!(s.idle && s.p && cc0 && cc0.id === s.idle);
    if (idleBack) { try { window.idleBlankId = s.idle; } catch (e) {} }
    var done = function () {
      if (idleBack) { var cc = g('curCust'), c = custOpen(); if (!(c && c.id === s.p)) c = g('pcGet')('c:' + s.p);
        if (cc && cc.id === s.idle && c && c.notes) { var n = c.notes.filter(function (x) { return x.id === s.n; })[0] || c.notes[0]; if (n) { g('setCur')(c, n); lastKey = ckey(g('curCust')); } } }
      restoring = false; snapSoon(0); };
    try {
      if ((s.sf === 0 || s.sf === 1) && g('setSfFold') && !!s.sf !== g('sfFold')) g('setSfFold')(!!s.sf, false);
      if (s.q && s.q.length >= 2) { window.sQ = s.q; window.sF = s.f || {}; g('runSearch')(s.q); } else if (g('renderRecent')) g('renderRecent')();
      if (s.tab === 'cust' && s.p) openProject(s.p, s.n, age > STALE_MS).then(function () { scrollBack(s.ys && s.ys.cust, 'cust'); }).then(done, done);
      else if (s.tab === 'cust') { g('go')('cust'); done(); }
      else if (s.tab !== 'search') { g('go')(s.tab); scrollBack(s.ys && s.ys[s.tab], s.tab).then(done, done); }
      else { if (s.p && !tmpId(s.p)) preload(s.p, s.n); waitResults().then(function () { return scrollBack(s.ys && s.ys.search, 'search'); }).then(done, done); }
    } catch (e) { done(); return false; }
    return true;
  };
  /** Open a project on the Project tab; stale = fetch a fresh copy first (spinner meanwhile), else cache first as usual. */
  function openProject(id, noteId, stale) {
    var oc = g('openCust');
    if (!stale) { oc(id, null, noteId || null); return waitRender(); }
    g('go')('cust', true);
    var d = $('cuDetail'); if (d) d.innerHTML = '<div class="card"><div class="spinner"></div><div class="hint" style="text-align:center">Loading the latest…</div></div>';
    return timed(g('serverApi')('customerGet', { id: id }), 20000).then(function (c) {
      if (onTab() !== 'cust' || (custOpen() && custOpen().id && custOpen().id !== id)) return;   // they went elsewhere meanwhile
      c = g('adoptContacts')(c, g('pcGet')('c:' + id)); g('pcSave')(c);
      oc(id, c, noteId && (c.notes || []).some(function (n) { return n.id === noteId; }) ? noteId : null);
      return waitRender();
    }, function () { if (onTab() === 'cust') oc(id, null, noteId || null); return waitRender(); });   // offline: the cached copy, as before
  }
  /** Search tab restore: keep the project the user had open warm so the Project tab shows it at once. */
  function preload(id, noteId) { var m = g('noteOpenMem'); if (m && noteId && !(id in m)) m[id] = noteId; }
  function waitFor(f, ms) { return new Promise(function (res) { var end = Date.now() + ms; (function t() { if (f() || Date.now() > end) res(); else setTimeout(t, 120); })(); }); }
  function waitRender() { return waitFor(function () { var d = $('cuDetail'); return d && d.innerHTML && !d.querySelector(':scope > .card > .spinner'); }, 8000).then(function () { return new Promise(function (r) { setTimeout(r, 450); }); }); }
  function waitResults() { return waitFor(function () { var r = $('results'); return !r || !r.querySelector('.spinner'); }, 15000); }
  function scrollBack(y, tab) {
    var t0 = Date.now(), moved = lastPtr > t0 || lastType > t0;
    if (!y || onTab() !== tab || moved) return Promise.resolve();
    return new Promise(function (res) { var n = 0; (function tryIt() {                 // content may still be growing (photos, results)
      if (onTab() !== tab || lastPtr > t0 || lastType > t0) return res();
      window.scrollTo(0, y); if (Math.abs(window.scrollY - y) < 4 || ++n > 12) return res(); setTimeout(tryIt, 200); })(); });
  }

  // ------------------------------------------------------------------ 3) working context across devices
  function sk() { return 'esCtxSeen:' + login(); }
  function seen() { return Number(ls(sk())) || 0; }
  function seenMax(t) { if (Number(t) > seen()) ls(sk(), Number(t)); }
  function ckey(cc) { return cc && cc.id && cc.noteId ? cc.id + '|' + cc.noteId : ''; }
  /** index.html renderCustBar(): the Adding-to bar is being painted for curCust. Only a real change made HERE is sent. */
  R.curSet = function (cc) {
    if (!isReady()) return;
    var k = ckey(cc); if (!k || k === lastKey) return;
    if (tmpId(cc.id) || tmpId(cc.noteId)) return;                               // the real note id comes a moment later (saveCur again)
    if (!CTX.following && idleBlank(cc.id)) return;                              // auto "new project after 30 min idle": sent once it is used (items / text)
    lastKey = k;
    if (CTX.following || restoring || g('idleBusy')) return;                     // following the other device / auto "new project after 30 min idle"
    publish(cc);
  };
  function publish(cc) {
    CTX.pending = null;                                                          // a choice made here beats anything older from elsewhere
    CTX.unsent = { p: cc.id, n: cc.noteId, pl: String(cc.name || '').slice(0, 80), nl: String(cc.noteTitle || '').slice(0, 80), d: dev() };
    clearTimeout(CTX.pubT); CTX.pubT = setTimeout(sendCtx, 600);
  }
  function sendCtx() {
    var s = CTX.unsent; if (!s || CTX.off || !sess()) return;
    timed(g('serverApi')('userCtx', { set: s }), 20000).then(function (r) { if (CTX.unsent === s) CTX.unsent = null; if (r && r.ctx && r.ctx.t) seenMax(r.ctx.t); },
      function (er) { if (offErr(er)) { CTX.off = true; CTX.unsent = null; } });          // offline: sent again on the next return
  }
  function offErr(er) { return /Unknown action|Warehouse logins/i.test(er && er.message || ''); }
  function check() {
    if (CTX.off || !isReady()) return Promise.resolve();
    if (CTX.unsent) { sendCtx(); return Promise.resolve(); }
    if (CTX.busy && Date.now() - CTX.busyAt < 20000) return Promise.resolve();
    CTX.busy = true; CTX.busyAt = Date.now(); var who = login();
    return timed(g('serverApi')('userCtx', {}), 15000).then(function (r) {
      var c = r && r.ctx; if (!c || !c.t || login() !== who) return;
      if (c.d === dev()) { seenMax(c.t); return; }
      if (c.t <= seen()) return;
      if (ckey(g('curCust')) === c.p + '|' + c.n) { seenMax(c.t); return; }    // already on it
      CTX.pending = c; return tryFollow();
    }, function (er) { if (offErr(er)) CTX.off = true; }).then(function () { CTX.busy = false; }, function () { CTX.busy = false; });
  }
  /** Something here must not be pulled away: typing, a sheet / photo / confirm open, a + New project swap, unsaved changes. */
  function interacting() {
    var ae = document.activeElement, now = Date.now();
    if (ae && ae !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return 'typing';
    if (now - lastType < 6000) return 'typing';
    if (now - lastPtr < 2500) return 'touch';
    if (($('sheet') && $('sheet').classList.contains('on')) || ($('photoZoom') && $('photoZoom').classList.contains('on')) || document.querySelector('.cfm.on, #cfm.on, .qi-sheet.on')) return 'sheet';
    if (g('npHold') || g('idleBusy') || g('pickThen')) return 'busy';
    try { if ((g('isBatchDirty') && g('isBatchDirty')()) || g('noteDirty') || (g('OB') && g('OB').pending()) || Object.keys(g('saveQ') || {}).length || Object.keys(g('saveRun') || {}).length || Object.keys(g('tmpNotes') || {}).length) return 'saving'; } catch (e) {}
    return '';
  }
  R.interacting = interacting;
  function tryFollow() {
    clearTimeout(CTX.retryT); CTX.retryT = null;
    var c = CTX.pending; if (!c) return Promise.resolve();
    if (document.hidden) return Promise.resolve();                               // next return
    if (interacting()) { CTX.retryT = setTimeout(tryFollow, 2500); return Promise.resolve(); }
    CTX.holdUntil = Date.now() + 15000;
    return timed(g('serverApi')('customerGet', { id: c.p }), 15000).then(function (proj) {
      if (CTX.pending !== c) return;                                             // something newer meanwhile (or a choice made here)
      if (interacting()) { CTX.retryT = setTimeout(tryFollow, 2500); return; }   // they started typing while it loaded: never yank
      var notes = proj.notes || [], n = notes.filter(function (x) { return x.id === c.n; })[0] || notes[0];
      if (!n) { CTX.pending = null; seenMax(c.t); return; }
      CTX.pending = null; seenMax(c.t); CTX.following = true;
      try {
        proj = g('adoptContacts')(proj, g('pcGet')('c:' + proj.id)); g('pcSave')(proj);
        g('setCur')(proj, n); lastKey = ckey(g('curCust'));
        if (onTab() === 'cust') g('openCust')(proj.id, proj, n.id);
        var label = proj.num ? '#' + proj.num : g('projLabel')(proj), nt = n.title || '';
        g('toast')(zh() ? '已切换到 ' + label + (nt ? ' · ' + nt : '') + '（来自你的其他设备）' : 'Switched to ' + label + (nt ? ' · ' + nt : '') + ' from your other device');
        if (g('touchIdle')) g('touchIdle')();
      } finally { CTX.following = false; }
      snapSoon(600);
    }, function (er) { if (/not found|no access|not shared/i.test(er && er.message || '')) { CTX.pending = null; seenMax(c.t); } else CTX.retryT = setTimeout(tryFollow, 10000); })
      .then(function () { CTX.holdUntil = 0; }, function () { CTX.holdUntil = 0; });
  }
  R.idleHold = function () { return CTX.busy || (CTX.holdUntil > Date.now()); };

  // ------------------------------------------------------------------ 2) coming back to the app
  /** The Adding-to bar's project when the Project tab is not showing it: re-read its note title / count (another device may have added). */
  function refreshCurBar(every) {
    var cc = g('curCust'), c = custOpen(); if (!cc || !cc.id || tmpId(cc.id) || Date.now() - curRefAt < (every || 20000)) return;
    if (onTab() === 'cust' && c && c.id === cc.id) return;                      // the live sync has it
    curRefAt = Date.now();
    timed(g('serverApi')('customerGet', { id: cc.id }), 15000).then(function (p) {
      var now = g('curCust'); if (!now || now.id !== p.id) return;
      var n = (p.notes || []).filter(function (x) { return x.id === now.noteId; })[0]; if (!n) return;
      var shown = custOpen(); if (!(shown && shown.id === p.id && onTab() === 'cust')) g('pcSave')(adopt(p));
      if (now.count !== (n.items || []).length || now.noteTitle !== n.title || now.name !== g('projLabel')(p)) { now.count = (n.items || []).length; now.noteTitle = n.title; now.name = g('projLabel')(p); g('saveCur')(); }
    }, function () {});
  }
  function adopt(p) { try { return g('adoptContacts')(p, g('pcGet')('c:' + p.id)); } catch (e) { return p; } }
  function onReturn(why, awayMs) {
    if (!isReady() || document.hidden) return;
    var now = Date.now(); if (why !== 'open' && why !== 'tick' && now - lastRet < 2500) return; lastRet = now;
    if (why !== 'open' && why !== 'tick' && typeof window.syncReturn === 'function') { try { window.syncReturn(why, awayMs || 0); } catch (e) {} }
    check().then(function () { if (!CTX.pending) refreshCurBar(why === 'tick' ? 300000 : 20000); });   // idle tick: the bar every 5 min only
  }
  R._return = onReturn;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { snap(); lastVisible = Date.now(); return; }
    var away = Date.now() - lastVisible; lastBeat = Date.now();
    setTimeout(function () { onReturn('visible', away); }, 0);                  // after index.html's own visibilitychange work
  });
  window.addEventListener('focus', function () { setTimeout(function () { onReturn('focus', Date.now() - lastVisible); }, 0); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) setTimeout(function () { onReturn('pageshow', Date.now() - lastVisible); }, 0); });
  window.addEventListener('online', function () { setTimeout(function () { onReturn('online', 0); }, 300); });
  window.addEventListener('pagehide', snap);
  window.addEventListener('blur', function () { lastVisible = Date.now(); snap(); });
  /** Heartbeat: a frozen / sleeping PC wakes up without any event (the window stayed "visible"); the clock jump gives it away. */
  setInterval(function () {
    var now = Date.now(), gap = now - lastBeat; lastBeat = now;
    if (document.hidden) return;
    if (gap > WAKE_GAP) { onReturn('wake', gap); return; }
    lastVisible = now;
    if (now - lastRet > CHECK_MS) onReturn('tick', 0);                          // open but idle: check the other devices once a minute
  }, BEAT_MS);
  ['keydown', 'input'].forEach(function (ev) { document.addEventListener(ev, function () { lastType = Date.now(); snapSoon(); }, true); });
  ['pointerdown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { lastPtr = Date.now(); }, { capture: true, passive: true }); });
  document.addEventListener('click', function () { snapSoon(500); }, true);
  window.addEventListener('scroll', function () { snapSoon(500); }, { passive: true });
  document.addEventListener('focusout', function () { if (CTX.pending) { clearTimeout(CTX.retryT); CTX.retryT = setTimeout(tryFollow, 1500); } }, true);
  R._ctx = CTX; R._dev = dev;
  window.ESRES = R;
})();
