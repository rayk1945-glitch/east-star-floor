/**
 * East Star Red app - forgiving ranked search (v2). Pure JS, no Apps Script services, so the same
 * file runs in Apps Script, the local test server and the Node index builder (sync/build_index.js).
 * 20261017o: one-digit wildcards in codes: "67x" / "67?" = 670-679 anywhere in a code, "67xx" = 2 digits, "67*" = any run (wildPattern_).
 *
 * Bundle (built by Red's sync step):
 *   items:    [name, description, price, onHand, onOrder, sfShelf, freShelf, ..., photo(13), locStock(14)]
 *   incoming: [itemCode, qty, shipment, container, date, status]
 *   synonyms: {tokens:{}, phrases:{}}   (from synonyms.json)
 *   index:    prebuilt by buildIndex_() at sync time so a request does not have to tokenise 23k items
 *
 * Matching: case/space/dash/#/slash/dot-insensitive ("2068w3040" == "2068-w3040" == "w3040 2068"),
 * token exact > prefix > substring, typo tolerance (edit distance 1 for 4-6 letters, 2 for 7+, plus
 * trigram similarity), synonyms. Ranking: words matched first, then score (name beats description,
 * exact > prefix > fuzzy), small boost for items in stock. EXACT FIRST: when any item contains every typed word, only
 * those are listed; typo / close matches only when nothing is exact (fallback). Never empty when anything is close:
 * partial matches are returned as "closest", with "Did you mean" suggestions for corrected words.
 */

var SEARCH_LIMIT = 30;
/** Query words that name a floor category; items in that category rank higher. */
var CATEGORY_WORDS_ = { FAUCET: 'Faucets', FAUCETS: 'Faucets', TAP: 'Faucets', SINK: 'Sinks', SINKS: 'Sinks', TOILET: 'Toilets', TOILETS: 'Toilets',
  HOOD: 'Range hoods', HOODS: 'Range hoods', QUARTZ: 'Countertops', COUNTERTOP: 'Countertops', GRANITE: 'Countertops', TILE: 'Tile', TILES: 'Tile',
  VANITY: 'Vanities & mirrors', MIRROR: 'Vanities & mirrors', SHOWER: 'Shower', APPLIANCE: 'Appliances', OVEN: 'Appliances', COOKTOP: 'Appliances',
  GROUT: 'Grout & setting', THINSET: 'Grout & setting', FLOORING: 'Flooring', CABINET: 'Cabinets',
  TAPS: 'Faucets', RANGEHOOD: 'Range hoods', RANGEHOODS: 'Range hoods', VANITIES: 'Vanities & mirrors', MIRRORS: 'Vanities & mirrors',
  SHOWERS: 'Shower', APPLIANCES: 'Appliances', COUNTERTOPS: 'Countertops', CABINETS: 'Cabinets' };
/** Words that only narrow a type ("range hood", "vent hood", "kitchen sink"): a query made of these + type words is a TYPE search. */
var TYPE_FILLER_ = { RANGE: 1, VENT: 1, EXHAUST: 1, KITCHEN: 1, BATH: 1, BATHROOM: 1, ALL: 1, KITCHENS: 1 };
/** Chinese type words -> English, so 抽油烟机 = range hood (the index is A-Z/0-9 only). Longest first. */
var CJK_TYPE_WORDS_ = [['抽油烟机', ' range hood '], ['油烟机', ' range hood '], ['烟机', ' range hood '], ['水龙头', ' faucet '], ['龙头', ' faucet '],
  ['水槽', ' sink '], ['洗菜盆', ' sink '], ['马桶', ' toilet '], ['坐便器', ' toilet '], ['浴室柜', ' vanity '], ['瓷砖', ' tile '], ['地砖', ' tile '], ['墙砖', ' tile '],
  ['花洒', ' shower '], ['淋浴', ' shower '], ['橱柜', ' cabinet '], ['石英石', ' quartz '], ['台面', ' countertop ']];
var CJK_RE_ = /[\u3400-\u9fff\uf900-\ufaff]+/g;
var ZH_CACHE_ = { ver: null, list: null, hay: null };
/** Chinese type names -> English: built-in list + bundle.zhTypes {中文: 'english type'} (from categories.json "zh" and
 *  type-names-zh.json, folded in by build_data.py). Longest first, so 抽油烟机 wins over 烟机. */
function zhList_(bundle) {
  if (ZH_CACHE_.ver === bundle.version && ZH_CACHE_.list) return ZH_CACHE_.list;
  var m = {}, k, i; for (i = 0; i < CJK_TYPE_WORDS_.length; i++) m[CJK_TYPE_WORDS_[i][0]] = CJK_TYPE_WORDS_[i][1];
  for (k in (bundle.zhTypes || {})) if (CJK_RE_.test(k) && (CJK_RE_.lastIndex = 0, true)) m[k] = ' ' + bundle.zhTypes[k] + ' ';
  CJK_RE_.lastIndex = 0;
  var list = Object.keys(m).sort(function (a, b) { return b.length - a.length; }).map(function (z) { return [z, m[z]]; });
  ZH_CACHE_ = { ver: bundle.version, list: list, hay: ZH_CACHE_.ver === bundle.version ? ZH_CACHE_.hay : null };
  return list;
}
function cjkTypes_(q, bundle) { var l = bundle ? zhList_(bundle) : CJK_TYPE_WORDS_; for (var i = 0; i < l.length; i++) q = q.split(l[i][0]).join(l[i][1]); return q; }
/** Per item: the Chinese text of its name + description + tags (Chinese has no spaces, so it is matched as a substring). */
function cjkHay_(bundle) {
  zhList_(bundle); if (ZH_CACHE_.hay) return ZH_CACHE_.hay;
  var items = bundle.items || [], hay = new Array(items.length);
  for (var i = 0; i < items.length; i++) { var t = items[i][0] + ' ' + (items[i][1] || '') + ' ' + (items[i][12] || ''); hay[i] = (t.match(CJK_RE_) || []).join(' '); }
  return (ZH_CACHE_.hay = hay);
}
var ACCESSORY_RE_ = /\bSEAT\b|\bKIT\b|CONNECTION|REPAIR|REPLACEMENT|\bPART\b|\bGRID\b|STRAINER|BASKET|CARTRIDGE|ADAPTER|EXTENSION|SPLASH|BACKSPLASH|-BS\b|SHELF|DUCT|FILTER|\bCOVER\b|SOAP DISPENSER|BRACKET|HOSE|FLUSH VALVE|VACUUM BREAKER|WASHLET CONNECTION|TOILET SEAT/i;

/** Flooring trim/molding SKUs: LF-R- / LF-RDC- (reducer), LF-BN- / LF-STN- (stair-nose),
 *  LF-EC- / LF-ECP- (end-cap), LF-T- / LF-TM- (T-molding), LF-QR- (quarter round).
 *  No OS/SN/TH in the bundle; RD is covered by RDC. */
var FLOOR_MOLD_RE_ = /^LF-(?:RDC|STN|ECP|TM|BN|EC|QR|R|T)(?:-|$)/i;
function isFloorMolding_(name) { return FLOOR_MOLD_RE_.test(String(name || '')); }
/** Flooring plank/tile product (not trim): LF-… and not a molding prefix. */
function isFloorProduct_(r) {
  var n = String((r && r[0]) || '');
  return /^LF-/i.test(n) && !isFloorMolding_(n);
}
var DEFAULT_SYNONYMS_ = { tokens: { WB: ['WBC'], REP: ['REFPN', 'REFPN1'] }, phrases: {} };

function normCode_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/** 20261017n "Ends with" filter: the code ends with qn (normalized), as written or without its #suffix (MS672124CEFG#01 ends in 01 and in CEFG). */
/** 20261017n brand for the Brand chips: item[8] when filled ("Line ES" counts as ES, so it matches the code-prefix
 *  fallback), else the code's leading letters before the first space / dash / digit, uppercased (DF-#1669 -> DF). '' = none. */
function brandOf_(r) {
  var b = String((r && r[8]) || '').replace(/^\s*Line\s+/i, '').trim();
  if (b) return b;
  var m = String((r && r[0]) || '').trim().match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : '';
}
function codeEndsWith_(code, qn) {
  if (!qn) return false;
  if (/[?~*]/.test(qn)) { var wre = wildRe_(qn, '$'); return wre.test(normCode_(code)) || wre.test(normCode_(String(code || '').split('#')[0])); }   // 20261017o wildcard
  var a = normCode_(code), b = normCode_(String(code || '').split('#')[0]);
  return (a.length >= qn.length && a.slice(-qn.length) === qn) || (b.length >= qn.length && b.slice(-qn.length) === qn);
}

/** 20261017o one-digit wildcard (Ray: "67x, x can be any number"). One query word -> a pattern over A-Z / 0-9 plus
 *  '?' = one digit, '~' = one digit OR the letter X as typed (an x right after a digit, or after such an x, that is not
 *  followed by more digits: 67x, 67xx, MS67xCEFG; 12x24 / 4 x 4 are sizes and are taken out before this runs),
 *  '*' = any run of letters / digits. Dashes, spaces, # ... are ignored like normCode_. '' = not a wildcard code
 *  (needs a digit, 2+ fixed characters and 3+ characters besides '*'). */
function wildPattern_(w) {
  var s = String(w || '').toUpperCase().replace(/[^A-Z0-9?*]/g, ''), out = '', i, j;
  if (!/[0-9]/.test(s) || !/[?*X]/.test(s)) return '';
  for (i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === 'X' && i > 0 && (/[0-9]/.test(s.charAt(i - 1)) || out.charAt(out.length - 1) === '~')) {
      for (j = i; j < s.length && s.charAt(j) === 'X'; j++) {}
      if (!/[0-9]/.test(s.charAt(j))) { out += '~'; continue; }
    }
    out += c;
  }
  out = out.replace(/\*+/g, '*');
  if (!/[?~*]/.test(out)) return '';
  return out.replace(/[?~*]/g, '').length >= 2 && out.replace(/\*/g, '').length >= 3 ? out : '';
}
var WILD_RE_ = {}, WILD_RE_N_ = 0;
/** Pattern -> RegExp on a normCode_ string: mode '' = anywhere in the code, '$' = at the end (Ends with). Cached. */
function wildRe_(p, mode) {
  var k = (mode || '') + p;
  if (WILD_RE_[k]) return WILD_RE_[k];
  if (++WILD_RE_N_ > 300) { WILD_RE_ = {}; WILD_RE_N_ = 1; }
  var src = p.replace(/\?/g, '[0-9]').replace(/~/g, '[0-9X]').replace(/\*/g, '[A-Z0-9]*');
  return (WILD_RE_[k] = new RegExp(src + (mode === '$' ? '$' : '')));
}
/** Does any code in the item list match this wildcard pattern? */
function wildAny_(idx, p) { var re = wildRe_(p, ''), nn = idx.nn; for (var i = 0; i < nn.length; i++) if (re.test(nn[i])) return true; return false; }

/** Text -> tokens. Splits on anything not A-Z/0-9 and at digit->letter edges ("2068W3040" -> 2068, W3040; "A125ACG" -> A125, ACG). */
function tokenize_(s, glued) {
  var raw = String(s || '').toUpperCase().split(/[^A-Z0-9]+/), out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i]; if (!t) continue;
    var parts = t.split(/(?<=[0-9])(?=[A-Z])/);
    for (var j = 0; j < parts.length; j++) if (parts[j]) out.push(parts[j]);
    if (glued && parts.length > 1) out.push(t);   // index keeps the glued form too (A125ACG)
  }
  return out;
}

// ------------------------------------------------------------------ index
/** {nn: [nameNorm], nv: [name vocab], np: [[item ids]], dv: [desc vocab], dp: [[item ids]]} */
function buildIndex_(items) {
  var nmap = {}, dmap = {}, nn = new Array(items.length);
  for (var i = 0; i < items.length; i++) {
    var name = String(items[i][0]);
    nn[i] = normCode_(name);
    var seen = {};
    tokenize_(name, true).forEach(function (t) { if (!seen[t]) { seen[t] = 1; (nmap[t] = nmap[t] || []).push(i); } });
    var dseen = {};
    tokenize_(items[i][1] + ' ' + (items[i][12] || ''), true).forEach(function (t) {
      if (t.length < 2 || seen[t] || dseen[t]) return; dseen[t] = 1; (dmap[t] = dmap[t] || []).push(i);
    });
  }
  var nv = Object.keys(nmap), dv = Object.keys(dmap);
  return { nn: nn, nv: nv, np: nv.map(function (t) { return nmap[t]; }), dv: dv, dp: dv.map(function (t) { return dmap[t]; }) };
}

var INDEX_CACHE_ = { ver: null, idx: null };
function getIndex_(bundle) {
  if (bundle.index && bundle.index.nn && bundle.index.nn.length === bundle.items.length) return bundle.index;
  if (INDEX_CACHE_.ver !== bundle.version) { INDEX_CACHE_ = { ver: bundle.version, idx: buildIndex_(bundle.items) }; }
  return INDEX_CACHE_.idx;
}

// ------------------------------------------------------------------ fuzzy helpers
/** Levenshtein distance with early exit; returns max+1 when over max. */
function editDist_(a, b, max) {
  var la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
  for (j = 0; j <= lb; j++) prev[j] = j;
  for (i = 1; i <= la; i++) {
    cur[0] = i; var rowMin = i, ca = a.charCodeAt(i - 1);
    for (j = 1; j <= lb; j++) {
      var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    var t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}
function trigrams_(s) { s = '  ' + s + ' '; var g = {}; for (var i = 0; i < s.length - 2; i++) g[s.substr(i, 3)] = 1; return g; }
function trigramSim_(ga, b) {
  var gb = trigrams_(b), inter = 0, na = 0, nb = 0, k;
  for (k in ga) { na++; if (gb[k]) inter++; }
  for (k in gb) nb++;
  return inter / (na + nb - inter);
}
function maxEdits_(t) { return /^\d+$/.test(t) ? 0 : t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0; }

/**
 * Score one query token against a vocabulary: returns [{v, s, kind}] for vocab entries that match.
 * kind: exact | prefix | sub | fuzzy. Scores are 0..100 (caller scales name vs description).
 */
function vocabMatches_(t, vocab, allowFuzzy) {
  var out = [], numeric = /^\d+$/.test(t), shortNum = numeric && t.length <= 2;
  for (var i = 0; i < vocab.length; i++) {
    var v = vocab[i];
    if (v === t) { out.push({ i: i, s: 100, kind: 'exact' }); continue; }
    if (shortNum) continue;                                   // "30" must be a whole number, not 305 / 3012
    if (v.length > t.length && v.lastIndexOf(t, 0) === 0) {
      if (t.length >= 2) out.push({ i: i, s: 88 - Math.min(12, v.length - t.length), kind: 'prefix' });
      continue;
    }
    if (t.length >= 3 && v.length > t.length && v.indexOf(t) > 0) out.push({ i: i, s: numeric ? 72 : 62, kind: 'sub' });
  }
  if (!allowFuzzy) return out;
  var ed = maxEdits_(t), tg = t.length >= 4 ? trigrams_(t) : null;
  if (!ed && !tg) return out;
  for (i = 0; i < vocab.length; i++) {
    v = vocab[i];
    if (v === t || /^\d+$/.test(v) || Math.abs(v.length - t.length) > Math.max(ed, 3)) continue;
    if (v.indexOf(t) >= 0) continue;
    var d = ed ? editDist_(t, v, ed) : 99;
    if (d <= ed) { out.push({ i: i, s: 62 - 14 * d, kind: 'fuzzy' }); continue; }
    if (t.length >= 4 && v.length > t.length + 1 && editDist_(t, v.slice(0, t.length + 1), 1) <= 1) { out.push({ i: i, s: 46, kind: 'fuzzy' }); continue; }
    if (tg && Math.abs(v.length - t.length) <= 3) {
      var sim = trigramSim_(tg, v);
      if (sim >= 0.45) out.push({ i: i, s: Math.round(60 * sim), kind: 'fuzzy' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ query parsing
/** Query -> terms. Each term = {label, alts: [[tokens...]...]}; a term matches when every token of any alt matches. */
function parseQuery_(q, syn, noWild) {
  syn = syn || DEFAULT_SYNONYMS_;
  var tokS = {}, k;
  for (k in (syn.tokens || {})) tokS[normCode_(k)] = syn.tokens[k];
  var sizes = [];
  q = String(q).replace(/(\d+(?:\.\d+)?)\s*(?:"|in)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:"|in)?/gi, function (m0, a, b) { sizes.push([a, b]); return ' '; });
  var wild = [];                                             // 20261017o: wildcard code words (67x, 2?30) -> own terms
  if (!noWild) q = q.replace(/\S+/g, function (w) { var p = wildPattern_(w); if (!p) return w; wild.push(p); return ' '; });
  var words = tokenize_(q);
  var used = new Array(words.length), terms = [];
  var phrases = Object.keys(syn.phrases || {}).map(function (p) { return { toks: tokenize_(p), alts: syn.phrases[p] }; })
    .sort(function (a, b) { return b.toks.length - a.toks.length; });
  for (var i = 0; i < words.length; i++) {
    if (used[i]) continue;
    var hit = null;
    for (var p = 0; p < phrases.length && !hit; p++) {
      var pt = phrases[p].toks;
      if (i + pt.length <= words.length && pt.every(function (w, j) { return words[i + j] === w; })) hit = phrases[p];
    }
    if (hit) {
      for (var j = 0; j < hit.toks.length; j++) used[i + j] = true;
      terms.push({ label: hit.toks.join(' '), alts: [hit.toks].concat(hit.alts.map(function (a) { return tokenize_(a); })) });
      continue;
    }
    var w = words[i], alts = [[w]];
    if (tokS[w]) tokS[w].forEach(function (a) { alts.push(tokenize_(a).length > 1 ? tokenize_(a) : [normCode_(a)]); });
    var m = w.match(/^([A-Z]+)(\d.*)$/);                      // WB2740 -> WBC2740
    if (m && tokS[m[1]]) tokS[m[1]].forEach(function (a) { alts.push([normCode_(a) + m[2]]); });
    terms.push({ label: w, alts: alts });
  }
  wild.forEach(function (p) { terms.push({ label: p.replace(/~/g, 'x'), alts: [], wild: p }); });
  sizes.forEach(function (ab) { terms.push({ label: ab[0] + 'x' + ab[1], alts: [[ab[0] + 'X' + ab[1]], [ab[1] + 'X' + ab[0]]] }); });
  return terms;
}

// ------------------------------------------------------------------ search
function itemOut_(r, inc, why) {
  var lines = inc[normCode_(r[0])] || [];
  var total = lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
  return { name: r[0], desc: r[1], price: r[2], onHand: r[3], onOrder: r[4], sf: r[5], fre: r[6], incoming: lines, incomingTotal: total,
           cat: r[7] || '', brand: r[8] || '', finishes: r[9] || [], size: r[10] || '', tile: r[11] || null, photo: r[13] || '', loc: r[14] || [], match: why || '' };
}

var INCOMING_INDEX_ = null, INCOMING_VER_ = null;
function incomingIndex_(bundle) {
  if (INCOMING_INDEX_ && INCOMING_VER_ === bundle.version) return INCOMING_INDEX_;
  var idx = {};
  (bundle.incoming || []).forEach(function (r) { var k = normCode_(r[0]); (idx[k] = idx[k] || []).push({ code: r[0], qty: r[1], shipment: r[2], container: r[3], date: r[4], status: r[5] }); });
  INCOMING_INDEX_ = idx; INCOMING_VER_ = bundle.version; return idx;
}

/**
 * f (optional) = {cat, inStock, ends (code ends with the typed text; facets.ends counts those), brand (brandOf_; facets.brands [[brand, n]]), store: 'SF'|'FRE', size, finish, flooring, offset}: narrows the ranked list and pages it ("Load more").
 * facets = counts over the FULL match set (all-words matches, or the closest set when nothing matches every word), each
 * computed with the other filters applied: cats [[cat, n]] in Browse order, stock / sf / fre / flooring counts, sizes [[size, n]] (Tile/Flooring),
 * finishes [[label, n, named]] from variantIndex_ (Chrome, Brushed Nickel, …).
 * SF / FRE = the item has a shelf location at that store (the item list has one on-hand total, not per store).
 */
function searchBundle_(bundle, q, limit, f) {
  f = f || {};
  q = cjkTypes_(String(q || ''), bundle).replace(/\s+/g, ' ').trim();
  var cjk = (q.match(CJK_RE_) || []).filter(function (w, k, a) { return a.indexOf(w) === k; }).slice(0, 4);   // Chinese left after type words
  if (normCode_(q).length < 2 && !cjk.some(function (w) { return w.length >= 2; })) throw new Error('Type at least 2 letters or numbers.');
  if (q.length > 100) q = q.slice(0, 100);
  limit = Math.min(Number(limit) || SEARCH_LIMIT, 100);
  var items = bundle.items || [], idx = getIndex_(bundle), inc = incomingIndex_(bundle);
  var terms = parseQuery_(q, bundle.synonyms).slice(0, 8);
  // 20261017o: a wildcard word no code matches -> the query is read the old way (x / ? ignored, typo / close matches)
  if (terms.some(function (t) { return t.wild && !wildAny_(idx, t.wild); })) terms = parseQuery_(q, bundle.synonyms, true).slice(0, 8);
  var hasWild = terms.some(function (t) { return t.wild; });
  terms = terms.concat(cjk.map(function (w) { return { label: w, alts: [], cjk: w }; }));
  var qNorm = normCode_(q), N = items.length, T = terms.length;
  var wq = T === 1 && terms[0].wild ? terms[0].wild : '';    // 20261017o: the whole search is one wildcard code
  var tokCache = {}, dirCache = {}, best = {};         // best[token] = best vocab correction for Did you mean

  /** token -> Float32Array of per-item scores (name 1.0, description 0.55) */
  function tokenScores(t) {
    if (tokCache[t]) return tokCache[t];
    var sc = new Float32Array(N), dir = new Uint8Array(N), top = null, i, k;   // dir[i] = the word really appears (no typo fix)
    dirCache[t] = dir;
    if (t.length === 1) {                                // single letters: exact name tokens only
      var e = idx.nv.indexOf(t); if (e >= 0) idx.np[e].forEach(function (id) { sc[id] = 100; dir[id] = 1; });
      return (tokCache[t] = sc);
    }
    var nm = vocabMatches_(t, idx.nv, false), dm = vocabMatches_(t, idx.dv, false);
    var hasDirect = nm.concat(dm).some(function (m) { return m.kind === 'exact' || m.kind === 'prefix'; });
    if (!hasDirect) { nm = vocabMatches_(t, idx.nv, true); dm = vocabMatches_(t, idx.dv, true); }
    for (i = 0; i < nm.length; i++) { var s = nm[i].s, ps = idx.np[nm[i].i], dn = nm[i].kind !== 'fuzzy'; for (k = 0; k < ps.length; k++) { if (s > sc[ps[k]]) sc[ps[k]] = s; if (dn) dir[ps[k]] = 1; } }
    for (i = 0; i < dm.length; i++) { var s2 = dm[i].s * 0.55, ps2 = idx.dp[dm[i].i], dd = dm[i].kind !== 'fuzzy'; for (k = 0; k < ps2.length; k++) { if (s2 > sc[ps2[k]]) sc[ps2[k]] = s2; if (dd) dir[ps2[k]] = 1; } }
    if (t.length >= 3) for (i = 0; i < N; i++) if (idx.nn[i].indexOf(t) >= 0) { dir[i] = 1; if (sc[i] < 70) sc[i] = 70; }   // across separators: REFPN, 2068W3040
    // best correction (for Did you mean) when the token has no exact/prefix hit anywhere
    var direct = nm.concat(dm).some(function (m) { return m.kind === 'exact' || m.kind === 'prefix'; });
    if (!direct) {
      nm.concat(dm).forEach(function (m) {
        if (m.kind !== 'fuzzy') return;
        var v = (nm.indexOf(m) >= 0 ? idx.nv : idx.dv)[m.i], df = (nm.indexOf(m) >= 0 ? idx.np : idx.dp)[m.i].length;
        var rank = m.s + Math.min(10, Math.log(1 + df) * 2);
        if (!top || rank > top.rank) top = { v: v, rank: rank };
      });
      if (top) best[t] = top.v;
    }
    return (tokCache[t] = sc);
  }

  var total = new Float32Array(N), cover = new Uint8Array(N), nameCover = new Uint8Array(N), strictCover = new Uint8Array(N);
  terms.forEach(function (term) {
    var termBest = new Float32Array(N), termDir = new Uint8Array(N);
    if (term.cjk) { var hay = cjkHay_(bundle); for (var h = 0; h < N; h++) if (hay[h] && hay[h].indexOf(term.cjk) >= 0) { termBest[h] = 55; termDir[h] = 1; } }
    if (term.wild) {                                     // 20261017o: wildcard code = an exact match inside the code
      var wre = wildRe_(term.wild, '');
      for (var h2 = 0; h2 < N; h2++) { var wn = idx.nn[h2], wm = wre.exec(wn); if (wm) { termBest[h2] = wm.index === 0 ? (wm[0].length === wn.length ? 100 : 88) : 72; termDir[h2] = 1; } }
    }
    term.alts.forEach(function (alt, ai) {
      var arrs = alt.map(tokenScores), dirs = alt.map(function (t) { return dirCache[t]; });
      for (var i = 0; i < N; i++) {
        var mn = 1e9; for (var a = 0; a < arrs.length; a++) { var v = arrs[a][i]; if (v < mn) mn = v; if (!v) break; }
        if (mn > 0 && mn < 1e9) { var s = ai === 0 ? mn : mn * 0.93; if (s > termBest[i]) termBest[i] = s; }
        if (!termDir[i]) { var all = true; for (a = 0; a < dirs.length && all; a++) all = !!dirs[a][i]; if (all) termDir[i] = 1; }
      }
    });
    for (var i = 0; i < N; i++) { if (termBest[i] > 0) { total[i] += termBest[i]; cover[i]++; if (termBest[i] >= 60) nameCover[i]++; } if (termDir[i]) strictCover[i]++; }
  });
  // Exact first: an item is an EXACT match when every typed word (or its synonym) appears in its code, name or description
  // as typed (whole word, start of a word, or inside the code). If there is at least one, ONLY exact matches are listed;
  // typo / close matches are the fallback when nothing is exact (strict: 0, fallback: true).
  var strictN = 0; for (var si = 0; si < N; si++) if (strictCover[si] === T) strictN++;

  var catWant = {}, sizeNums = [], qw = tokenize_(hasWild ? q.replace(/\S+/g, function (w) { return wildPattern_(w) ? ' ' : w; }) : q), nType = 0;
  qw.forEach(function (w) { var c = CATEGORY_WORDS_[w]; if (c) { catWant[c] = 1; nType++; } if (/^\d{2}$/.test(w)) sizeNums.push(w); });
  // TYPE search ("hood", "range hood", "sinks"): every word is a type word or a filler -> items OF that type come first
  // (matched by their category tag even when code/description lack the word), then other items that merely mention it.
  var typeOnly = nType > 0 && qw.every(function (w) { return CATEGORY_WORDS_[w] || TYPE_FILLER_[w]; });
  var cands = [], maxCover = 0;
  for (var i = 0; i < N; i++) if (cover[i] > maxCover) maxCover = cover[i];
  var minCover = Math.max(1, T >= 3 ? maxCover - 1 : maxCover);
  for (i = 0; i < N; i++) {
    if (strictN ? strictCover[i] !== T : (!cover[i] || cover[i] < minCover)) continue;
    var nn = idx.nn[i], s = total[i] / T;
    if (wq) {                                            // 20261017o: whole code / start / inside, like the typed-code boosts below
      var wm3 = wildRe_(wq, '').exec(nn);
      if (wm3 && wm3.index === 0) s += wm3[0].length === nn.length ? 200 : 60; else if (wm3 && wq.length >= 4) s += 40;
      if (/~/.test(wq) && nn.indexOf(qNorm) >= 0) s += 5;   // the X really is in the code (ES-KLD-4822X for 4822x)
    }
    else if (nn === qNorm) s += 200;
    else if (qNorm.length >= 3 && nn.lastIndexOf(qNorm, 0) === 0) s += 60;
    else if (qNorm.length >= 4 && nn.indexOf(qNorm) >= 0) s += 40;
    if (nameCover[i] === T) s += 15;
    var oh = Number(items[i][3]); if (oh > 0) s += 12;
    if (catWant[items[i][7]]) {
      s += typeOnly ? 400 : 30;
      if (!ACCESSORY_RE_.test(items[i][1])) s += 10;                 // the main product, not its seat / grid / kit
      var pr = Number(items[i][2]); if (pr > 0) s += Math.min(8, Math.log(pr) / Math.LN10 * 3);
    }
    if (sizeNums.length && items[i][10] && sizeNums.indexOf(String(items[i][10]).replace(/"/g, '')) >= 0) s += 12;
    cands.push([cover[i], s, nn.length, i]);
  }
  cands.sort(function (a, b) {
    var ra = items[a[3]], rb = items[b[3]];
    if (ra[7] === 'Flooring' && rb[7] === 'Flooring') {
      var ma = isFloorMolding_(ra[0]) ? 1 : 0, mb = isFloorMolding_(rb[0]) ? 1 : 0;
      if (ma !== mb) return ma - mb;   // plank/tile before trim/molding
    }
    return b[0] - a[0] || b[1] - a[1] || a[2] - b[2];
  });
  var exactCount = cands.filter(function (c) { return c[0] === T; }).length;
  // ---- filters + facets (over the whole match set, not just the first page)
  var set = cands;                                     // exact set, or (fallback) every close match that is listed
  var store = f.store === 'SF' ? 5 : f.store === 'FRE' ? 6 : 0, sizeOn = f.cat === 'Tile' || f.cat === 'Flooring';
  var vix = variantIndex_(bundle);
  var endsQ = f.ends ? (wq || qNorm) : '', endsOn = !!endsQ;   // 20261017o: or the wildcard pattern (2?30, 67x)   // 20261017n: Ends with (the typed code, normalized)
  var pass = function (r, skip) {
    var ve = vix.byName[r[0]];
    return (skip === 'cat' || !f.cat || r[7] === f.cat) && (skip === 'stock' || !f.inStock || Number(r[3]) > 0) &&
           (skip === 'store' || !store || !!r[store]) && (skip === 'size' || !f.size || !sizeOn || r[10] === f.size) &&
           (skip === 'finish' || !f.finish || (ve && ve.label === f.finish)) &&
           (skip === 'flooring' || !f.flooring || isFloorProduct_(r)) &&
           (skip === 'ends' || !endsOn || codeEndsWith_(r[0], endsQ)) &&
           (skip === 'brand' || !f.brand || brandOf_(r) === String(f.brand));
  };
  var fc = {}, sz = {}, fin = {}, br = {}, facets = { brands: [], ends: 0, stock: 0, sf: 0, fre: 0, flooring: 0, cats: [], sizes: [], finishes: [] };
  for (var fi = 0; fi < set.length; fi++) {
    var fr = items[set[fi][3]];
    if (pass(fr, 'cat')) fc[fr[7]] = (fc[fr[7]] || 0) + 1;
    if (qNorm && pass(fr, 'ends') && codeEndsWith_(fr[0], wq || qNorm)) facets.ends++;
    if (pass(fr, 'brand')) { var bk = brandOf_(fr); if (bk) br[bk] = (br[bk] || 0) + 1; }
    if (pass(fr, 'stock') && Number(fr[3]) > 0) facets.stock++;
    if (pass(fr, 'store')) { if (fr[5]) facets.sf++; if (fr[6]) facets.fre++; }
    if (pass(fr, 'flooring') && isFloorProduct_(fr)) facets.flooring++;
    if (sizeOn && fr[10] && pass(fr, 'size')) sz[fr[10]] = (sz[fr[10]] || 0) + 1;
    if (pass(fr, 'finish')) { var ve = vix.byName[fr[0]]; if (ve && ve.label) { var slot = fin[ve.label] = fin[ve.label] || { n: 0, named: 0 }; slot.n++; if (ve.named) slot.named = 1; } }
  }
  facets.cats = (bundle.categories || []).concat(Object.keys(fc).filter(function (k) { return (bundle.categories || []).indexOf(k) < 0; }))
    .filter(function (k) { return fc[k]; }).map(function (k) { return [k, fc[k]]; }).sort(function (a, b) { return b[1] - a[1]; });   // biggest first (stable: Browse order on ties)
  facets.brands = Object.keys(br).map(function (k) { return [k, br[k]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });   // biggest first
  facets.sizes = Object.keys(sz).map(function (k) { return [k, sz[k]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, 12);
  facets.finishes = Object.keys(fin).map(function (k) { return [k, fin[k].n, fin[k].named]; }).sort(function (a, b) { return b[2] - a[2] || b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, 24);
  var filtered = f.cat || f.inStock || store || (sizeOn && f.size) || f.finish || f.flooring || endsOn || !!f.brand;
  var list = filtered ? cands.filter(function (c) { return pass(items[c[3]]); }) : cands;
  var offset = Math.max(0, Math.floor(Number(f.offset) || 0));
  var out = list.slice(offset, offset + limit).map(function (c) { return itemOut_(items[c[3]], inc, c[0] === T ? 'all' : 'partial'); });

  // Did you mean: replace each fuzzy-only token with its best correction.
  var suggestions = [], words = tokenize_(q);
  var fixed = words.map(function (w) { return best[w] || w; });
  if (!strictN && fixed.join(' ') !== words.join(' ')) suggestions.push(fixed.join(' ').toLowerCase());
  if (!strictN && !exactCount && T > 1) {                          // also offer dropping the weakest word
    terms.forEach(function (t, j) { var rest = terms.filter(function (x, k) { return k !== j; }).map(function (x) { return x.label; }).join(' ').toLowerCase(); if (suggestions.indexOf(rest) < 0 && suggestions.length < 3) suggestions.push(rest); });
  }

  // Incoming-only codes (on a container but not in the item list yet).
  var known = {}; idx.nn.forEach(function (n) { known[n] = 1; });
  var extra = [];
  Object.keys(inc).forEach(function (k) {
    if (known[k] || qNorm.length < 3 || filtered || offset) return;
    if (wq ? wildRe_(wq, '').test(k) : k.indexOf(qNorm) >= 0) extra.push(itemOut_([inc[k][0].code, '(not in the item list yet - incoming only)', null, null, null, '', ''], inc, 'incoming'));
  });
  var listExact = filtered ? list.filter(function (c) { return c[0] === T; }).length : exactCount;
  return { q: q, total: cands.length, exact: exactCount, shown: out.length, items: out.concat(extra.slice(0, 5)),
           facets: facets, filtered: !!filtered, listTotal: list.length, listExact: listExact, offset: offset, more: offset + out.length < list.length,
           closest: exactCount === 0 && out.length > 0, strict: strictN, fallback: !strictN && cands.length > 0, suggestions: suggestions.slice(0, 3),
           terms: terms.map(function (t) { return t.label; }), dataVersion: bundle.version, dataBuilt: bundle.built };
}

/** Pending containers with line counts and pieces (for the Incoming tab). */
function containersSummary_(bundle) {
  var by = {};
  (bundle.incoming || []).forEach(function (r) {
    var c = by[r[3]] = by[r[3]] || { container: r[3], shipment: r[2], date: r[4], lines: 0, pieces: 0, partly: false };
    c.lines++; c.pieces += Number(r[1]) || 0; if (/partly/i.test(r[5])) c.partly = true;
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

// ------------------------------------------------------------------ browse (category screen)
/** [{cat, count}] in the order from categories.json. */
function categories_(bundle) {
  var c = {}; (bundle.items || []).forEach(function (r) { c[r[7]] = (c[r[7]] || 0) + 1; });
  return (bundle.categories || Object.keys(c)).filter(function (k) { return c[k]; }).map(function (k) { return { cat: k, count: c[k] }; });
}

/**
 * f = {cat, brand, finish, size, q, inStock, page}. Facet counts for brand / finish / size are computed with every
 * other filter applied (so they always add up to what a tap would show). 30 items per page, in-stock first.
 */
function browse_(bundle, f) {
  f = f || {};
  var items = bundle.items || [], inc = incomingIndex_(bundle), page = Math.max(0, Number(f.page) || 0);
  var words = f.q ? tokenize_(f.q) : [];
  var base = [];
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    if (r[7] !== f.cat) continue;
    if (f.inStock && !(Number(r[3]) > 0)) continue;
    if (words.length) {
      var hay = normCode_(r[0]) + ' ' + (r[1] + ' ' + (r[12] || '')).toUpperCase();
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) continue;
    }
    base.push(i);
  }
  var pass = function (r, skip) {
    return (skip === 'brand' || !f.brand || r[8] === f.brand) &&
           (skip === 'finish' || !f.finish || (r[9] || []).indexOf(f.finish) >= 0) &&
           (skip === 'size' || !f.size || r[10] === f.size);
  };
  var facet = function (key, getter) {
    var c = {};
    base.forEach(function (i) { var r = items[i]; if (!pass(r, key)) return; [].concat(getter(r)).forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; }); });
    return Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 40);
  };
  var hits = base.filter(function (i) { return pass(items[i]); });
  hits.sort(function (a, b) {
    var sa = Number(items[a][3]) > 0 ? 0 : 1, sb = Number(items[b][3]) > 0 ? 0 : 1;
    return sa - sb || (items[a][13] ? 0 : 1) - (items[b][13] ? 0 : 1) || String(items[a][0]).localeCompare(String(items[b][0]));
  });
  return { cat: f.cat, total: hits.length, page: page, pageSize: SEARCH_LIMIT,
           facets: { brand: facet('brand', function (r) { return r[8]; }), finish: facet('finish', function (r) { return r[9] || []; }),
                     size: facet('size', function (r) { return r[10]; }) },
           items: hits.slice(page * SEARCH_LIMIT, (page + 1) * SEARCH_LIMIT).map(function (i) { return itemOut_(items[i], inc); }),
           dataBuilt: bundle.built };
}

// ------------------------------------------------------------------ cabinet shelves (Wall / Base / Tall)
function cabinetStyles_(bundle) {
  return (bundle.cabinets || []).map(function (s) {
    var n = { wall: 0, base: 0, tall: 0, trim: 0 }; s.rows.forEach(function (r) { n[r[1]]++; });
    return { key: s.key, name: s.name, photo: s.photo, note: s.note || '', counts: n };
  });
}

var NAME_INDEX_ = null, NAME_VER_ = null;
function nameIndex_(bundle) {
  if (NAME_INDEX_ && NAME_VER_ === bundle.version) return NAME_INDEX_;
  var m = {}; (bundle.items || []).forEach(function (r, i) { m[r[0]] = i; });
  NAME_INDEX_ = m; NAME_VER_ = bundle.version; return m;
}

// ------------------------------------------------------------------ finish / variant families
// Sibling items share a code prefix and differ only in the last 3 characters, or the last 4 when the last 3
// has no sibling. Prefix must be at least 5 characters so short size codes (WDC2440 / W3030) are not finishes.
// Cabinet codes (prefix + size digits) are never finishes. Labels: Hansgrohe/Axor finish digits when the family
// uses more than one of those codes, else a finish word in the description (or the bundle finish tags), else the suffix.
var HG_FINISH_ = { '00': 'Chrome', '82': 'Brushed Nickel', '14': 'Brushed Bronze', '67': 'Matte Black', '25': 'Brushed Gold Optic', '34': 'Brushed Black Chrome', '83': 'Polished Nickel' };
var FINISH_PHRASES_ = [
  ['BRUSHED BLACK CHROME', 'Brushed Black Chrome'], ['BRUSHED GOLD OPTIC', 'Brushed Gold Optic'],
  ['OIL-RUBBED BRONZE', 'Oil Rubbed Bronze'], ['OIL RUBBED BRONZE', 'Oil Rubbed Bronze'],
  ['VENETIAN BRONZE', 'Venetian Bronze'], ['CHAMPAGNE BRONZE', 'Champagne Bronze'], ['UNLACQUERED BRASS', 'Unlacquered Brass'],
  ['POLISHED NICKEL', 'Polished Nickel'], ['POLISHED CHROME', 'Polished Chrome'], ['POLISHED BRASS', 'Polished Brass'],
  ['BRUSHED NICKEL', 'Brushed Nickel'], ['BRUSHED BRONZE', 'Brushed Bronze'], ['BRUSHED BRASS', 'Brushed Brass'],
  ['BRUSHED GOLD', 'Brushed Gold'], ['BRUSHED BLACK', 'Brushed Black'], ['BRUSHED GRAPHITE', 'Brushed Graphite'],
  ['SATIN NICKEL', 'Satin Nickel'], ['SATIN BRONZE', 'Satin Bronze'], ['SATIN BRASS', 'Satin Brass'],
  ['STAINLESS STEEL', 'Stainless Steel'], ['SUPER STEEL', 'SuperSteel'], ['SUPERSTEEL', 'SuperSteel'],
  ['HARD GRAPHITE', 'Hard Graphite'], ['WARM SUNSET', 'Warm Sunset'], ['COOL SUNRISE', 'Cool Sunrise'],
  ['MATTE BLACK', 'Matte Black'], ['MATTE WHITE', 'Matte White'], ['GUN METAL', 'Gunmetal'], ['GUNMETAL', 'Gunmetal'],
  ['STAINLESS', 'Stainless Steel'], ['CHROME', 'Chrome'],
  ['拉丝黑铬', 'Brushed Black Chrome'], ['拉丝金', 'Brushed Gold Optic'], ['拉丝镍', 'Brushed Nickel'], ['拉丝青铜', 'Brushed Bronze'],
  ['拉丝黄铜', 'Brushed Brass'], ['哑光黑', 'Matte Black'], ['磨砂黑', 'Matte Black'], ['哑光白', 'Matte White'],
  ['抛光镍', 'Polished Nickel'], ['抛光铬', 'Polished Chrome'], ['油擦青铜', 'Oil Rubbed Bronze'], ['不锈钢', 'Stainless Steel'],
  ['铬色', 'Chrome'], ['镀铬', 'Chrome']];
var CABINET_CODE_ = /^(PANTRY|GDWDC|BBFD|BEFE|WDC|WBC|BBC|VDB|VSB|LSB|MWC|OVD|OMD|ROT|GDW|BMC|BSR|BOE|WEQ|WEA|BEA|WSP|WF|BF|TF|WB|WD|WR|DB|SB|LS|PC|TK|SM|OV|UT|W|B|T|V|F)\d{2,6}[LR]?$/;
function phraseAt_(hay, phrase, ascii) {
  var from = 0, i;
  while ((i = hay.indexOf(phrase, from)) >= 0) {
    if (!ascii) return true;
    var before = i === 0 || !/[A-Z0-9]/.test(hay.charAt(i - 1));
    var after = i + phrase.length >= hay.length || !/[A-Z0-9]/.test(hay.charAt(i + phrase.length));
    if (before && after) return true;
    from = i + 1;
  }
  return false;
}
function finishFromDesc_(text) {
  var raw = String(text || ''), up = raw.toUpperCase(), i;
  for (i = 0; i < FINISH_PHRASES_.length; i++) {
    var p = FINISH_PHRASES_[i][0], ascii = p.charCodeAt(0) < 128;
    if (phraseAt_(ascii ? up : raw, p, ascii)) return FINISH_PHRASES_[i][1];
  }
  return '';
}
function hgLabel_(tail) { return tail.length === 3 && /^\d{2}[0-9A-Z]$/.test(tail) ? (HG_FINISH_[tail.slice(0, 2)] || '') : ''; }
function variantBuckets_(codes, tail) {
  var m = {}, min = tail + 5, i;
  for (i = 0; i < codes.length; i++) {
    var c = codes[i];
    if (!c || c.length < min || CABINET_CODE_.test(c)) continue;
    var p = c.slice(0, c.length - tail);
    (m[p] = m[p] || []).push(i);
  }
  return m;
}
function variantLabelFamily_(items, codes, idxs, tail) {
  var distinct = {}, i, t, h;
  for (i = 0; i < idxs.length; i++) { h = hgLabel_(codes[idxs[i]].slice(-tail)); if (h) distinct[h] = 1; }
  // Known digits only when the family uses more than one of them (Chrome and Brushed Nickel, …).
  // A run of 003/004/005 is not a finish family just because each tail starts with 00.
  var useHg = Object.keys(distinct).length >= 2;
  return idxs.map(function (ix) {
    t = codes[ix].slice(-tail);
    var tags = [].concat(items[ix][9] || []).join(' ');
    var fromCode = useHg ? hgLabel_(t) : '';
    var fromDesc = finishFromDesc_(String(items[ix][1] || '') + ' ' + tags);
    var label = fromCode || fromDesc || t;
    return { i: ix, name: items[ix][0], label: label, tail: t, named: label !== t };
  });
}
var VARIANT_CACHE_ = { ver: null, idx: null };
/** { byName: {item name: {name, label, tail, key, named}}, groups: {key: [entries]} }. Cached per bundle version. */
function variantIndex_(bundle) {
  var items = (bundle && bundle.items) || [];
  var ver = (bundle && (bundle.version || bundle.built) || '') + '#' + items.length;
  if (VARIANT_CACHE_.ver === ver && VARIANT_CACHE_.idx) return VARIANT_CACHE_.idx;
  var codes = new Array(items.length), i;
  for (i = 0; i < items.length; i++) codes[i] = normCode_(items[i][0]);
  var assigned = {}, byName = {}, groups = {};
  function consider(buckets, tail) {
    for (var p in buckets) {
      var mem = buckets[p], uniq = [], seen = {}, k;
      for (k = 0; k < mem.length; k++) {
        var ix = mem[k];
        if (assigned[ix] || seen[codes[ix]]) continue;
        seen[codes[ix]] = 1; uniq.push(ix);
      }
      if (uniq.length < 2) continue;
      var key = tail + ':' + p, entries = variantLabelFamily_(items, codes, uniq, tail);
      entries.forEach(function (e) { e.key = key; assigned[e.i] = 1; byName[e.name] = e; });
      groups[key] = entries;
    }
  }
  consider(variantBuckets_(codes, 3), 3);
  consider(variantBuckets_(codes, 4), 4);
  VARIANT_CACHE_ = { ver: ver, idx: { byName: byName, groups: groups } };
  return VARIANT_CACHE_.idx;
}
function variantSiblings_(bundle, name) {
  if (!bundle) return [];
  var e = variantIndex_(bundle).byName[name];
  return e ? variantIndex_(bundle).groups[e.key] : [];
}
/** Sibling with this finish. null = this item is already that finish. undefined = no such sibling in the item list. */
function variantPick_(siblings, currentName, label) {
  var cur = null, hits = [], i;
  for (i = 0; i < siblings.length; i++) {
    if (siblings[i].name === currentName) cur = siblings[i];
    if (siblings[i].label === label) hits.push(siblings[i]);
  }
  if (cur && cur.label === label) return null;
  if (!hits.length) return undefined;
  if (hits.length === 1) return hits[0];
  var last = cur && cur.tail ? cur.tail.slice(-1) : '';
  for (i = 0; i < hits.length; i++) if (last && hits[i].tail.slice(-1) === last) return hits[i];
  return hits[0];
}

/** One shelf of one style: every size with combined price and per-part stock + incoming. */
function cabinetShelf_(bundle, key, shelf) {
  var s = (bundle.cabinets || []).filter(function (x) { return x.key === key; })[0];
  if (!s) throw new Error('Unknown cabinet style.');
  var idx = nameIndex_(bundle), inc = incomingIndex_(bundle), items = bundle.items;
  var rows = s.rows.filter(function (r) { return r[1] === shelf; }).map(function (r) {
    var parts = r[3].map(function (p) {
      var it = items[idx[p[0]]] || null, lines = inc[normCode_(p[0])] || [];
      return { item: p[0], price: p[1], onHand: it ? it[3] : null, onOrder: it ? it[4] : null,
               incoming: lines, incomingTotal: lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0),
               role: /^BOX-/.test(p[0]) ? 'box' : /-G(WDC)?\d/.test(p[0]) ? 'glass' : 'door' };
    });
    // a cabinet is "ready" when every part has stock (now, or after the pending containers)
    var now = parts.every(function (p) { return Number(p.onHand) > 0; });
    var later = parts.every(function (p) { return Number(p.onHand) + p.incomingTotal > 0; });
    return { code: r[0], price: r[2], parts: parts, note: r[4], status: now ? 'in' : later ? 'coming' : 'short' };
  });
  return { key: s.key, name: s.name, photo: s.photo, note: s.note || '', shelf: shelf, rows: rows };
}

/** Cart lines from a logged request -> today's price/desc (cabinets from the style table, else item, else sum of parts). */
function priceLines_(bundle, lines) {
  var idx = nameIndex_(bundle), items = bundle.items;
  return (lines || []).map(function (l) {
    var o = { name: l.name, qty: l.qty, price: null, desc: '' };
    if (l.parts) o.parts = l.parts; if (l.special) o.special = l.special; if (l.cab) o.cab = l.cab;
    if (l.cab) {
      var s = (bundle.cabinets || []).filter(function (x) { return x.key === l.cab.key; })[0];
      var r = s && s.rows.filter(function (x) { return x[0] === l.cab.code; })[0];
      if (r) { o.price = r[2]; o.desc = 'Cabinet ' + r[0] + ' (' + r[3].map(function (p) { return p[0]; }).join(' + ') + ')'; }
    }
    if (o.price == null && idx[l.name] !== undefined) { var it = items[idx[l.name]]; o.price = it[2]; o.desc = String(it[1] || '').slice(0, 90); }
    if (o.price == null && l.parts) {
      var ps = l.parts.map(function (p) { return idx[p] !== undefined ? items[idx[p]][2] : null; });
      if (ps.every(function (x) { return x != null; })) o.price = ps.reduce(function (a, b) { return a + Number(b); }, 0);
    }
    o.missing = o.price == null;
    if (o.missing) o.price = 0;
    return o;
  });
}

/** Grout / thinset items for the tile calculator, with price + stock. */
function settingItems_(bundle) {
  var idx = nameIndex_(bundle), inc = incomingIndex_(bundle);
  return (bundle.setting || []).map(function (n) { return bundle.items[idx[n]]; }).filter(Boolean).map(function (r) { return itemOut_(r, inc); });
}

// ---------------------------------------------------------------- plan code reader (OCR text -> cabinet list)
/** Every cabinet / panel code in the style tables (upper case, no hinge letter), e.g. W3040, WDC2440, BBC36, 25.5X96X6. */
var CAB_CODES_ = null, CAB_VER_ = null;
function cabinetCodeSet_(bundle) {
  if (CAB_CODES_ && CAB_VER_ === bundle.version) return CAB_CODES_;
  var s = {};
  (bundle.cabinets || []).forEach(function (st) { st.rows.forEach(function (r) { s[String(r[0]).toUpperCase().replace(/\s+/g, '')] = 1; }); });
  CAB_CODES_ = s; CAB_VER_ = bundle.version; return s;
}
function cabinetCodes_(bundle) { return Object.keys(cabinetCodeSet_(bundle)).filter(function (c) { return /^[A-Z0-9.\/X-]+$/.test(c) && /\d/.test(c); }).sort(); }

// Cabinet code prefixes East Star / Cyncly plans use (longest first so WDC wins over W). Extra Cyncly names (WD, BBFD, T,
// PANTRY, VDB, LS, F/BF) are read too and flagged 'check' when East Star has no such code.
var PLAN_PREFIXES_ = ['PANTRY', 'GDWDC', 'BBFD', 'BEFE', 'WDC', 'WBC', 'BBC', 'VDB', 'VSB', 'LSB', 'MWC', 'OVD', 'OMD', 'ROT', 'GDW', 'BMC', 'BSR', 'BOE',
  'WEQ', 'WEA', 'BEA', 'WSP', 'WF', 'BF', 'TF', 'WB', 'WD', 'WR', 'DB', 'SB', 'LS', 'PC', 'TK', 'SM', 'OV', 'UT', 'W', 'B', 'T', 'V', 'F'];
var PLAN_PREFIX_RE_ = new RegExp('^(' + PLAN_PREFIXES_.join('|') + ')$');
var PLAN_ALIASES_ = { WD: 'WDC', BBFD: 'BBC' };   // Cyncly name -> closest East Star code family (shown as a hint)

/** Is this code (with optional L/R hinge letter) in the item list? Returns the matching list code or ''. */
function planKnown_(set, code) {
  var c = String(code || '').toUpperCase().replace(/\s+/g, '');
  if (set[c]) return c;
  var m = c.match(/^(.*\d)(L|R)$/); if (m && set[m[1]]) return m[1];
  if (/^\d+(\.\d)?X\d+$/.test(c) && set[c + 'X6']) return c + 'X6';          // 25.5X96 -> 25.5X96X6, 4X8 -> 4X8X6
  return '';
}

/**
 * OCR text of a kitchen plan -> [{code, qty, flag, note}] (flag '' = in the item list, 'check' = not in the list,
 * 'odd' = OCR had to guess or the label looks cut off). Appliance model numbers, dimensions and title-block text are skipped.
 */
function planCodes_(bundle, text) {
  var set = cabinetCodeSet_(bundle);
  var s = ' ' + String(text || '').toUpperCase().replace(/[“”"'’‘—–_~|\[\]{}()]/g, ' ') + ' ';
  // re-join codes split by OCR spaces: "W 3030" -> "W3030", "FW 1540L" -> "FW1540L" (letters must be a known prefix, maybe with one stray letter)
  s = s.replace(/(^|[^A-Z0-9])([A-Z]{1,6})\s+(\d{2,6}(?:[LR1I]|FD)?)(?=$|[^A-Z0-9.])/g, function (all, pre, letters, digits) {
    var ok = PLAN_PREFIX_RE_.test(letters) || PLAN_PREFIX_RE_.test(letters.slice(1));
    return ok ? pre + letters + digits : all;
  });
  s = s.replace(/([A-Z]+\d{2,6})\s+([LR])(?=[^A-Z0-9]|$)/g, '$1$2');      // "WDC2440 L" -> "WDC2440L"
  var found = {}, order = [];
  var re = /[A-Z]{1,6}[0-9OIL][0-9A-Z.\/-]*[:…]?|\d{1,2}(?:\.\d)?X\d{2,3}(?:X\d)?/g, m;
  while ((m = re.exec(s))) {
    var raw = m[0], tok = raw, notes = [], odd = false;
    if (/[:…]$/.test(tok)) { odd = true; notes.push('label looks cut off'); tok = tok.replace(/[:…]$/, ''); }
    tok = tok.replace(/[.\/-]+$/, '');
    var r = planToken_(tok, set);
    if (!r) continue;
    if (r.fixed) { odd = true; notes.push('OCR read “' + raw.replace(/[:…]$/, '') + '”'); }
    var known = planKnown_(set, r.code), flag = '';
    if (!known) {
      flag = 'check';
      var al = r.code.match(/^([A-Z]+)(\d.*)$/), fam = al && PLAN_ALIASES_[al[1]];
      if (fam === 'WDC') notes.push('not in list; East Star code is probably WDC' + al[2].replace(/[LR]$/, ''));
      else if (fam === 'BBC') notes.push('Cyncly blind corner; East Star uses BBC27/36/39/42/45');
      else if (fam) notes.push('not in list; East Star family is ' + fam);
      else if (/^[A-Z]+\d+$/.test(r.code) && /[:…]$/.test(raw)) notes.push('size cut off');
      else notes.push('not in the item list');
    }
    if (odd && !flag) flag = 'odd';
    if (odd && flag === 'check' && /cut off/.test(notes.join())) flag = 'odd';
    var key = r.code;
    if (!found[key]) { found[key] = { code: key, qty: 0, flag: flag, note: notes.join('; ') }; order.push(key); }
    found[key].qty++;
  }
  return order.map(function (k) { return found[k]; });
}

/** One OCR token -> {code, fixed} or null when it is not a cabinet code (appliance model, address, etc.). */
function planToken_(tok, set) {
  if (/^\d/.test(tok)) {                                              // panels like 25.5X96 / 4X8
    var p = tok.match(/^(\d{1,2}(?:\.\d)?)X(\d{2,3})(X\d)?$/);
    return p ? { code: p[1] + 'X' + p[2], fixed: false } : null;
  }
  var fixed = false;
  // filler / panels with X sizes: WF3X40, BF3X34.5
  var fx = tok.match(/^(WF|BF|TF|F)(\d(?:\.\d+)?)X(\d{2,3}(?:\.\d)?)$/);
  if (fx) return { code: fx[1] + fx[2] + 'X' + fx[3], fixed: false };
  var m = tok.match(/^([A-Z]+)([0-9OIL][0-9OIL]*)([A-Z]*)$/);
  if (!m) return null;
  var pre = m[1], dig = m[2], suf = m[3];
  // OCR letter/digit mix-ups inside the size (O->0, I->1). A trailing L after digits is the hinge letter, so keep it.
  if (/L$/.test(dig) && !suf) { suf = 'L'; dig = dig.slice(0, -1); }
  if (/[OIL]/.test(dig)) {
    var a1 = dig.replace(/O/g, '0').replace(/[IL]/g, '1'), a2 = dig.replace(/O/g, '0').replace(/[IL]/g, '');   // "B1I2R": I = 1, or a stray mark
    dig = !planKnown_(set, pre + a1 + suf) && a2.length >= 2 && planKnown_(set, pre + a2 + suf) ? a2 : a1; fixed = true;
  }
  if (!/^\d{2,6}$/.test(dig)) return null;
  if (suf && !/^(L|R|FD|FDL|FDR)$/.test(suf)) return null;           // PGS930YPFS, DT665SSNSS = appliances
  if (pre === 'V' && !/^(VDB|VSB)/.test(pre + dig)) { pre = 'W'; fixed = true; }   // V1240R -> W1240R
  if (!PLAN_PREFIX_RE_.test(pre)) {                                   // one stray letter in front: FW1540L -> W1540L
    if (pre.length > 1 && PLAN_PREFIX_RE_.test(pre.slice(1))) { pre = pre.slice(1); fixed = true; }
    else return null;
  }
  // W-family sizes are 4 or 6 digits (WWHH / WWHHDD); a 5th digit "1" is usually a misread hinge L: W15401 -> W1540L
  if (/^(W|WDC|WBC|WB|WD|GDW)$/.test(pre) && dig.length === 5 && !suf && /1$/.test(dig)) { dig = dig.slice(0, 4); suf = 'L'; fixed = true; }
  if (/^(B|DB|SB|BBC|LSB)$/.test(pre) && dig.length > 2 && dig.length !== 4) {
    // base codes are 2 digits (B27, SB30); "B1I2R" style misreads were fixed above, anything longer is odd
    fixed = true;
  }
  // size sanity: wall codes are 4/6 digits, tall/pantry 4-6, base codes 2 (anything else is kept but marked odd)
  var W4 = /^(W|WDC|WBC|WB|WD|GDW|GDWDC|WR|MWC|WEQ|WEA)$/.test(pre), TALL = /^(T|PANTRY|PC|OVD|OMD|UT|OV)$/.test(pre);
  if ((W4 || TALL) && dig.length < 4) return null;                    // "T 525" (address), "W 30" (dimension)
  if (W4 && dig.length !== 4 && dig.length !== 6) fixed = true;
  var code = pre + dig + suf;
  if (code.length < 3) return null;
  return { code: code, fixed: fixed };
}
