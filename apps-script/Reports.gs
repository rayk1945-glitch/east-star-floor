/**
 * Reported inventory (missing stock) for the East Star floor app.
 *
 * Drop this file into the EXISTING Apps Script project that already serves the
 * floor /exec URL (do not create a second web app). Use that file's own JSON
 * helper. reportAction_ returns null for every other action.
 *
 * 1) Bots, same place as clientView, BEFORE the staff sign-in check.
 *    No staff session token. Same POST as clientView: text/plain JSON to the
 *    /exec URL, redirect followed, no cookies.
 *
 *      if (action === 'listReports' && !body.token) {
 *        try {
 *          return json({ ok: true, data: reportAction_('listReports', body, null) });
 *        } catch (err) {
 *          return json({ ok: false, error: err && err.message ? err.message : String(err) });
 *        }
 *      }
 *
 *    Request:  {"action":"listReports","status":"open"}
 *    Response: {"ok":true,"data":{"reports":[
 *      {"item":"","desc":"","qty":1,"store":"SF","reporter":"","date":"","note":"","id":""}
 *    ]}}
 *    date is Pacific Time, yyyy-MM-dd'T'HH:mm:ss, and is always set.
 *    reporter is always set: session.name, or body.name when the session has no name.
 *    status "open" (default) returns open rows. "resolved" and "all" also work.
 *    A resolved row adds resolver and resolved (same date format). Both are kept.
 *    Creating, marking found (resolveReport), or deleting still requires a staff session.
 *    deleteReport removes the row. Only the reporter (session.name, or body.name
 *    when the session has no name) may delete. Anyone signed in may mark found.
 *
 * 2) Staff app, AFTER the request is authenticated and session exists:
 *
 *      if (action === 'reportMissing' || action === 'listReports' || action === 'resolveReport' || action === 'deleteReport') {
 *        try {
 *          return json({ ok: true, data: reportAction_(action, body, session) });
 *        } catch (err) {
 *          return json({ ok: false, error: err && err.message ? err.message : String(err) });
 *        }
 *      }
 *
 *    The signed-in list is { supported: true, reports: [...] } with who/when/status.
 *    The floor app hides the feature until that shape comes back.
 *
 * Storage is a sheet tab named "Reports" (every report, including resolved).
 * Open reports are also mirrored to a tab named "Reported Missing" (item, desc,
 * qty, store, reporter, date, note, id). A container-bound script uses the
 * active spreadsheet. Otherwise set script property REPORTS_SHEET_ID to that
 * spreadsheet's id. Tabs are created on the first call.
 *
 * The reporter and the resolver are session.name. The client cannot set them.
 * NetSuite item data is never written.
 */
var REPORT_HEADERS_ = ['id', 'item', 'desc', 'qty', 'store', 'who', 'when', 'note', 'status', 'resolvedBy', 'resolvedAt'];
var REPORT_PUBLIC_HEADERS_ = ['item', 'desc', 'qty', 'store', 'reporter', 'date', 'note', 'id'];

function reportAction_(action, body, session) {
  if (action !== 'listReports' && action !== 'reportMissing' && action !== 'resolveReport' && action !== 'deleteReport') return null;
  body = body || {};
  if (action === 'listReports' && !session) {
    return withReportsLock_(function () {
      var rows = readReports_();
      writeMirror_(rows);
      return reportBotList_(rows, body);
    });
  }
  if (!session) throw new Error('Please sign in.');
  if (action === 'listReports') {
    return withReportsLock_(function () {
      var rows = readReports_();
      writeMirror_(rows);
      return { supported: true, reports: rows };
    });
  }
  if (action === 'reportMissing') return { supported: true, report: withReportsLock_(function () { return reportMissing_(body, session); }) };
  if (action === 'deleteReport') return { supported: true, deleted: withReportsLock_(function () { return deleteReport_(body, session); }) };
  return { supported: true, report: withReportsLock_(function () { return resolveReport_(body, session); }) };
}

function withReportsLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function reportsBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('REPORTS_SHEET_ID');
  if (id && String(id).trim()) return SpreadsheetApp.openById(String(id).trim());
  var book = null;
  try { book = SpreadsheetApp.getActive(); } catch (e) { book = null; }
  if (!book) { try { book = SpreadsheetApp.getActiveSpreadsheet(); } catch (e2) { book = null; } }
  if (!book) throw new Error('Set script property REPORTS_SHEET_ID to the spreadsheet id that should hold the Reports tab.');
  return book;
}

function reportsSheet_() {
  var book = reportsBook_();
  var sh = book.getSheetByName('Reports');
  if (!sh) sh = book.insertSheet('Reports');
  if (!sh.getLastRow()) {
    sh.getRange(1, 1, 1, REPORT_HEADERS_.length).setValues([REPORT_HEADERS_]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  if (String(sh.getRange(1, 1).getValue() || '') !== 'id') {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, REPORT_HEADERS_.length).setValues([REPORT_HEADERS_]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function reportEpoch_(v) {
  if (v instanceof Date) return v.getTime();
  if (v === '' || v == null) return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function reportFromRow_(row) {
  var status = String(row[8] || '') === 'resolved' ? 'resolved' : 'open';
  return {
    id: String(row[0]),
    item: String(row[1] || ''),
    desc: String(row[2] || ''),
    qty: Number(row[3]) || 0,
    store: String(row[4] || ''),
    who: String(row[5] || ''),
    when: reportEpoch_(row[6]),
    note: String(row[7] || ''),
    status: status,
    resolvedBy: String(row[9] || ''),
    resolvedAt: reportEpoch_(row[10])
  };
}

function readReports_() {
  var sh = reportsSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push(reportFromRow_(values[i]));
  }
  return out;
}

/** Pacific Time yyyy-MM-dd'T'HH:mm:ss. A string, so the sheet does not shift the clock. */
function reportDate_(ms) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(ms), 'America/Los_Angeles', "yyyy-MM-dd'T'HH:mm:ss");
}

function reportPublic_(r) {
  var row = {
    item: r.item,
    desc: r.desc,
    qty: r.qty,
    store: r.store,
    reporter: r.who,
    date: reportDate_(r.when),
    note: r.note,
    id: r.id
  };
  if (r.status === 'resolved') {
    row.resolver = r.resolvedBy || '';
    row.resolved = reportDate_(r.resolvedAt);
  }
  return row;
}

/** Logged-in rep wins. With no rep name, body.name is required. body.who is ignored. */
function reportPerson_(session, body) {
  var who = session && String(session.name || '').trim();
  if (!who) who = String(body && body.name != null ? body.name : '').trim();
  if (!who) throw new Error('Name is required.');
  if (who.length > 80) throw new Error('Name is too long.');
  return who.slice(0, 80);
}

/** Bot read. status open (default), resolved, or all. Newest first. */
function reportBotList_(rows, body) {
  var status = String(body && body.status != null ? body.status : 'open').trim().toLowerCase();
  if (status !== 'open' && status !== 'resolved' && status !== 'all') throw new Error('status must be open, resolved, or all.');
  var picked = [];
  for (var i = 0; i < rows.length; i++) {
    if (status !== 'all' && rows[i].status !== status) continue;
    picked.push(rows[i]);
  }
  picked.sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
  var reports = [];
  for (var j = 0; j < picked.length; j++) reports.push(reportPublic_(picked[j]));
  return { reports: reports };
}

/** Open reports only, on a tab a person or a bot's spreadsheet reader can open. */
function writeMirror_(rows) {
  var book = reportsBook_();
  var sh = book.getSheetByName('Reported Missing');
  if (!sh) sh = book.insertSheet('Reported Missing');
  var open = [];
  for (var i = 0; i < rows.length; i++) if (rows[i].status === 'open') open.push(rows[i]);
  open.sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
  var values = [REPORT_PUBLIC_HEADERS_];
  for (var j = 0; j < open.length; j++) {
    var p = reportPublic_(open[j]);
    values.push([p.item, p.desc, p.qty, p.store, p.reporter, p.date, p.note, p.id]);
  }
  sh.clear();
  sh.getRange(1, 1, values.length, REPORT_PUBLIC_HEADERS_.length).setValues(values);
  sh.getRange(1, 1, 1, REPORT_PUBLIC_HEADERS_.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function reportWholeQty_(v) {
  if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v) return v;
  var s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (!/^\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

function reportMissing_(body, session) {
  var item = String(body.item == null ? '' : body.item).trim();
  if (!item) throw new Error('Item name is required.');
  if (item.length > 80) throw new Error('Item name is too long.');
  var qty = reportWholeQty_(body.qty);
  if (!(qty >= 1 && qty <= 9999)) throw new Error('Qty must be a whole number from 1 to 9999.');
  var store = String(body.store || '').trim().toUpperCase();
  if (store !== 'SF' && store !== 'FRE') throw new Error('Pick SF or FRE.');
  var note = String(body.note == null ? '' : body.note);
  if (note.length > 300) throw new Error('Note is too long.');
  note = note.trim();
  var desc = String(body.desc == null ? '' : body.desc).trim();
  if (desc.length > 200) desc = desc.slice(0, 200);
  var who = reportPerson_(session, body);
  var rep = {
    id: 'R' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
    item: item,
    desc: desc,
    qty: qty,
    store: store,
    who: who,
    when: Date.now(),
    note: note,
    status: 'open',
    resolvedBy: '',
    resolvedAt: 0
  };
  reportsSheet_().appendRow([rep.id, rep.item, rep.desc, rep.qty, rep.store, rep.who, rep.when, rep.note, rep.status, '', '']);
  writeMirror_(readReports_());
  return rep;
}

function resolveReport_(body, session) {
  var id = String(body.id == null ? '' : body.id).trim();
  if (!id) throw new Error('Report not found.');
  var sh = reportsSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== id) continue;
    var rep = reportFromRow_(values[i]);
    if (rep.status === 'resolved') return rep;
    var who = reportPerson_(session, body);
    var at = Date.now();
    sh.getRange(i + 1, 9, 1, 3).setValues([['resolved', who, at]]);
    rep.status = 'resolved';
    rep.resolvedBy = who;
    rep.resolvedAt = at;
    writeMirror_(readReports_());
    return rep;
  }
  throw new Error('Report not found.');
}

/** Removes the row. Only the reporter may delete a mistaken report. */
function deleteReport_(body, session) {
  var id = String(body.id == null ? '' : body.id).trim();
  if (!id) throw new Error('Report not found.');
  var who = reportPerson_(session, body);
  var sh = reportsSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== id) continue;
    var rep = reportFromRow_(values[i]);
    if (rep.who !== who) throw new Error('Only the reporter can delete this report.');
    sh.deleteRow(i + 1);
    writeMirror_(readReports_());
    return { id: id };
  }
  throw new Error('Report not found.');
}
