/* East Star floor app: project live sync helpers. No DOM here: index.html wires them up and test-sync/ runs them in node.
 *  - Outbox: every project write (note text, item qty / note / add / remove / order, contact info, sold, voice text)
 *    goes into a queue that is kept in localStorage, and is sent as ONE projBatch request (one server lock). Each op has
 *    an opId, so sending it again (lost reply, offline, reload) never applies it twice. No connection: the queue stays,
 *    retries with back-off and on 'online', and newer edits of the same field replace the queued one (coalesce).
 *  - mergeProject: folds a fresh server copy of a project into the one on screen, per note and per line (last write
 *    wins by the line's server time u), without touching a field that is being typed in or still has a local change. */
(function (root) {
  'use strict';
  var BATCHED = { noteSave: 1, noteDelete: 1, customerItem: 1, customerSave: 1, customerSold: 1, customerVoiceText: 1 };
  function handles(action, data) {
    if (!BATCHED[action]) return false;
    if (action === 'customerSave') return !!(data && data.customer && data.customer.id);     // a NEW project is made right away, not queued
    return true;
  }
  /** Ops that carry the full latest value of one thing: a newer one replaces a queued older one. */
  function coalesceKey(a, d) {
    if (a === 'noteSave' && d.noteId && d.title != null && d.text != null) return 'ns:' + d.id + ':' + d.noteId;
    if (a === 'customerItem' && d.op === 'set') return 'ls:' + d.id + ':' + d.noteId + ':' + d.lineId + (d.name != null ? ':v' : '');
    if (a === 'customerSave') return 'cs:' + d.customer.id;
    if (a === 'customerSold') return 'sold:' + d.id;
    if (a === 'customerVoiceText') return 'vt:' + d.id + ':' + d.fileId;
    return '';
  }
  function uid() { return 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function plain(d) { var o = JSON.parse(JSON.stringify(d || {})); delete o.token; delete o.action; delete o.opId; return o; }

  /** o = { send(ops) -> Promise<{results, revs}> (reject with er.network = true when there is no connection,
   *        er.unknownAction = true when the server is older), sendOne(action, data) -> Promise (old server fallback),
   *        load() -> stored array, save(array), onState({pending, offline, busy}), onRevs(revs), onDone(), onAuth(),
   *        delay (ms to gather calls, default 15), setTimeout/clearTimeout (tests pass fakes) } */
  function Outbox(o) {
    var st = o.setTimeout || function (f, ms) { return setTimeout(f, ms); }, ct = o.clearTimeout || function (t) { clearTimeout(t); };
    var q = [], sending = null, timer = null, retryT = null, backoff = 0, offline = false, legacy = false, lastErr = '';
    function valid(e) { return e && e.opId && e.action && e.data && typeof e.data === 'object'; }
    function persist() { try { o.save(q.map(function (e) { return { opId: e.opId, action: e.action, data: e.data, sig: e.sig, ck: e.ck, t: e.t }; })); } catch (er) {} }
    function state() { if (o.onState) o.onState({ pending: q.length, offline: offline, busy: !!sending, error: lastErr }); }
    function drop(e) { var i = q.indexOf(e); if (i >= 0) q.splice(i, 1); }
    function err(x) { var e = new Error(x.error || 'Something went wrong.'); if (x.auth) e.auth = true; return e; }
    function load() { var a = []; try { a = o.load() || []; } catch (er) { a = []; }
      a.filter(valid).forEach(function (e) { e.live = []; e.sig = e.sig || e.action + '|' + JSON.stringify(e.data); q.push(e); }); }
    load();
    function schedule(ms) { if (timer || sending) return; timer = st(function () { timer = null; flush(); }, ms == null ? (o.delay == null ? 15 : o.delay) : ms); }
    function retryLater() { ct(retryT); backoff = Math.min(30000, backoff ? backoff * 2 : 2000); retryT = st(function () { retryT = null; flush(); }, backoff); }
    function sendLegacy(batch) {   // server without projBatch: one call per op, in order (no opId check there)
      var results = [];
      return batch.reduce(function (p, e) { return p.then(function () {
        return o.sendOne(e.action, e.data).then(function (d) { results.push({ ok: true, data: d }); },
          function (er) { if (er && er.network) throw er; results.push({ ok: false, error: er && er.message, auth: !!(er && er.auth) }); });
      }); }, Promise.resolve()).then(function () { return { results: results, revs: null }; }, function (er) {
        batch.slice(0, results.length).forEach(function (e, i) { e.doneEarly = results[i]; });   // the ones that went through are done
        throw er; });
    }
    function settle(e, x) { drop(e); e.live.forEach(function (l) { if (x.ok) l.res(x.data); else l.rej(err(x)); }); e.live = []; }
    function flush() {
      if (sending || !q.length) { state(); return; }
      var batch = q.slice(0, 40); sending = batch; batch.forEach(function (e) { e.sending = true; }); state();
      var ops = batch.map(function (e) { var x = JSON.parse(JSON.stringify(e.data)); x.action = e.action; x.opId = e.opId; return x; });
      (legacy ? sendLegacy(batch) : o.send(ops)).then(function (r) {
        sending = null; offline = false; backoff = 0; lastErr = ''; var auth = false;
        batch.forEach(function (e, i) { e.sending = false; var x = (r && r.results && r.results[i]) || { ok: false, error: 'No reply from the server.' }; if (x.auth) auth = true; settle(e, x); });
        persist();
        if (r && r.revs && o.onRevs) o.onRevs(r.revs);
        if (auth && o.onAuth) o.onAuth();
        if (o.onDone) o.onDone();
        state(); if (q.length) schedule(0);
      }, function (er) {
        sending = null;
        batch.forEach(function (e) { e.sending = false; if (e.doneEarly) { var x = e.doneEarly; delete e.doneEarly; settle(e, x); } });
        if (er && er.unknownAction && !legacy) { legacy = true; persist(); schedule(0); return; }
        if (er && er.network) { offline = true; persist(); state(); retryLater(); return; }
        // the server answered with an error for the whole call (busy, signed out...): callers get it, queued orphans retry later
        lastErr = (er && er.message) || 'Save failed';
        batch.forEach(function (e) { if (e.live.length) { drop(e); var ls = e.live; e.live = []; ls.forEach(function (l) { l.rej(er); }); } });
        persist(); state(); if (er && er.auth) { if (o.onAuth) o.onAuth(); return; } if (q.length) retryLater();
      });
    }
    this.handles = handles;
    this.call = function (action, data) {
      data = plain(data);
      var sig = action + '|' + JSON.stringify(data), ck = coalesceKey(action, data), self = this;
      return new Promise(function (res, rej) {
        var live = { res: res, rej: rej }, i, e;
        for (i = q.length - 1; i >= 0; i--) if (q[i].sig === sig) { q[i].live.push(live); schedule(); return; }        // the same op is queued: ride along
        if (ck) for (i = q.length - 1; i >= 0; i--) { e = q[i];
          if (e.ck === ck && !e.sending) { e.data = data; e.sig = sig; e.opId = uid(); e.t = Date.now(); e.live.push(live); persist(); state(); schedule(); return; }
          if (e.ck === ck) break; }
        q.push({ opId: uid(), action: action, data: data, sig: sig, ck: ck, t: Date.now(), live: [live] });
        persist(); state(); schedule();
      });
    };
    /** Back online / app reopened: send now. */
    this.kick = function () { ct(retryT); retryT = null; backoff = 0; if (q.length) schedule(0); };
    this.state = function () { return { pending: q.length, offline: offline, busy: !!sending, error: lastErr }; };
    this.pending = function () { return q.length; };
    this.orphans = function () { return q.filter(function (e) { return !e.live.length; }).length; };
    /** Reload the stored queue (another login signed in on this phone). */
    this.reset = function () { ct(timer); ct(retryT); timer = retryT = null; q = []; sending = null; offline = false; backoff = 0; load(); state(); };
  }

  // ---------------------------------------------------------------- merge a fresh server copy into the open project
  var INFO_KEYS = ['name', 'phone', 'email', 'city', 'tax', 'contacts'];
  var META_KEYS = ['label', 'num', 'owner', 'mine', 'shared', 'team', 'sharedToMe', 'sharedWith', 'sold', 'clientToken', 'voice', 'count', 'noteList', 'updated', 'updated_by', 'created', 'account'];
  var LINE_KEYS = ['name', 'desc', 'qty', 'note', 'photo'];
  function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
  function lineSame(a, b) { return LINE_KEYS.every(function (k) { return k === 'qty' ? Number(a.qty) === Number(b.qty) : String(a[k] == null ? '' : a[k]) === String(b[k] == null ? '' : b[k]); }); }
  function ids(list) { return (list || []).map(function (x) { return x.id; }).join(','); }
  /** g (guards): infoDirty, dirtyNotes{noteId}, heldLines{lineId}, ordDirty{noteId}, focusNote, focusLine, deletedNotes{noteId}, keepNotes{noteId}
   *  hooks.beforeChange(note): called once per note right BEFORE remote content replaces it (History keeps that version).
   *  Returns what changed so the page can repaint just that and flash it. */
  function mergeProject(L, R, g, hooks) {
    g = g || {}; hooks = hooks || {};
    var out = { info: false, meta: false, notes: [], lines: [], added: [], removed: [], skipped: false, any: false };
    INFO_KEYS.forEach(function (k) { if (!(k in R) || same(L[k], R[k])) return; if (g.infoDirty) { out.skipped = true; return; } L[k] = JSON.parse(JSON.stringify(R[k])); out.info = true; });
    META_KEYS.forEach(function (k) { if (k in R && !same(L[k], R[k])) { L[k] = JSON.parse(JSON.stringify(R[k])); out.meta = true; } });
    var lm = {}, next = [];
    (L.notes || []).forEach(function (n) { lm[n.id] = n; });
    (R.notes || []).forEach(function (rn) {
      var ln = lm[rn.id];
      if (!ln) { if (g.deletedNotes && g.deletedNotes[rn.id]) return; var cp = JSON.parse(JSON.stringify(rn)); next.push(cp); out.added.push(rn.id); out.notes.push(rn.id);
        (cp.items || []).forEach(function (l) { out.lines.push({ noteId: cp.id, lineId: l.id }); }); return; }
      delete lm[rn.id]; mergeNote(ln, rn, g, out, hooks); next.push(ln);
    });
    Object.keys(lm).forEach(function (id) { var n = lm[id];
      if (/^tmp-/.test(id) || (g.keepNotes && g.keepNotes[id]) || (g.dirtyNotes && g.dirtyNotes[id])) next.push(n);
      else { out.removed.push(id); out.notes.push(id); } });
    if (ids(L.notes) !== ids(next)) out.order = true;
    L.notes = next;
    if ('rev' in R) L.rev = R.rev;
    out.any = !!(out.info || out.meta || out.notes.length || out.lines.length || out.order);
    return out;
  }
  function mergeNote(ln, rn, g, out, hooks) {
    var changed = false, told = false;
    function touch() { if (!told) { told = true; if (hooks.beforeChange) hooks.beforeChange(ln); } }
    var textDiff = (ln.title || '') !== (rn.title || '') || (ln.text || '') !== (rn.text || '');
    if (textDiff) {
      if ((g.dirtyNotes && g.dirtyNotes[ln.id]) || g.focusNote === ln.id) out.skipped = true;
      else { touch(); ln.title = rn.title; ln.text = rn.text || ''; changed = true; }
    }
    if (!same(ln.photos || [], rn.photos || [])) { touch(); ln.photos = (rn.photos || []).slice(); changed = true; }
    var lm = {}, list = [];
    (ln.items || []).forEach(function (l) { lm[l.id] = l; });
    (rn.items || []).forEach(function (rl) {
      var ll = lm[rl.id];
      if (!ll) { touch(); list.push(JSON.parse(JSON.stringify(rl))); out.lines.push({ noteId: ln.id, lineId: rl.id }); changed = true; return; }
      delete lm[rl.id];
      if (!lineSame(ll, rl)) {
        var held = (g.heldLines && g.heldLines[rl.id]) || g.focusLine === rl.id;
        if (held || (Number(ll.u) || 0) > (Number(rl.u) || 0)) out.skipped = true;            // local change pending / newer: ours wins
        else { touch(); LINE_KEYS.forEach(function (k) { if (k in rl) ll[k] = rl[k]; else delete ll[k]; }); out.lines.push({ noteId: ln.id, lineId: rl.id }); changed = true; }
      }
      if (rl.u != null && !((Number(ll.u) || 0) > Number(rl.u))) { ll.u = rl.u; ll.ub = rl.ub; }
      list.push(ll);
    });
    Object.keys(lm).forEach(function (id) { var ll = lm[id];
      if (/^tmpl-/.test(id) || (g.heldLines && g.heldLines[id])) list.push(ll);   // added here, not on the server yet
      else { touch(); changed = true; } });
    if (g.ordDirty && g.ordDirty[ln.id]) {                                         // a local re-order is pending: keep our order
      var pos = {}; (ln.items || []).forEach(function (l, i) { pos[l.id] = i; });
      list.sort(function (a, b) { var x = a.id in pos ? pos[a.id] : 1e6, y = b.id in pos ? pos[b.id] : 1e6; return x - y; });
    }
    if (ids(ln.items) !== ids(list)) { if (!changed) touch(); changed = true; }
    ln.items = list;
    if ((Number(rn.updated) || 0) >= (Number(ln.updated) || 0)) { ln.updated = rn.updated; ln.updated_by = rn.updated_by; }
    ['created'].forEach(function (k) { if (k in rn) ln[k] = rn[k]; });
    if (changed) out.notes.push(ln.id);
  }
  /** What both phones and the server should agree on (for tests and the convergence check). */
  function canon(p) {
    return JSON.stringify({ name: p.name || '', phone: p.phone || '', city: p.city || '', tax: p.tax || 'SF',
      notes: (p.notes || []).map(function (n) { return { id: n.id, title: n.title, text: n.text || '', photos: n.photos || [],
        items: (n.items || []).map(function (l) { return { id: l.id, name: l.name, qty: Number(l.qty), note: l.note || '' }; }) }; }) });
  }
  /** Poll pace: every 4 s while someone is working, slower when nothing happened for a while. */
  function pollDelay(idleMs) { return idleMs < 120000 ? 4000 : idleMs < 600000 ? 10000 : 30000; }
  var api = { Outbox: Outbox, handles: handles, coalesceKey: coalesceKey, mergeProject: mergeProject, canon: canon, pollDelay: pollDelay };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ESYNC = api;
})(typeof window !== 'undefined' ? window : this);
