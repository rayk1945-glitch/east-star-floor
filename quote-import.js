/* East Star floor app: quote import (20261017g PDF, 20261017h photos). Loaded on first use from index.html (quoteImport).
 * Digital PDFs (NetSuite estimates, East Star quote PDFs): read from the PDF text layer with pdf.js (CDN, loaded only when a PDF
 * is picked), parsed and matched to the item list on the phone, then shown in a review sheet. Nothing is sent to the server.
 * 20261017h: photos / screenshots / JPG quotes (up to 5 = one quote) and scanned PDFs (pages 1-3 rendered with pdf.js) are made
 * into one small JPEG copy each on the phone (long side <= 2000 px, under 900 KB; the server refuses > 1.1 MB) and sent one at a
 * time to the server's 'quoteRead' (Drive OCR, v26). The returned text goes through the same parser (parseText: amount ÷ rate qty
 * recovery) and the same review sheet. Old server (no quoteRead, "Unknown action."): the 20261017g "coming soon" message. */
/* East Star quote import — parser + matcher (prototype, Phase 1). Plain ES5-ish JS, runs in the page and in node.
 * Input A: layout rows from pdf.js (digital PDFs: NetSuite estimates, our quote_pdf.py quotes).
 * Input B: plain OCR text (Drive OCR on the server for photos / scanned PDFs).
 * Output: { kind, customer:{name, phone}, quoteNo, style, lines:[{code, qty, qtyHow, desc, status:'ok'|'check'|'none', picks:[{name,qty}], cands:[names], how}] }
 * Matching mirrors the page's scanMatchItems/nameIndex_: exact item name, then normalized (spaces, dashes, # ignored), then
 * brand-stripped suffix ("15714001" -> HANSGROHE-15714001), then cabinet style tables (code -> door + box parts), then close
 * matches (token subset / 1-2 edits) which are never auto-picked: they come back as 'check' with candidates.
 * Discontinued rows (desc says discontinued) are left out; hidden rows are not in the bundle at all. */
(function (root) {
  'use strict';
  function norm(s) { return String(s || '').replace(/[×✕]/g, 'x').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function despace(s) { s = String(s || '').trim(); return /^(\S ){2,}\S$/.test(s) ? s.replace(/ /g, '') : s; }   // "I T E M" -> "ITEM"
  function toks(s) { return String(s || '').replace(/[×✕]/g, 'x').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean); }
  var BRAND_RE = /^([A-Za-z]{2,12})[\s-]+(.+)$/;
  var TOTAL_RE = /^(sub ?total|total|discount|tax|less\b|after discount|sf tax|notes?|s&h|amount due|freight)/i;

  // 20261017i: hidden / discontinued items (same lists as the bundle build: /workspace/bot-app/hidden-codes.json = exact codes,
  // hidden-prefixes.json = style prefixes ending in "-", case-insensitive at the start). The bundle already leaves them out; this
  // is the second lock so a quote can never match, suggest or add one (e.g. an older cached item list). Keep in sync with those files.
  var HIDDEN_CODES = ["AS TUB 2390202.020", "AS TUB 2391202.020", "AS TUB 2460002.020", "AS TUB 2461002.020", "AS TUB 2544102.020", "AS TUB 2544202.020", "AS TUB 2545102.020", "AS TUB 2545202.020", "AS TUB 2946102.020", "AS TUB 2946202.020", "AS TUB 2973102.020", "AS TUB 2973202.020", "TOTO SW3346#01", "MHK-LG99-M230-0017/M", "MHK-LK04-M230-11707/", "MHK-LM12-M231-4416/M"];
  var HIDDEN_PREFIXES = ["DF-#16-", "DF-#18-", "DF-#60-", "DF-#2889-", "BOX-#16-", "BOX-#18-", "BOX-#60-", "BOX-#2889-", "CB-LM12-", "CB-LK04-", "CB-LG99-", "PN-LG99-", "PN-LK04-", "PN-LM12-"];
  var HIDDEN_EXTRA = ['TOTO SW3346#', 'SW3346#'];   // Ray: TOTO S2 SW3346 in every color (hidden-codes.json has #01, the only one we stocked)
  function isHidden(code) { var c = String(code || '').trim().toUpperCase(); if (!c) return false;
    if (HIDDEN_CODES.indexOf(c) >= 0) return true;
    for (var i = 0; i < HIDDEN_PREFIXES.length; i++) if (c.indexOf(HIDDEN_PREFIXES[i]) === 0) return true;
    for (i = 0; i < HIDDEN_EXTRA.length; i++) if (c.indexOf(HIDDEN_EXTRA[i]) === 0) return true;
    return false; }
  function lineHidden(code) { var c = String(code || '').trim().toUpperCase().replace(/^TOTO TOTO /, 'TOTO ');
    return isHidden(c) || isHidden(c.split(' ')[0]) || HIDDEN_CODES.some(function (h) { return c.indexOf(h + ' ') === 0; }) || /(^|\s)SW3346#/.test(c); }
  /** Last pass on every parsed quote: no hidden item as a pick or a candidate; a line whose own code is hidden is "not offered". */
  function dropHidden(res) {
    (res && res.lines || []).forEach(function (l) {
      var hp = (l.picks || []).some(function (p) { return isHidden(p.name); });
      l.picks = (l.picks || []).filter(function (p) { return !isHidden(p.name); });
      l.cands = (l.cands || []).filter(function (c) { return !isHidden(c); });
      if (hp && !l.picks.length && l.status === 'ok') l.status = 'none';
      if (lineHidden(l.code)) { l.discontinued = true; if (l.status === 'ok' && !l.picks.length) l.status = 'none'; if (l.status === 'none') l.how = 'discontinued: not offered'; if (l.status === 'check' && !l.cands.length) { l.status = 'none'; l.how = 'discontinued: not offered'; } }
      if (l.status === 'check' && !l.cands.length) { l.status = 'none'; if (!l.discontinued) l.how = 'not in item list'; }
    });
    return res;
  }
  var IDX = null, IDX_VER = null;
  function buildIndex(bundle) {
    var ver = (bundle.version || '') + '#' + (bundle.items || []).length;
    if (IDX && IDX_VER === ver) return IDX;
    var items = bundle.items || [], exact = {}, nm = {}, suf = {}, tokIx = {}, live = [];
    items.forEach(function (r, i) {
      if (/discontinu/i.test(r[1] || '') || isHidden(r[0])) return;   // excluded (page rule) / hidden list
      live.push(i); var name = String(r[0]); exact[name] = i; exact[name.replace(/\s+/g, ' ').toUpperCase()] = i;
      var k = norm(name); if (k) (nm[k] = nm[k] || []).push(i);
      var m = BRAND_RE.exec(name), rest = m ? m[2] : '', k2 = norm(rest);
      if (k2.length >= 5 && /\d/.test(k2)) (suf[k2] = suf[k2] || []).push(i);
      toks(name).forEach(function (t) { if (t.length >= 3) (tokIx[t] = tokIx[t] || []).push(i); });
    });
    var cab = {}; (bundle.cabinets || []).forEach(function (s) { var rows = {}; (s.rows || []).forEach(function (r) { rows[norm(r[0])] = r; }); cab[s.key] = { name: s.name, rows: rows, raw: s.rows || [] }; });
    IDX = { items: items, exact: exact, norm: nm, suf: suf, tok: tokIx, cab: cab, live: live, normKeys: Object.keys(nm) }; IDX_VER = ver; return IDX;
  }

  /** Section header / Style: text -> cabinet style key (#2068, ESV88 GREY...). */
  function styleOf(text, ix) {
    var flat = despaceAll(text), hm = /#?\s*\b8?(\d{4})\b/.exec(flat.replace(/\b82(\d{3})\b/, '#2$1')); if (hm && ix.cab['#' + hm[1]]) return '#' + hm[1];
    if (hm) return null;                                         // "#2066" (OCR slip) must not fall through to "White Shaker"
    var T = toks(flat), best = null, bl = 0;
    Object.keys(ix.cab).forEach(function (key) { var kt = toks(key); if (!kt.length) return;
      var ok = kt.every(function (t) { return T.indexOf(t) >= 0 || (t === 'GREY' && T.indexOf('GRAY') >= 0); });
      if (ok && key.length > bl) { best = key; bl = key.length; } });
    return best;
  }
  function despaceAll(s) { return String(s || '').replace(/(?:\b\S ){2,}\S\b/g, function (m) { return m.replace(/ /g, ''); }); }

  function lev(a, b, max) { if (Math.abs(a.length - b.length) > max) return max + 1; var p = [], i, j; for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) { var c = [i], mn = i; for (j = 1; j <= b.length; j++) { c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (c[j] < mn) mn = c[j]; } if (mn > max) return max + 1; p = c; } return p[b.length]; }

  function ocrFix(s) { return String(s).replace(/[Il|](?=\d)/g, '1').replace(/(\d)[Il|]/g, function (m, d) { return d + '1'; }).replace(/O(?=\d)/g, '0').replace(/(\d)O/g, function (m, d) { return d + '0'; }).replace(/[_&.,;:]+$/, ''); }   // no regex lookbehind (older iOS Safari cannot parse it)
  function pick(ix, i, q) { return { name: ix.items[i][0], qty: q || 1 }; }
  function cabRow(ix, style, code) {
    var s = style && ix.cab[style]; if (!s) return null; var k = norm(code), r = s.rows[k], m;
    if (!r && /[LR]$/.test(k)) r = s.rows[k.slice(0, -1)];                                   // hinge / blind hand suffix
    if (!r && (m = /^BBC(\d\d)(\d\d)[LR]?$/.exec(k))) {                                        // BBC42-45R = box BBC42/45 (+ smaller door)
      var want = 'BBC' + m[1] + '/' + m[2]; r = s.raw.filter(function (x) { return (x[3] || []).some(function (p) { return /^BOX-/.test(p[0]) && p[0].slice(-want.length) === want; }); })[0];
    }
    return r || null;
  }
  /** One code string -> {status, picks, cands, how}. */
  function matchCode(raw, ctx, ix) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim(), k = norm(s), ids;
    if (!k) return { status: 'none', picks: [], cands: [], how: '' };
    if (ix.exact[s] != null) return { status: 'ok', picks: [pick(ix, ix.exact[s])], cands: [], how: 'exact' };
    if (ix.exact[s.toUpperCase()] != null) return { status: 'ok', picks: [pick(ix, ix.exact[s.toUpperCase()])], cands: [], how: 'exact' };
    ids = ix.norm[k] || [];
    if (ids.length === 1) return { status: 'ok', picks: [pick(ix, ids[0])], cands: [], how: 'normalized' };
    var cr = cabRow(ix, ctx && ctx.style, s) || (ctx && ctx.ocr ? cabRow(ix, ctx.style, ocrFix(s)) : null);
    if (cr && (cr[3] || []).length) return { status: 'ok', picks: cr[3].map(function (p) { return { name: p[0], qty: 1 }; }).filter(function (p) { return ix.exact[p.name] != null; }), cands: [], how: 'cabinet ' + ctx.style + ' ' + cr[0] };
    if (ids.length > 1) return { status: 'check', picks: [], cands: ids.slice(0, 6).map(function (i) { return ix.items[i][0]; }), how: 'several same code' };
    ids = k.length >= 5 ? (ix.suf[k] || []) : [];
    if (ids.length === 1) return { status: 'ok', picks: [pick(ix, ids[0])], cands: [], how: 'brand prefix' };
    if (ids.length > 1) return { status: 'check', picks: [], cands: ids.slice(0, 6).map(function (i) { return ix.items[i][0]; }), how: 'several brands' };
    return null;   // caller may try close match
  }
  function closeMatch(raw, ix) {
    var s = String(raw || ''), k = norm(s), T = toks(s), out = [], seen = {};
    if (k.length < 5) return null;
    if (T.length >= 2) {                                         // every quote token inside the item name (renamed items: "PIAZZA ARENA" -> "PIAZZA MATT ARENA")
      var base = (ix.tok[T.filter(function (t) { return t.length >= 3; }).sort(function (a, b) { return (ix.tok[a] || []).length - (ix.tok[b] || []).length; })[0]] || []);
      base.forEach(function (i) { var nt = toks(ix.items[i][0]); if (nt[0] !== T[0]) return; if (T.every(function (t) { return nt.indexOf(t) >= 0; })) { if (!seen[i]) { seen[i] = 1; out.push([nt.length - T.length, i]); } } });
    }
    if (!out.length && k.length >= 6) {                          // OCR slips: 1 edit (2 when long)
      var max = k.length >= 10 ? 2 : 1;
      ix.normKeys.forEach(function (nk) { if (Math.abs(nk.length - k.length) > max) return; var d = lev(k, nk, max); if (d <= max) ix.norm[nk].forEach(function (i) { if (!seen[i]) { seen[i] = 1; out.push([d, i]); } }); });
      Object.keys(ix.suf).forEach(function (nk) { if (Math.abs(nk.length - k.length) > max) return; var d = lev(k, nk, max); if (d <= max) ix.suf[nk].forEach(function (i) { if (!seen[i]) { seen[i] = 1; out.push([d, i]); } }); });
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a[0] - b[0]; });
    return { status: 'check', picks: [], cands: out.slice(0, 6).map(function (x) { return ix.items[x[1]][0]; }), how: 'close match' };
  }
  function matchAny(variants, ctx, ix) {
    var i, r; for (i = 0; i < variants.length; i++) { r = matchCode(variants[i], ctx, ix); if (r && r.status === 'ok') return r; }
    for (i = 0; i < variants.length; i++) { r = matchCode(variants[i], ctx, ix); if (r) return r; }
    for (i = 0; i < variants.length; i++) { r = closeMatch(variants[i], ix); if (r) return r; }
    return { status: 'none', picks: [], cands: [], how: 'not in item list' };
  }
  function finish(line) { line.picks.forEach(function (p) { p.qty = (p.qty || 1) * (line.qty || 1); });
    var hm = /^cabinet/.test(line.how) && /([LR])[_.,]?$/.exec(String(line.code).trim());       // WEA2440L / BBC42-45R: hand goes into the line note (as on our NetSuite lines)
    if (hm) line.note = /^BBC/i.test(line.code) ? (hm[1] === 'L' ? 'BLIND LEFT 左盲' : 'BLIND RIGHT 右盲') : (hm[1] === 'L' ? 'HINGE LEFT 向左开' : 'HINGE RIGHT 向右开');
    return line; }

  // ------------------------------------------------------------------ header info (customer, quote no, style)
  function headerInfo(text, ix) {
    var t = String(text || ''), m, out = { name: '', phone: '' }, kind = 'generic', qn = '';
    if (/Labor Quote/i.test(t)) kind = 'netsuite-labor';
    else if (/Estimate\s*#|Customer Name\s*\(Print\)|EMP\d{4}/i.test(t)) kind = 'netsuite-estimate';
    else if (/CUSTOMER\s*INFORMATION|QUOTE\s*NO|eaststarusa\.com/i.test(despaceAll(t)) && /Client:/i.test(t)) kind = 'eaststar-quote';
    else if (/Quotation|QUOTE TO/i.test(t)) kind = 'other-store';
    if ((m = /Customer Name\s*\(Print\)[:\s]*([^\n]+)/i.exec(t))) out.name = m[1].trim();
    else if ((m = /Client:[ \t]*([^\n]+)/i.exec(t))) out.name = m[1].trim();
    else if (kind === 'netsuite-labor' && (m = /\bCustomer\b[^\n]*\n\s*([^\n]+)(?:\n\s*([A-Z][A-Z .'-]{1,30})\s*(?:\n|$))?/.exec(t))) out.name = (m[1] + (m[2] && !/Jobsite|Phone/i.test(m[2]) ? ' ' + m[2] : '')).replace(/\s*(Phone Number|Sales Rep).*$/i, '').trim();
    else if ((m = /QUOTE TO:?[^\n]*\n\s*([^\n]+)/i.exec(t))) out.name = m[1].trim();
    out.name = out.name.replace(/\s{2,}.*$/, '').replace(/\s*\(?\d{3}\)?[\s-]?\d{3}-\d{4}.*$/, '');
    if ((m = /^\s*(\d{10})\s+(.+)$/.exec(out.name))) { out.phone = m[1]; out.name = m[2]; }
    if ((m = /\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/.exec(t.replace(/Tel:[^\n]*|Fax[^\n]*|\(415\) 467-2888|\(510\) 257-4888/g, ''))) && !out.phone) out.phone = m[0];
    out.name = out.name.split(/[_=|“”"{}\[\]]/)[0].replace(/(\s+\S{1,2})+\s*$/, function (m) { return /\b(and|&)\b/i.test(m) ? m : ''; }).trim();   // OCR junk after the name
    if (!/[A-Za-z]{2,}/.test(out.name) || /Authorized|Pickup|eaststarusa|Sales Rep/i.test(out.name)) out.name = '';
    out.name = out.name.replace(/\b([A-Z])([A-Z]+)\b/g, function (w, a, b) { return a + b.toLowerCase(); }).trim();   // CANDACE COLEMAN -> Candace Coleman
    if ((m = /\bEST\d{6}\b/.exec(t))) qn = m[0]; else if ((m = /QUOTE\s*NO\s*\.?\s*([^\n]+)/i.exec(despaceAll(t)))) qn = m[1].trim().split(/\s+/)[0]; else if ((m = /\bS\d{7}\b/.exec(t))) qn = m[0];
    var style = null; if ((m = /Style:[ \t]*([^\n]+)/i.exec(t))) style = styleOf(m[1], ix);
    return { kind: kind, customer: out, quoteNo: qn, style: style };
  }

  // ------------------------------------------------------------------ A: pdf.js layout rows
  var COLS = { ITEM: 'item', ITEMS: 'item', DESCRIPTION: 'desc', QTY: 'qty', QUANTITY: 'qty', ORDERQTY: 'qty', RATE: 'rate', AMOUNT: 'amount', UNITPRICE: 'rate', EXTPRICE: 'amount', PRICE: 'rate' };
  function headerCols(row) {
    var cols = row.cells.map(function (c) { var n = despace(c.s).toUpperCase().replace(/[^A-Z]/g, ''); return COLS[n] ? { x: c.x, k: COLS[n] } : null; }).filter(Boolean);
    var hasI = cols.some(function (c) { return c.k === 'item'; }), hasQ = cols.some(function (c) { return c.k === 'qty'; });
    if (!hasI && !hasQ) return null;
    if (!hasQ && !cols.some(function (c) { return c.k === 'desc' || (hasI && c.k === 'rate'); })) return null;   // item + description (an options list) or item + price (our short customer quotes): qty 1, flagged
    if (!hasI) { var d = cols.filter(function (c) { return c.k === 'desc'; })[0]; if (!d) return null; d.k = 'item'; }   // other-store: code is inside Description
    cols.sort(function (a, b) { return a.x - b.x; });
    var groups = [], g = null;                               // a new group starts at each repeated item/qty column (2-column quotes)
    cols.forEach(function (c) { if (!g || g.seen[c.k] && (c.k === 'item' || c.k === 'qty')) { g = { cols: [], seen: {} }; groups.push(g); } g.cols.push(c); g.seen[c.k] = 1; });
    groups.forEach(function (gr, i) { gr.x0 = gr.cols[0].x - 14; gr.x1 = i + 1 < groups.length ? groups[i + 1].cols[0].x - 14 : 1e9; });
    return groups;
  }
  /** Column of a cell: text by its left edge, a bare number by its right edge (NetSuite right-aligns Quantity just left of Item). */
  function colOf(gr, cell) { var num = /^[\d.,$%-]+$/.test(String(cell.s).trim()), x = num ? cell.x + (cell.w || 0) - 1 : cell.x, c = null;
    gr.cols.forEach(function (cc, i) { var lo = i ? cc.x - 4 : gr.x0, hi = i + 1 < gr.cols.length ? gr.cols[i + 1].x - 4 : gr.x1; if (x >= lo && x < hi) c = (cc.k === 'qty' && !/^\s*\d{1,5}\s*(ea|pcs?|box(es)?|sf)?\s*$/i.test(cell.s)) ? (gr.cols[i + 1] ? gr.cols[i + 1].k : 'desc') : cc.k; }); return c; }
  function parseRows(rows, bundle) {
    var ix = buildIndex(bundle), text = rows.map(function (r) { return r.cells.map(function (c) { return c.s; }).join('  '); }).join('\n'), H = headerInfo(text, ix);
    // NetSuite labor: customer block under the "Customer" label (left column, until Jobsite)
    if (H.kind === 'netsuite-labor') { var ci = -1, nm = []; rows.forEach(function (r, i) { if (ci < 0 && r.cells[0] && /^Customer$/i.test(r.cells[0].s)) ci = i; });
      for (var i2 = ci + 1; ci >= 0 && i2 < rows.length; i2++) { var c0 = rows[i2].cells[0]; if (!c0 || c0.x > 300 || /^Jobsite/i.test(c0.s)) break; nm.push(c0.s); }
      if (nm.length) { var s = nm.join(' '), mm = /^(\d{10})\s+(.+)$/.exec(s); H.customer.name = (mm ? mm[2] : s).replace(/\b([A-Z])([A-Z]+)\b/g, function (w, a, b) { return a + b.toLowerCase(); }); if (mm) H.customer.phone = mm[1]; } }
    if (!H.style) { var hs = {}, re = /#(\d{4})\b/g, mh, head = text.slice(0, 1500); while ((mh = re.exec(head))) if (ix.cab['#' + mh[1]]) hs['#' + mh[1]] = 1; if (Object.keys(hs).length === 1) H.style = Object.keys(hs)[0]; }   // "Customer Quote — #3008 Oak Cabinets"
    var lines = [], groups = null, page = 0, styleG = [];
    rows.forEach(function (r) {
      if (r.page !== page) { page = r.page; groups = null; }
      var hg = headerCols(r); if (hg) { groups = hg; groups.forEach(function (g, gi) { g.style = styleG[gi] || H.style; g.open = true; g.last = null; }); return; }
      if (!groups) return;
      r = { page: r.page, y: r.y, cells: r.cells.map(function (c) { return { x: c.x, w: c.w, s: String(c.s).replace(/(?:[A-Z] ){3,7}[A-Z]/g, function (w) { return /^(EAST|STAR|BUILDING|SUPPLY)$/.test(w.replace(/ /g, '')) ? '' : w; }).trim() }; }).filter(function (c) { return c.s; }) };   // faint letter-spaced logo behind the table
      groups.forEach(function (g, gi) {
        if (!g.open) return;
        var cells = r.cells.filter(function (c) { return c.x >= g.x0 && c.x < g.x1; }); if (!cells.length) return;
        var by = {}; cells.forEach(function (c) { var k = colOf(g, c) || 'desc'; (by[k] = by[k] || []).push(c.s); });
        var all = cells.map(function (c) { return c.s; }).join(' ');
        if (TOTAL_RE.test(despace(cells[0].s)) || TOTAL_RE.test(despaceAll(all).trim())) { g.open = false; return; }
        var st = (!by.qty && !by.rate && /(\b\S ){3,}/.test(all)) ? styleOf(all, ix) : null;      // letter-spaced section header
        if (st || (!by.qty && /(\b\S ){3,}/.test(all))) { if (st) { g.style = st; styleG[gi] = st; } g.last = null; return; }
        var q = by.qty ? /^\s*(\d{1,5})(?:\s*(?:ea|pcs?|box(?:es)?|sf))?\s*$/i.exec(by.qty.join(' ')) : null;
        if (!q && by.item && !g.seen.qty && !(g.last && r.y - g.last.y < 14)) q = [0, '1'];
        if (q && by.item) { var L = { code: by.item.join(' '), qty: +q[1], qtyHow: g.seen.qty ? 'qty column' : 'no qty on the quote (set to 1)', desc: (by.desc || []).join(' '), y: r.y, g: g, cont: [] }; lines.push(L); g.last = L; return; }
        if (q && !by.item && g.last && g.last.y > r.y - 14) { return; }
        if (q && !by.item) { var Lq = { code: '', qty: +q[1], qtyHow: 'qty column', desc: (by.desc || []).join(' '), y: r.y, g: g, cont: [] }; lines.push(Lq); g.last = Lq; return; }
        if (by.item && g.last && r.y - g.last.y < 30 && !g.last.cont.length) { g.last.cont.push(by.item.join(' ')); }
        else if (by.item && g.last && !g.last.code) { g.last.code = by.item.join(' '); }
        if (by.desc && g.last) g.last.desc += (g.last.desc ? ' ' : '') + by.desc.join(' ');
      });
    });
    var out = lines.map(function (L) {
      var v = L.cont.length ? [L.code + ' ' + L.cont.join(' '), L.code, L.cont.join(' ')] : [L.code];
      var c1 = L.code.split(/\s+-\s+|\s{2,}/)[0], c2 = L.code.split(/\s+/)[0]; [c1, c2].forEach(function (c) { if (c && v.indexOf(c) < 0) v.push(c); });   // "W3012 - Wall 30\"W…", "DVW-SB30 SIGNATURE SPECIAL -"
      if (!L.code) { v = []; }
      var m = v.length ? matchAny(v, { style: L.g.style }, ix) : { status: 'none', picks: [], cands: [], how: 'no code' };
      if (m.status !== 'ok' && L.desc) {                                         // other-store quotes: code at the start of the description
        var dm = matchAny([L.desc.split(/\s+/)[0]], { style: L.g.style }, ix); if (dm.status === 'ok') m = dm; }
      return finish({ code: (m.status !== 'none' || !v[0] ? v[0] : (v.length > 1 && v[v.length - 1].length < v[0].length ? v[v.length - 1] : v[0])) || L.desc.slice(0, 40), qty: L.qty, qtyHow: L.qtyHow, desc: L.desc.slice(0, 160), status: m.status, picks: m.picks, cands: m.cands, how: m.how });
    });
    return { kind: H.kind, customer: H.customer, quoteNo: H.quoteNo, style: H.style || styleG.filter(Boolean)[0] || null, lines: out, source: 'pdf text layer' };
  }

  // ------------------------------------------------------------------ B: OCR plain text
  var PRICE_RE = /^\$?\d{1,3}(?:,\d{3})*\.\d{2}$|^\$?\d+\.\d{2}$/;
  function parseText(text, bundle) {
    var ix = buildIndex(bundle), H = headerInfo(text, ix), style = H.style;
    var raw = String(text || '').split(/\r?\n/), lines = [], started = false, stopped = false, orphan = null, out = [];
    for (var li = 0; li < raw.length; li++) {
      if (stopped && raw[li] !== '\f') continue;
      if (raw[li] === '\f') { stopped = false; continue; }                       // next photo / page of the same quote (20261017h)
      var line = raw[li].replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim(); if (!line) continue;
      var flat = despaceAll(line);
      if (!started && /\b(ITEM|Quantity|QTY)\b/i.test(flat) && /\b(Description|Quantity|QTY|Rate|Amount)\b/i.test(flat)) { started = true; continue; }
      if (/·|-\s*SHAKER|UPPERS|BASES|TALL\b|PANELS|VANITY/.test(flat) && !/\d\s*$/.test(flat) && /^[^a-z]*$/.test(flat.replace(/\(CONT\.\)/, ''))) { var st = styleOf(flat, ix); if (st || !H.style) style = st || style; else style = H.style; continue; }
      if (/^(sub ?total|total\b|tax total|notes?\b|n o t e s|discount\b)/i.test(flat)) { if (started || lines.length) { stopped = /total|notes?|n o t e s/i.test(flat) && !/sub/i.test(flat) && lines.length > 0; } continue; }
      if (!started && !H.kind.match(/eaststar/)) { /* before the table header: still allow lines for header-less photos */ }
      var T = line.split(' '), found = [], i = 0, isES = /eaststar/.test(H.kind);
      if (isES && /^[A-Z][A-Z &()\-·.]{4,}$/.test(flat) && flat.split(' ').length <= 6) { flushOrphan(); continue; }
      while (i < T.length) {
        var best = null;
        for (var n = Math.min(5, T.length - i); n >= 1 && !best; n--) {
          var span = T.slice(i, i + n).join(' '), k = norm(span);
          if (k.length < (style ? 2 : 4) || /^\(/.test(T[i]) || PRICE_RE.test(T[i])) continue;
          if (n === 1 && /^\d{1,4}$/.test(span)) continue;
          var ctx = { style: style, ocr: true }, m = matchCode(span, ctx, ix);
          if (m && m.status === 'ok') {
            if (/^cabinet/.test(m.how)) { var prev = T[i - 1], nx = T[i + n] || '';   // cabinet codes only at a column start (not "(plan BC42SR) BBC36 door +")
              if (i > 0 && !/^[^\d]{0,2}\d{1,3}$/.test(prev || '') && !/^[A-Z][a-z]/.test(nx)) continue; }
            if (n === 1 && !/\d/.test(k) && ix.exact[span] == null && !/^cabinet/.test(m.how)) continue;
            best = { i: i, n: n, m: m, span: span };
          }
        }
        if (!best && /\d/.test(T[i]) && norm(T[i]).length >= 6 && !PRICE_RE.test(T[i]) && !/^\(/.test(T[i]) && /[A-Z]/i.test(T[i]) && (i === 0 || /^\d{1,3}$/.test(T[i - 1] || ''))) {
          var cm = matchCode(T[i], { style: style }, ix) || closeMatch(T[i], ix); if (cm) best = { i: i, n: 1, m: cm, span: T[i] };
        }
        if (best) { found.push(best); i += best.n; } else i++;
      }
      // a wrapped code (NetSuite: "ECO-EC.INFINITY" / "MARFIL 90", "TOTO" / "CST672..."): join with the next line's first tokens
      if (!found.length || found[0].m.status !== 'ok') {
        var nxt = (raw[li + 1] || '').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
        var nOwn = nxt[0] && matchCode(nxt[0], { style: style, ocr: true }, ix); if (nOwn && nOwn.status === 'ok' && !/^[A-Z]{2,}$/.test(T[T.length - 1] || '')) nxt = [];
        for (var a = 1; a <= Math.min(3, T.length) && nxt.length && (!found.length || found[0].m.status !== 'ok'); a++) for (var b = Math.min(4, nxt.length); b >= 1; b--) {
          var j = T.slice(0, a).join(' ') + ' ' + nxt.slice(0, b).join(' '), mj = matchCode(j, { style: style }, ix);
          if (mj && mj.status === 'ok') { found = [{ i: 0, n: a, m: mj, span: j, wrapped: true }]; break; }
        }
        // renamed item: the wrapped code's words are all inside one item name -> 'check' with candidates (never auto-picked)
        var brand = norm(T[0]); if (!found.length && brand.length >= 3 && ix.tok[toks(T[0])[0]] && /^[A-Z]{2,}/.test(brand)) {
          var ints0 = []; for (var a2 = 1; a2 < T.length && /^[A-Za-z.\-]+$/.test(T[a2]); a2++) {}
          for (var b2 = Math.min(4, nxt.length); b2 >= 1 && !found.length; b2--) { var j2 = T.slice(0, a2).join(' ') + ' ' + nxt.slice(0, b2).join(' '), cm2 = closeMatch(j2, ix); if (cm2 && cm2.cands.length <= 4) found = [{ i: 0, n: a2, m: cm2, span: j2, wrapped: true }]; }
        }
      }
      if (!found.length) {                                                       // prices / leading qty with no code: keep for the next line
        flushOrphan();
        var ints = T.filter(function (t) { return /^\d{1,4}$/.test(t); }), prs = T.filter(function (t) { return PRICE_RE.test(t); });
        orphan = (prs.length >= 2 || ints.length) ? { prices: prs, lead: /^\d{1,4}$/.test(T[0]) ? +T[0] : null, li: li, text: line } : null;
        // East Star quote row "CODE description … QTY" whose code is not in the item list: flag it (tap to search)
        if (isES && /\d/.test(T[0]) && /[A-Z]/i.test(T[0]) && /^\d{1,4}$/.test(T[T.length - 1]) && T.length >= 3 && !/^\(/.test(T[0])) { lines.push({ code: T[0], qty: +T[T.length - 1], qtyHow: 'qty column', desc: T.slice(1, -1).join(' ').slice(0, 160), status: 'none', picks: [], cands: [], how: 'not in item list', _li: li }); orphan = null; }
        continue;
      }
      found.forEach(function (f, fi) {
        var end = fi + 1 < found.length ? found[fi + 1].i : T.length, seg = T.slice(f.i + f.n, end), qty = null, how = '';
        for (var z = 0; z < seg.length; z++) if (/^(Subtotal|Total|TOTAL|Less|After|SF)$/.test(seg[z])) { seg = seg.slice(0, z); break; }
        var key = f.m.picks.map(function (p) { return p.name; }).sort().join('|');
        if (key && lines.slice(-3).some(function (L) { return L._key === key && L._li >= li - 3; }) && (f.i > 0 || !/\d\s*$/.test(seg.join(' ')) || f.wrapped === undefined && seg.length && !/^[A-Z][a-z]/.test(seg[0]))) return;   // same code again in a description
        if (isES) { var tl = seg.slice(-2).map(function (t) { return t.replace(/^[^\d(]{1,2}(?=\d)/, ''); }).filter(function (t) { return /^\d{1,4}$/.test(t); }), lastT = tl[tl.length - 1]; qty = lastT ? +lastT : null; how = qty != null ? 'qty column' : '';
          if (qty == null) { qty = 1; how = 'not found (set to 1)'; }
          lines.push(finish({ code: f.span, qty: qty, qtyHow: how, desc: seg.slice(0, -1).join(' ').slice(0, 160), status: f.m.status, picks: f.m.picks, cands: f.m.cands, how: f.m.how, _key: key, _li: li })); return; }
        var prs = [], zt = seg.length - 1; while (zt >= 0 && PRICE_RE.test(seg[zt]) && prs.length < 2) prs.unshift(+seg[zt--].replace(/[$,]/g, ''));   // rate + amount sit at the END of a NetSuite row (not "1.28 GPF")
        var ints = seg.filter(function (t) { return /^\d{1,4}$/.test(t); }).map(Number);
        if (!prs.length && orphan && orphan.li === li - 1 && fi === 0) { prs = orphan.prices.map(function (t) { return +t.replace(/[$,]/g, ''); }); orphan.used = true; }
        if (prs.length >= 2) { var ra = prs[prs.length - 1] / prs[prs.length - 2]; if (prs[prs.length - 2] > 0 && Math.abs(ra - Math.round(ra)) < 0.01 && Math.round(ra) >= 1) { qty = Math.round(ra); how = 'amount ÷ rate'; } }
        var lead = fi === 0 && f.i > 0 && /^\d{1,4}$/.test(T[f.i - 1]) ? +T[f.i - 1] : null;
        if (qty == null && ints.length) { qty = prs.length ? ints[0] : ints[ints.length - 1]; how = 'number on the line'; }
        if (qty != null && ints.length && prs.length && ints[0] !== qty && lead == null) how += ' (check)';
        if (qty == null && lead != null) { qty = lead; how = 'number before the code'; }
        if (qty == null && orphan && orphan.li === li - 1 && orphan.lead != null && fi === 0) { qty = orphan.lead; how = 'number on the line above'; orphan.used = true; }
        if (qty == null) { qty = 1; how = 'not found (set to 1)'; }
        lines.push(finish({ code: f.span, qty: qty, qtyHow: how, desc: seg.filter(function (t) { return !PRICE_RE.test(t); }).join(' ').slice(0, 160), status: f.m.status, picks: f.m.picks, cands: f.m.cands, how: f.m.how, _key: key, _li: li }));
      });
      if (orphan && orphan.li === li - 1) orphan.used = true;   // a priced line right above a matched line belongs to it (wrapped code)
      orphan = null;
    }
    flushOrphan();
    function flushOrphan() {   // a NetSuite row with rate + amount but no code we know: flag it instead of dropping it
      if (orphan && !orphan.used && orphan.prices.length >= 2 && !/eaststar/.test(H.kind)) { var ot = orphan.text.split(' '), cut = ot.findIndex(function (t) { return /^\d{1,4}$/.test(t) || PRICE_RE.test(t); });
        var r1 = +orphan.prices[orphan.prices.length - 2].replace(/[$,]/g, ''), a1 = +orphan.prices[orphan.prices.length - 1].replace(/[$,]/g, ''), q1 = r1 ? a1 / r1 : 0;
        if (!/^(tax|total|sub|discount|s&h|amount)/i.test(ot[0])) lines.push({ code: ot.slice(0, cut > 0 ? Math.min(cut, 4) : 3).join(' '), qty: Math.abs(q1 - Math.round(q1)) < 0.01 && q1 >= 1 ? Math.round(q1) : 1, qtyHow: 'amount ÷ rate', desc: '', status: 'none', picks: [], cands: [], how: 'not in item list' }); }
      orphan = null;
    }
    return { kind: H.kind, customer: H.customer, quoteNo: H.quoteNo, style: style, lines: lines, source: 'ocr text' };
  }
  var API = { norm: norm, buildIndex: buildIndex, matchCode: matchCode, closeMatch: closeMatch, headerInfo: headerInfo, styleOf: styleOf, isHidden: isHidden,
    parseRows: function (rows, b) { return dropHidden(parseRows(rows, b)); }, parseText: function (t, b) { return dropHidden(parseText(t, b)); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.QuoteImport = API;
})(this);

/* ------------------------------------------------------------------ pdf.js text layer (digital PDFs) + review sheet (page side) */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;                       // node (tests) only needs the parser above
  var PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/', pdfP = null;
  var QP = root.QuoteImport;
  function zh() { return !!(root.I18N && I18N.lang() === 'zh'); }
  function T(en, cn) { return zh() ? cn : en; }                     // only for texts built with numbers the strings table can't see (toasts)
  /** pdf.js from the CDN, only when a PDF is picked (ES module; Function() keeps this file parseable on browsers without import()). */
  function loadPdfjs() {
    if (pdfP) return pdfP;
    var imp; try { imp = new Function('u', 'return import(u)'); } catch (e) { return Promise.reject(new Error('This browser cannot read PDFs. Update it and try again.')); }
    pdfP = imp(PDFJS + 'pdf.min.mjs').then(function (m) { var lib = m && m.getDocument ? m : (m && m.default) || m;
      lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return lib; },
      function () { pdfP = null; throw new Error('No connection. Check your internet and try again.'); });
    return pdfP;
  }
  function fileBytes(f) { if (f.arrayBuffer) return f.arrayBuffer();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(new Error('Could not open the file.')); }; r.readAsArrayBuffer(f); }); }
  /** Text-layer rows [{page, y, cells:[{x,w,s}], text}] (same as the tested node reader). Rotated text (watermark / stamp) is dropped. */
  function pdfRows(buf) {
    return loadPdfjs().then(function (lib) { return lib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise; }).then(function (doc) {
      var rows = [], chars = 0, n = Math.min(doc.numPages, 12), p = 0;
      function next() { p++; if (p > n) return Promise.resolve();
        return doc.getPage(p).then(function (page) { var vp = page.getViewport({ scale: 1 });
          return page.getTextContent().then(function (tc) { var items = [];
            tc.items.forEach(function (it) { var t = it.transform; if (!it.str || !it.str.trim()) return; chars += it.str.replace(/\s/g, '').length;
              if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) return;
              items.push({ x: t[4], y: vp.height - t[5], w: it.width, h: Math.abs(t[3]), s: it.str }); });
            items.sort(function (A, B) { return A.y - B.y || A.x - B.x; });
            var pr = [];
            items.forEach(function (it) { var r = null; for (var i = 0; i < pr.length; i++) if (Math.abs(pr[i].y - it.y) < Math.max(2.5, it.h * 0.45)) { r = pr[i]; break; }
              if (!r) { r = { page: p, y: it.y, cells: [] }; pr.push(r); } r.cells.push(it); });
            rows = rows.concat(pr); }); }).then(next); }
      return next().then(function () {
        rows.forEach(function (r) { r.cells.sort(function (a, b) { return a.x - b.x; }); var m = [];
          r.cells.forEach(function (c) { var L = m[m.length - 1]; if (L && c.x - (L.x + L.w) < 3) { L.s += (c.x - (L.x + L.w) > 1 ? ' ' : '') + c.s; L.w = c.x + c.w - L.x; } else m.push({ x: c.x, y: c.y, w: c.w, h: c.h, s: c.s }); });
          r.cells = m; r.text = m.map(function (c) { return c.s; }).join('  '); });
        rows.sort(function (a, b) { return a.page - b.page || a.y - b.y; });
        try { doc.destroy(); } catch (e) {}
        return { rows: rows, chars: chars };
      });
    });
  }

  // ------------------------------------------------------------------ review sheet
  var CSS = '.qish h3{margin:0 0 2px;padding-right:40px}.qish .qis{font-size:13px;color:var(--muted);overflow-wrap:anywhere}' +
    '.qisum{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0 4px}.qic{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:2px 8px}' +
    '.qic.src{background:#e9f0fb;color:#1e3a6e}.qic.ok{background:#e8f5ed;color:#14532d}.qic.chk{background:#fff4e0;color:#7a4a00}.qic.no{background:#fdecec;color:#7f1d1d}' +
    '.qil{margin:0 -16px;border-top:1px solid var(--line)}.qir{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:6px;padding:9px 12px 9px 8px;border-bottom:1px solid var(--line);align-items:start}' +
    '.qib{min-width:0}.qir.off .qib{opacity:.6}.qir input[type=checkbox]{width:22px;height:22px;margin:2px 0 0 4px;accent-color:#1f2a37}' +
    '.qicode{font-weight:700;font-size:14.5px;overflow-wrap:anywhere}.qinm{font-size:13px;color:#374151;margin-top:2px;overflow-wrap:anywhere}.qinm b{font-weight:600;color:var(--text)}' +
    '.qinm .qd{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qinm .qk{display:inline-block;min-width:34px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase}.qinm .qp{color:var(--muted)}' +
    '.qiw{font-size:12px;color:var(--muted);margin-top:3px}.qiw.warn{color:#7a4a00;font-weight:600}.qihn{font-size:12px;color:#1e3a6e;font-weight:600;margin-top:2px}' +
    '.qicd{display:flex;flex-direction:column;gap:4px;margin-top:6px}.qicd button{text-align:left;border:1px solid var(--line-strong);background:#fff;border-radius:10px;padding:6px 8px;font:inherit;font-size:13px;color:var(--text);cursor:pointer}' +
    '.qicd button.on{border-color:#14532d;background:#e8f5ed}.qisb{margin-top:6px;border:1px dashed #b42318;color:#b42318;background:#fff;border-radius:10px;padding:6px 10px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
    '.qisq{margin-top:6px;width:100%;box-sizing:border-box}.qiqt{display:flex;align-items:center;border:1px solid var(--line-strong);border-radius:999px;overflow:hidden;height:34px;background:#fff}' +
    '.qiqt button{width:30px;height:34px;border:0;background:#eef0f3;font-size:17px;cursor:pointer;color:var(--text)}.qiqt input{width:40px;text-align:center;border:0;font:inherit;font-weight:700;padding:0;height:34px;border-radius:0;background:#fff}' +
    '.qipz{margin-top:8px;border:1.5px dashed #b8c0cc;border-radius:10px;padding:10px 12px;color:var(--muted);font-size:14px;text-align:center;outline:0;-webkit-user-select:text;user-select:text;cursor:text}.qipz:focus{border-color:#1f2a37}' +
    '.qipp{font-size:13px;margin-left:10px}' +
    '.qiqt.warn{border-color:#d97706;box-shadow:0 0 0 2px #fde7c2}.qiqt.warn input{background:#fff7e8}' +
    '.qift{position:sticky;bottom:calc(-16px - env(safe-area-inset-bottom));margin:0 -16px -16px;background:#fff;border-top:1px solid var(--line);padding:8px 12px calc(12px + env(safe-area-inset-bottom));box-shadow:0 -4px 14px rgba(16,24,40,.08)}' +
    '.qift .qicnt{font-size:12.5px;color:var(--muted);margin-bottom:6px}.qibt{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.qibt .btn{margin:0;min-height:50px;min-width:0;width:100%;line-height:1.15;padding:4px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.qibt .btn .qbt{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.qiph{margin:0 0 8px}.qiph summary{font-size:13px;font-weight:600;color:#1e3a6e;cursor:pointer;padding:2px 0}.qiph img{display:block;width:100%;height:auto;margin-top:6px;border:1px solid var(--line);border-radius:8px}' +
    '.qibt .btn small{display:block;max-width:100%;font-weight:500;font-size:11.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qibt .btn:disabled{opacity:.45}';
  function css() { if (document.getElementById('qiCss')) return; var st = document.createElement('style'); st.id = 'qiCss'; st.textContent = CSS; document.head.appendChild(st); }
  var S = null;                                                     // the open review: {res, rows, to, file}
  function row(name) { return root.itemRow ? itemRow(name) : null; }
  function descOf(name) { var r = row(name); return r ? String(r[1] || '') : ''; }
  function priceOf(name) { var r = row(name); return r && root.priceState && priceState.prices && r[2] != null ? Number(r[2]) : null; }
  function money(v) { return root.money ? root.money(v) : '$' + Number(v).toFixed(2); }
  function kindOf(name, multi) { return !multi ? '' : /^BOX-/i.test(name) ? 'box' : /^(DF|DR|DOOR)-/i.test(name) ? 'door' : ''; }
  function qtyWarn(l) { return /not found|set to 1|check|number on the line|number before|line above/.test(l.qtyHow || ''); }   // 20261017h: a qty guessed from a loose number on an OCR line ("15 inch shower arm") is flagged too

  function sheetMsg(title, text, err) {
    openSheet('<div class="qish"><h3>' + esc(title) + '</h3><div class="msg ' + (err ? 'err' : 'ok') + '" style="margin-top:8px">' + esc(text) + '</div>' +
      '<div class="qirow" style="margin-top:10px"><button class="btn sec" id="qiAgain" type="button">Pick another file</button><button class="btn sec" type="button" data-qpaste="1">Paste image</button></div></div>');
    var to = S && S.to; document.getElementById('qiAgain').onclick = function () { root.quoteImport(to); }; bindPaste(to);
  }
  function soon(to) { S = { to: to };
    sheetMsg('Photo import is coming soon', 'For now, pick a PDF quote: a NetSuite estimate or an East Star quote PDF. Reading photos and scans is the next update.', false); }

  function scanSoon(to) { S = { to: to };
    sheetMsg('Photo import is coming soon', 'This PDF is a scan (it has no text in it). Reading scans and photos is the next update. For now, use the PDF from NetSuite or from our quote app.', false); }

  // ------------------------------------------------------------------ 20261017h: photos + scanned PDFs -> server Drive OCR ('quoteRead')
  var OCR_MAX_SIDE = 2000, OCR_TARGET = 900 * 1024, OCR_PDF_PAGES = 3, OCR_MAX_FILES = 5, BUSY_WAIT = 20;
  var QR = { avail: null };                                         // does the server have quoteRead? null = not asked yet (asked once per page load)
  function isPdfFile(f) { return /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
  function isImgFile(f) { return /^image\//i.test(f.type || '') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name || ''); }
  /** Cheap check with no file: v26 answers "No quote file to read.", an older server "Unknown action.". */
  function quoteReadAvail() {
    if (QR.avail != null) return Promise.resolve(QR.avail);
    return root.api('quoteRead', {}).then(function () { QR.avail = true; return true; }, function (er) {
      var m = String((er && er.message) || '');
      if (/unknown action/i.test(m)) { QR.avail = false; return false; }
      if (/no quote file/i.test(m)) { QR.avail = true; return true; }
      throw er; });
  }
  function b64Bytes(d) { var i = d.indexOf(','); return Math.floor((d.length - i - 1) * 3 / 4); }
  /** Any drawable -> one JPEG copy for OCR: long side 2000 px (big photos shrunk; small screenshots / JPG quotes enlarged up to 2x
   *  so the letters are big enough to read: S4 JPG 993 px read 9/18 lines as is, 15/18 at 2000 px), white behind transparent PNGs, quality stepped down (then size) until it is under 900 KB. */
  function ocrJpeg(src, w, h) {
    var L = Math.max(w, h) || 1, k = Math.min(OCR_MAX_SIDE / L, 2), qs = [0.86, 0.76, 0.66, 0.56], d = '', cw = 0, ch = 0;
    for (var round = 0; round < 5; round++) {
      cw = Math.max(1, Math.round(w * k)); ch = Math.max(1, Math.round(h * k));
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; var cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(src, 0, 0, cw, ch);
      for (var i = 0; i < qs.length; i++) { d = cv.toDataURL('image/jpeg', qs[i]); if (b64Bytes(d) <= OCR_TARGET) break; }
      cv.width = cv.height = 0;
      if (b64Bytes(d) <= OCR_TARGET) break;
      k *= 0.8;
    }
    if (!/^data:image\/jpeg/.test(d) || b64Bytes(d) > OCR_TARGET) throw new Error('Could not make this photo small enough to read.');
    return { data: d, mimeType: 'image/jpeg', w: cw, h: ch, bytes: b64Bytes(d) };
  }
  function imgCopy(file) {
    return new Promise(function (res, rej) {
      var u = (root.URL && URL.createObjectURL) ? URL.createObjectURL(file) : null, im = new Image();
      function done() { if (u) try { URL.revokeObjectURL(u); } catch (e) {} }
      im.onload = function () { try { var c = ocrJpeg(im, im.naturalWidth || im.width, im.naturalHeight || im.height); done(); res(c); } catch (e) { done(); rej(e); } };
      im.onerror = function () { done(); var e = new Error('This photo type can’t be opened here. Take a screenshot of it, or save it as a JPG, and pick that.'); e.prep = true; rej(e); };
      if (u) im.src = u; else { var r = new FileReader(); r.onload = function () { im.src = r.result; }; r.onerror = im.onerror; r.readAsDataURL(file); }
    });
  }
  /** Scanned PDF: pages 1-3 rendered with pdf.js (long side ~2000 px) -> one JPEG copy each. */
  function pdfCopies(file) {
    return fileBytes(file).then(function (buf) { return loadPdfjs().then(function (lib) { return lib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise; }); }).then(function (doc) {
      var out = [], n = Math.min(doc.numPages, OCR_PDF_PAGES), p = 0;
      function next() { p++; if (p > n) return Promise.resolve();
        return doc.getPage(p).then(function (page) { var v1 = page.getViewport({ scale: 1 }), sc = Math.min(OCR_MAX_SIDE / Math.max(v1.width, v1.height), 3), vp = page.getViewport({ scale: sc });
          var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height); var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
          return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () { out.push(ocrJpeg(cv, cv.width, cv.height)); cv.width = cv.height = 0; }); }).then(next); }
      return next().then(function () { var more = doc.numPages > n; try { doc.destroy(); } catch (e) {} out.more = more; return out; });
    });
  }
  function readingHtml(title) {
    return '<div class="qish" id="qiRd"><h3>' + esc(title) + '</h3><div class="spinner"></div><div class="hint" style="text-align:center" id="qiRdT">Getting the photo ready…</div>' +
      '<div class="hint" style="text-align:center;font-size:12px" id="qiRdS"></div></div>';
  }
  function reading(run) { return S && S.run === run && document.getElementById('qiRd') && document.getElementById('sheet').classList.contains('on'); }   // the sheet was closed / another file picked: stop quietly
  function rdText(t, sub) { var a = document.getElementById('qiRdT'), b = document.getElementById('qiRdS'); if (a) a.textContent = t; if (b && sub != null) b.textContent = sub; }
  function pageLabel(i, n, pdf) { return n > 1 ? T((pdf ? 'Google is reading page ' : 'Google is reading photo ') + (i + 1) + ' of ' + n + '…', 'Google 正在读取第 ' + (i + 1) + ' / ' + n + (pdf ? ' 页…' : ' 张照片…'))
    : (pdf ? 'Google is reading the scan…' : 'Google is reading the photo…'); }
  /** One OCR copy -> text. Rate limited: wait 20 s (countdown) and try once more, then give up with a retry button. */
  function readOne(c, i, n, pdf, run, again) {
    if (!reading(run)) return Promise.reject({ quiet: true });
    rdText(pageLabel(i, n, pdf), T('Usually 3–10 seconds', '通常需要 3–10 秒'));
    return root.api('quoteRead', { file: { data: c.data, mimeType: c.mimeType } }).then(function (r) {
      if (r && r.ok) return String(r.text || '');
      if (r && r.rate_limited && !again) return wait(BUSY_WAIT, run).then(function () { return readOne(c, i, n, pdf, run, true); });
      var e = new Error(r && r.rate_limited ? 'Google is still busy reading photos.' : ((r && r.error) || 'Could not read the quote.')); e.busy = !!(r && r.rate_limited); throw e;
    });
  }
  function wait(sec, run) { return new Promise(function (res, rej) { var left = sec;
    (function tick() { if (!reading(run)) return rej({ quiet: true });
      rdText('Google is busy. Trying again…', T('Trying again in ' + left + ' s', left + ' 秒后重试')); if (left-- <= 0) return res(); setTimeout(tick, 1000); })(); }); }
  /** src = {files:[images]} or {pdf:file}; texts already read are kept when "Try again" continues after an error. */
  function runOcr(src, to, fname) {
    var run = Date.now() + Math.random(); S = { to: to, run: run };
    var pdf = !!src.pdf, title = 'Items from a quote';
    openSheet(readingHtml(title));
    var avail = quoteReadAvail();                                    // asked while the photo is being made small
    var have = src.copies && !pdf ? src.copies.slice(0) : null;      // 20261017i: pasted pages are added to the same quote; pages already made are kept
    var prep = pdf ? (src.copies ? Promise.resolve(src.copies) : pdfCopies(src.pdf)) : (have && have.length >= src.files.length) ? Promise.resolve(have) : src.files.reduce(function (pr, f, i) { return pr.then(function (acc) {
      if (acc[i]) return acc;
      if (src.files.length > 1) rdText(T('Getting photo ' + (i + 1) + ' of ' + src.files.length + ' ready…', '正在准备第 ' + (i + 1) + ' / ' + src.files.length + ' 张照片…'));
      return imgCopy(f).then(function (c) { acc[i] = c; return acc; }); }); }, Promise.resolve(have || []));
    return Promise.all([avail, prep]).then(function (r) {
      var ok = r[0], copies = r[1]; src.copies = copies;
      if (!reading(run)) return;
      if (!ok) { if (pdf) scanSoon(to); else soon(to); return; }
      var texts = src.texts || (src.texts = []);
      function next(i) { if (i >= copies.length) return Promise.resolve();
        if (texts[i] != null) return next(i + 1);
        return readOne(copies[i], i, copies.length, pdf, run, false).then(function (t) { texts[i] = t; return next(i + 1); }); }
      return next(0).then(function () {
        if (!reading(run)) return;
        var data = root.localData;
        if (!data || !data.items) { sheetMsg(title, 'The item list is still loading. Try again in a moment.', true); return; }
        var res = QP.parseText(texts.join('\n\f\n'), data);              // \f = page break: a Total on one photo does not end the next one
        if (!res.lines.length) { sheetMsg(title, 'No item lines found. Make sure the item codes and the Qty column are in the photo, sharp and straight, then try again.', true); return; }
        res.source = pdf ? 'scan' : 'photo';
        review(res, to, fname, { src: pdf ? 'Scan' : (copies.length > 1 ? T(copies.length + ' photos', copies.length + ' 张照片') : 'Photo'), photos: copies.map(function (c) { return c.data; }), more: !!copies.more, srcObj: pdf ? null : src });
      });
    }).catch(function (er) {
      if (er && er.quiet) return;
      if (S && S.run !== run) return;
      var m = (er && er.message) || 'Could not read the quote.';
      openSheet('<div class="qish"><h3>' + esc(title) + '</h3><div class="msg err" style="margin-top:8px">' + esc(m) + '</div>' +
        ((er && er.busy) ? '<div class="hint" style="margin-top:6px">Google limits how many photos can be read in a row. Wait a minute, then try again.</div>' : '') +
        (er && er.prep ? '' : '<button class="btn" id="qiRetry" type="button" style="margin-top:10px">Try again</button>') + '<div class="qirow" style="margin-top:8px"><button class="btn sec" id="qiAgain" type="button">Pick another file</button><button class="btn sec" type="button" data-qpaste="1">Paste image</button></div></div>');
      var rb = document.getElementById('qiRetry'); if (rb) rb.onclick = function () { runOcr(src, to, fname); };
      document.getElementById('qiAgain').onclick = function () { root.quoteImport(to); }; bindPaste(to);
    });
  }

  /** Entry from index.html (file(s) already picked). to = {cid, noteId} or null (current note). */
  function run(files, to) {
    css(); S = { to: to };
    files = [].slice.call(files && files.length != null && !files.name ? files : [files]).filter(Boolean);
    var file = files.filter(isPdfFile)[0];
    if (!file) {
      var imgs = files.filter(isImgFile).slice(0, OCR_MAX_FILES);
      if (!imgs.length) { sheetMsg('Items from a quote', 'Pick a PDF or a photo of the quote.', true); return Promise.resolve(); }
      return runOcr({ files: imgs }, to, imgs[0].name || '');
    }
    if (file.size > 25e6) { sheetMsg('Items from a quote', 'This PDF is too big (over 25 MB).', true); return Promise.resolve(); }
    return fileBytes(file).then(pdfRows).then(function (r) {
      if (r.chars < 40) return runOcr({ pdf: file }, to, file.name || '');          // a scan: no text layer
      var data = root.localData;
      if (!data || !data.items) { sheetMsg('Items from a quote', 'The item list is still loading. Try again in a moment.', true); return; }
      var res = QP.parseRows(r.rows, data);
      if (!res.lines.length) { sheetMsg('Items from a quote', 'No item lines found in this PDF. It needs an Item / Qty table, like a NetSuite estimate or an East Star quote.', true); return; }
      review(res, to, file.name || '');
    }).catch(function (er) { sheetMsg('Items from a quote', (er && er.message) || 'Could not read this PDF.', true); });
  }
  function review(res, to, fname, ex) {
    ex = ex || {};
    S = { res: res, to: to, file: fname, src: ex.src || 'PDF', photos: ex.photos || null, more: !!ex.more, srcObj: ex.srcObj || null, rows: res.lines.map(function (l) {
      var per = l.status === 'ok' ? l.picks.map(function (p) { return { name: p.name, k: Math.max(1, Math.round(p.qty / (l.qty || 1))) }; }) : [];
      return { on: l.status === 'ok' && per.length > 0, qty: Math.max(1, Math.min(99999, l.qty || 1)), per: per, pick: null, srch: false, sq: '' }; }) };
    paint();
  }
  function targetInfo() {
    var to = S.to;
    if (to && root.custOpen && custOpen.id === to.cid) { var n = (custOpen.notes || []).filter(function (x) { return x.id === to.noteId; })[0];
      if (n) return { id: custOpen.id, name: projLabel(custOpen), noteId: n.id, noteTitle: n.title }; }
    if (root.curCust) return { id: curCust.id, name: curCust.name, noteId: curCust.noteId, noteTitle: curCust.noteTitle, cur: true };
    return null;
  }
  function custName() { var c = S.res.customer || {}; return c.name || ''; }
  function partsHtml(l, st) {
    var multi = st.per.length > 1, same = !multi && QP.norm(st.per[0] && st.per[0].name) === QP.norm(l.code);
    return st.per.map(function (p) { var pr = priceOf(p.name), k = kindOf(p.name, multi);
      return '<div class="qinm">' + (k ? '<span class="qk">' + k + '</span> ' : '') + (same ? '' : '<b class="notr">' + esc(p.name) + '</b> ') + (p.k > 1 ? '<span class="notr">×' + p.k + '</span> ' : '') +
        (pr != null ? '<span class="qp notr">' + esc(money(pr)) + '</span>' : '') + '<span class="qd notr">' + esc(descOf(p.name).slice(0, 90)) + '</span></div>'; }).join('');
  }
  function rowHtml(l, i) {
    var st = S.rows[i], w = qtyWarn(l), body;
    if (l.status === 'ok') body = partsHtml(l, st);
    else if (l.status === 'check') body = '<div class="qiw">Close match: tap the right one</div><div class="qicd">' + l.cands.slice(0, 3).map(function (c) {
        return '<button type="button" class="' + (st.pick === c ? 'on' : '') + '" data-qpick="' + i + '" data-qn="' + esc(c) + '"><b class="notr">' + (st.pick === c ? '✓ ' : '') + esc(c) + '</b> <span class="qd notr" style="color:var(--muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(descOf(c).slice(0, 80)) + '</span></button>'; }).join('') + '</div>';
    else body = (st.pick ? partsHtml(l, st) : l.discontinued ? '<div class="qiw">Discontinued: not offered. Search for a replacement.</div>' : '<div class="qiw">Not in the item list' + (l.desc ? ': <span class="notr">' + esc(l.desc.slice(0, 50)) + '</span>' : '') + '</div>') +
      (st.srch ? '<input class="qisq" type="search" data-qsq="' + i + '" value="' + esc(st.sq) + '" placeholder="Search the item list" autocomplete="off"><div class="qicd" id="qiRes' + i + '"></div>'
        : '<button type="button" class="qisb" data-qsrch="' + i + '">' + (st.pick ? 'Change…' : 'Search…') + '</button>');
    var chip = l.status === 'check' ? ' <span class="qic chk">check</span>' : l.status === 'none' ? ' <span class="qic no">not found</span>' : '';
    return '<div class="qir' + (st.on ? '' : ' off') + '" data-qrow="' + i + '"><input type="checkbox" aria-label="Add this line" data-qon="' + i + '"' + (st.on ? ' checked' : '') + (st.per.length ? '' : ' disabled') + '>' +
      '<div class="qib"><div class="qicode"><span class="notr">' + esc(l.code || '?') + '</span>' + chip + '</div>' + body +
      (l.note && st.per.length ? '<div class="qihn notr">' + esc(l.note) + '</div>' : '') +
      (w ? '<div class="qiw warn">Qty not on the quote: please check</div>' : '') + '</div>' +
      '<div class="qiqt' + (w ? ' warn' : '') + '"><button type="button" data-qq="' + i + '" data-d="-1" aria-label="Less">−</button><input inputmode="numeric" data-qqv="' + i + '" value="' + st.qty + '" aria-label="Qty"><button type="button" data-qq="' + i + '" data-d="1" aria-label="More">+</button></div></div>';
  }
  function counts() { var n = { ok: 0, check: 0, none: 0 }; S.res.lines.forEach(function (l) { n[l.status]++; }); return n; }
  function footHtml() {
    var on = 0, parts = 0; S.rows.forEach(function (r) { if (r.on && r.per.length) { on++; parts += r.per.length; } });
    var t = targetInfo(), nm = custName() || (S.res.quoteNo ? 'Quote ' + S.res.quoteNo : '');
    return '<div class="qicnt">' + on + ' of ' + S.res.lines.length + ' lines checked · ' + parts + ' items to add</div><div class="qibt">' +
      '<button type="button" class="btn sec" id="qiAdd"' + (on ? '' : ' disabled') + '>' + '<span class="qbt">' + (t ? 'Add to <span class="notr">' + esc(t.noteTitle) + '</span>' : 'Add to a note…') + '</span>' +
        '<small class="notr">' + esc(t ? t.name : '') + '</small></button>' +
      '<button type="button" class="btn" id="qiNew"' + (on ? '' : ' disabled') + '><span class="qbt">New project</span><small class="notr">' + esc(nm) + '</small></button></div>';
  }
  function paint() {
    var r = S.res, n = counts(), head = [r.quoteNo, r.customer && r.customer.name, r.customer && r.customer.phone].filter(Boolean).join(' · ') || S.file;
    openSheet('<div class="qish"><h3>Items from quote</h3><div class="qis notr">' + esc(head) + '</div><div class="qisum"><span class="qic src">' + esc(S.src || 'PDF') + '</span>' +
      '<span class="qic ok">' + n.ok + ' matched</span>' + (n.check ? '<span class="qic chk">' + n.check + ' to check</span>' : '') + (n.none ? '<span class="qic no">' + n.none + ' not found</span>' : '') +
      (r.style ? '<span class="qic src">Style <span class="notr">' + esc(r.style) + '</span></span>' : '') + '</div>' +
      '<div class="hint" style="margin:2px 0 6px">Prices are today’s list prices. Check the qty, then add.</div>' +
      (S.photos ? '<div class="hint" style="margin:0 0 6px">Read by Google from the photo: check each line against it.' + (S.more ? ' Only the first 3 pages were read.' : '') + '</div>' +
        '<details class="qiph"><summary>Show photo' + (S.srcObj && S.srcObj.files && S.srcObj.files.length < OCR_MAX_FILES ? ' <button type="button" class="link qipp" data-qpaste="1">+ Paste a page</button>' : '') + '</summary>' + S.photos.map(function (d) { return '<img alt="" src="' + d + '">'; }).join('') + '</details>' : '') +
      '<div class="qil" id="qiList">' + r.lines.map(rowHtml).join('') + '</div><div class="qift" id="qiFt">' + footHtml() + '</div></div>');
    bind(); bindPaste(S.to);
  }
  function repaintRow(i) { var el = document.querySelector('[data-qrow="' + i + '"]'); if (!el) return paint();
    var d = document.createElement('div'); d.innerHTML = rowHtml(S.res.lines[i], i); el.parentNode.replaceChild(d.firstChild, el); foot(); }
  function foot() { var f = document.getElementById('qiFt'); if (f) { f.innerHTML = footHtml(); bindFoot(); } }
  function setQty(i, v) { var st = S.rows[i]; st.qty = Math.max(1, Math.min(99999, Math.round(Number(v)) || 1)); }
  function search(i) {
    var st = S.rows[i], box = document.getElementById('qiRes' + i); if (!box) return;
    var q = String(st.sq || '').trim(), out = [];
    try { out = q.length >= 2 ? searchBundle_(localData, q, 8).items.filter(function (x) { return (x.price !== null || x.desc.indexOf('incoming only') < 0) && !QP.isHidden(x.name); }) : []; } catch (e) { out = []; }
    box.innerHTML = out.length ? out.slice(0, 6).map(function (x) { return '<button type="button" data-qsp="' + i + '" data-qn="' + esc(x.name) + '"><b class="notr">' + esc(x.name) + '</b> <span class="notr" style="color:var(--muted)">' + esc(String(x.desc || '').slice(0, 50)) + '</span></button>'; }).join('')
      : (q.length >= 2 ? '<div class="qiw">Nothing found</div>' : '');
  }
  function bind() {
    var b = document.getElementById('sheetBody');
    b.onclick = function (e) {
      var t = e.target, x;
      if ((x = t.closest('[data-qq]'))) { var i = +x.dataset.qq; setQty(i, S.rows[i].qty + Number(x.dataset.d)); var inp = document.querySelector('[data-qqv="' + i + '"]'); if (inp) inp.value = S.rows[i].qty; foot(); return; }
      if ((x = t.closest('[data-qpick]'))) { var j = +x.dataset.qpick, nm = x.dataset.qn, s1 = S.rows[j];
        if (s1.pick === nm) { s1.pick = null; s1.per = []; s1.on = false; } else { s1.pick = nm; s1.per = [{ name: nm, k: 1 }]; s1.on = true; } repaintRow(j); return; }
      if ((x = t.closest('[data-qsrch]'))) { var k = +x.dataset.qsrch, s2 = S.rows[k]; s2.srch = true; if (!s2.sq) s2.sq = S.res.lines[k].code || ''; repaintRow(k);
        var si = document.querySelector('[data-qsq="' + k + '"]'); if (si) { si.focus(); search(k); } return; }
      if ((x = t.closest('[data-qsp]'))) { var m = +x.dataset.qsp, s3 = S.rows[m]; s3.pick = x.dataset.qn; s3.per = [{ name: s3.pick, k: 1 }]; s3.on = true; s3.srch = false; repaintRow(m); return; }
    };
    b.onchange = function (e) { var t = e.target;
      if (t.dataset.qon != null) { var i = +t.dataset.qon; S.rows[i].on = t.checked && S.rows[i].per.length > 0; var r = t.closest('.qir'); if (r) r.classList.toggle('off', !S.rows[i].on); foot(); }
      else if (t.dataset.qqv != null) { var j = +t.dataset.qqv; setQty(j, t.value); t.value = S.rows[j].qty; foot(); } };
    b.oninput = function (e) { var t = e.target;
      if (t.dataset.qsq != null) { var i = +t.dataset.qsq; S.rows[i].sq = t.value; clearTimeout(S.st); S.st = setTimeout(function () { search(i); }, 150); }
      else if (t.dataset.qqv != null && t.value !== '') { setQty(+t.dataset.qqv, t.value); foot(); } };
    bindFoot();
  }
  /** Checked lines -> note lines {name, desc, qty, photo, note}. Same item from several quote lines = one line (the server merges same names anyway);
   *  hinge / blind hand notes ride on the door, joined when they differ ("1 HINGE LEFT · 2 HINGE RIGHT"). */
  function lines() {
    var by = {}, order = [];
    S.res.lines.forEach(function (l, i) { var st = S.rows[i]; if (!st.on || !st.per.length) return;
      st.per.forEach(function (p) { if (QP.isHidden(p.name)) return; var q = p.k * st.qty, note = l.note && !/^BOX-/i.test(p.name) ? l.note : '';
        if (l.status !== 'ok') note = '';
        var e = by[p.name]; if (!e) { e = by[p.name] = { name: p.name, qty: 0, notes: [] }; order.push(e); }
        e.qty += q; if (note) e.notes.push([note, q]); }); });
    return order.map(function (e) { var r = row(e.name), it = r && root.itemFromRow ? itemFromRow(r) : { desc: descOf(e.name), photo: '' };
      var nn = {}; e.notes.forEach(function (x) { nn[x[0]] = (nn[x[0]] || 0) + x[1]; }); var keys = Object.keys(nn);
      var note = keys.length === 1 && e.notes.reduce(function (s, x) { return s + x[1]; }, 0) === e.qty ? keys[0] : keys.map(function (k) { return nn[k] + ' ' + k; }).join(' · ');
      return { name: e.name, desc: String(it.desc || '').slice(0, 110), qty: Math.min(99999, e.qty), photo: it.photo || '', note: note.slice(0, 280) }; });
  }
  function bindFoot() {
    var a = document.getElementById('qiAdd'), n = document.getElementById('qiNew');
    if (a) a.onclick = function () { var L = lines(); if (!L.length) return; var t = targetInfo(); closeSheet();
      if (t && !t.cur) addToNote(L, true, t); else addToNote(L, true);
      S = null; };
    if (n) n.onclick = function () { var L = lines(); if (!L.length) return; this.disabled = true;
      var c = S.res.customer || {}, info = { name: c.name || '', phone: c.phone || '', notes: 'From quote ' + (S.res.quoteNo || S.file || '') };
      S = null; newProjectFromQuote(info, L); };
  }
  // ------------------------------------------------------------------ 20261017i: paste a copied image / screenshot (Ctrl+V, long-press Paste, "Paste image")
  var PASTE_MSG = 'Copy the quote image first, then tap Paste image. On a computer you can also press Ctrl+V.';
  function pastedFiles(list) { var t = Date.now(); return [].slice.call(list || []).filter(isImgFile).map(function (f, i) {
    return f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? f : new File([f], 'pasted-quote-' + t + '-' + (i + 1) + '.' + ((String(f.type).split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type || 'image/png' }); }); }
  /** Images pasted while a quote-import screen is open (index.html paste listener, the "Paste image" button). to = target note or null.
   *  On the review of a photo quote they are added as more pages of the SAME quote (up to 5); otherwise they start a new photo import. */
  function paste(list, to) {
    css(); var fs = pastedFiles(list); if (!fs.length) return Promise.resolve(false);
    var cur = S, src = cur && cur.srcObj && cur.srcObj.files && !cur.srcObj.pdf ? cur.srcObj : null;
    if (src && cur.res && document.getElementById('qiList')) {
      var room = OCR_MAX_FILES - src.files.length;
      if (room <= 0) { if (root.toast) root.toast(T('Up to 5 photos per quote', '每份报价最多 5 张照片')); return Promise.resolve(false); }
      src.files = src.files.concat(fs.slice(0, room)); src.texts = src.texts || [];
      return runOcr(src, cur.to, cur.file).then(function () { return true; });
    }
    if (!to && cur && cur.to) to = cur.to;
    return run(fs.slice(0, OCR_MAX_FILES), to || null).then(function () { return true; });
  }
  /** "Paste image" button: the async clipboard (Chrome / Edge ask once; iPhone shows its own "Paste" bubble). */
  function pasteBtn(to) {
    var cb = navigator.clipboard;
    if (!cb || !cb.read) { pasteHelp(to); return Promise.resolve(false); }
    return cb.read().then(function (items) {
      var ps = [];
      items.forEach(function (it) { var ty = (it.types || []).filter(function (x) { return /^image\//.test(x); })[0]; if (ty) ps.push(it.getType(ty).then(function (b) { return new File([b], 'image.' + (ty.split('/')[1] || 'png'), { type: ty }); })); });
      return Promise.all(ps);
    }).then(function (files) { if (!files.length) { pasteHelp(to, 'No image is copied right now.'); return false; } return paste(files, to); },
      function () { pasteHelp(to); return false; });
  }
  /** Paste screen (also index.html when the file picker was closed without a file): a long-press target + the two ways in, one row. */
  function pasteSheet(to, note) {
    css(); S = { to: to || null };
    openSheet('<div class="qish"><h3>Items from a quote</h3>' + (note ? '<div class="msg err" style="margin-top:8px">' + esc(note) + '</div>' : '') +
      '<div class="qipz" id="qiPz" contenteditable="true" inputmode="none" aria-label="Paste image here">Paste a copied image or screenshot here: Ctrl+V, or long-press and Paste</div>' +
      '<div class="qirow" style="margin-top:8px"><button class="btn sec" id="qiAgain" type="button">Pick a file</button><button class="btn sec" type="button" data-qpaste="1">Paste image</button></div></div>');
    document.getElementById('qiAgain').onclick = function () { root.quoteImport(to || null); }; bindPaste(to);
    var pz = document.getElementById('qiPz'); pz.oninput = function () { pz.textContent = 'Paste a copied image or screenshot here: Ctrl+V, or long-press and Paste'; };   // typed / pasted text is not kept
  }
  function pasteHelp(to, why) { pasteSheet(to, why ? why + ' ' + PASTE_MSG : PASTE_MSG); }
  function bindPaste(to) { [].forEach.call(document.querySelectorAll('#sheetBody [data-qpaste]'), function (b) { b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); pasteBtn(to); }; }); }
  root.QIUI = { run: run, review: review, paste: paste, pasteBtn: pasteBtn, pasteSheet: pasteSheet, lines: function () { return S ? lines() : []; }, state: function () { return S; }, loadPdfjs: loadPdfjs, pdfRows: pdfRows,
    ocrJpeg: ocrJpeg, quoteReadAvail: quoteReadAvail, _qr: QR };
})(this);
