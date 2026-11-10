/**
 * Pecan Pie pilot: log receiver and summary.
 *
 * Paste this into Extensions > Apps Script of a new Google Sheet, run setup() once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * See apps-script/README.md for the full steps.
 */

const EVENT_COLS = ['received_at', 'at', 'day', 'tester', 'session', 'type', 'id', 'app', 'platform', 'standalone', 'data'];
const SCRATCH_COLS = ['received_at', 'at', 'day', 'tester', 'session', 'source', 'place_src', 'place_kind', 'card', 'rank', 'grade',
  'computed_grade', 'sigma_w', 'holo', 'print', 'low_print', 'broke', 'token', 'duration_ms', 'strokes', 'speed_px_s', 'coverage', 'new_slot', 'fx'];
const META_KEYS = ['at', 'day', 'tester', 'session', 'type', 'id', 'app', 'platform', 'standalone'];
const MAX_BODY = 300000, MAX_EVENTS = 200;
const SUMMARY_EVERY_SEC = 300;   // refresh the Summary as events arrive, at most once every five minutes
const RANKS = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythic'];
const GRADES = ['Pristine', 'Good', 'Fair', 'Poor'];

/* ---------------- Receiving ---------------- */

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) || '';
    if (!body || body.length > MAX_BODY) return out_('rejected');
    const payload = JSON.parse(body);
    let evs = Array.isArray(payload.events) ? payload.events : [payload];
    evs = evs.filter(function (x) { return x && typeof x.type === 'string'; }).slice(0, MAX_EVENTS);

    // Drop events already received in the last six hours (a retry after a lost response, or a beacon racing a fetch).
    const cache = CacheService.getScriptCache();
    const ids = evs.map(function (x) { return String(x.id || ''); }).filter(String);
    const seen = ids.length ? cache.getAll(ids.map(function (k) { return 'e:' + k; })) : {};
    evs = evs.filter(function (x) { return !x.id || !seen['e:' + x.id]; });
    if (!evs.length) return out_('ok');

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const ss = SpreadsheetApp.getActive(), now = new Date();
      const evRows = [], scRows = [];
      evs.forEach(function (x) {
        const data = {};
        Object.keys(x).forEach(function (k) { if (META_KEYS.indexOf(k) < 0) data[k] = x[k]; });
        evRows.push([now, date_(x.at), day_(x.day), str_(x.tester), str_(x.session), str_(x.type), str_(x.id), str_(x.app),
          str_(x.platform), x.standalone === true, str_(JSON.stringify(data), 5000)]);
        if (x.type === 'scratch_reveal') {
          scRows.push([now, date_(x.at), day_(x.day), str_(x.tester), str_(x.session), str_(x.source), str_(x.placeSrc), str_(x.placeKind),
            str_(x.card), num_(x.rank), str_(x.grade), str_(x.computedGrade), num_(x.sigmaW), x.holo === true, num_(x.print), x.lowPrint === true,
            str_(x.broke), str_(x.token), num_(x.durationMs), num_(x.strokes), num_(x.speedPxS), num_(x.coverage), x.newSlot === true, str_(x.fx)]);
        }
      });
      append_(sheet_(ss, 'Events', EVENT_COLS), evRows);
      append_(sheet_(ss, 'Scratches', SCRATCH_COLS), scRows);
    } finally {
      lock.releaseLock();
    }
    const put = {};
    evs.forEach(function (x) { if (x.id) put['e:' + x.id] = '1'; });
    if (Object.keys(put).length) cache.putAll(put, 21600);
    maybeRefreshSummary_(cache);
    return out_('ok');
  } catch (err) {
    return out_('error');
  }
}

function doGet() { return out_('Pecan Pie log receiver is running.'); }

// Keep the Summary current without slowing every delivery: refresh only if five minutes have passed.
// A failure here never affects logging; the hourly trigger and the menu still work.
function maybeRefreshSummary_(cache) {
  try {
    if (cache.get('summary:recent')) return;
    cache.put('summary:recent', '1', SUMMARY_EVERY_SEC);
    refreshSummary();
  } catch (err) {}
}

/* ---------------- Setup ---------------- */

function setup() {
  const ss = SpreadsheetApp.getActive();
  sheet_(ss, 'Events', EVENT_COLS);
  sheet_(ss, 'Scratches', SCRATCH_COLS);
  if (!ss.getSheetByName('Summary')) ss.insertSheet('Summary', 0);
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'refreshSummary'; });
  if (!has) ScriptApp.newTrigger('refreshSummary').timeBased().everyHours(1).create();
  refreshSummary();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pecan Pie').addItem('Refresh summary', 'refreshSummary').addToUi();
}

/* ---------------- Summary ---------------- */

function refreshSummary() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;               // another refresh or a large delivery is running; skip this one
  try { buildSummary_(); } finally { lock.releaseLock(); }
}

function buildSummary_() {
  const ss = SpreadsheetApp.getActive();
  const ev = rows_(ss.getSheetByName('Events'));
  const sc = rows_(ss.getSheetByName('Scratches')).filter(function (r) { return r.source !== 'debug'; });   // test cards don't count
  const sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary', 0);
  sum.clear();
  const blocks = [];
  const today = startOfDay_(new Date());

  // Who played, and when
  const testers = {};
  ev.forEach(function (r) {
    if (!r.tester || !(r.day instanceof Date)) return;
    const t = testers[r.tester] || (testers[r.tester] = {first: r.day, days: {}, sessions: {}});
    if (r.day < t.first) t.first = r.day;
    t.days[key_(r.day)] = true;
    if (r.session) t.sessions[r.session] = true;
  });
  const names = Object.keys(testers);
  const sessions = {};
  ev.forEach(function (r) { if (r.session) sessions[r.session] = sessions[r.session] || 0; });
  sc.forEach(function (r) { if (r.session in sessions) sessions[r.session]++; else sessions[r.session] = 1; });
  const perSession = Object.keys(sessions).map(function (k) { return sessions[k]; });
  const peeks = ev.filter(function (r) { return r.type === 'peek'; });
  const peekers = {}; peeks.forEach(function (r) { peekers[r.tester] = true; });
  const opens = ev.filter(function (r) { return r.type === 'app_open'; }).length;

  blocks.push(['Overview', [
    ['Testers', names.length],
    ['Sessions', perSession.length],
    ['App opens', opens],
    ['Cards scratched (excluding test cards)', sc.length],
    ['Cards per session, average', round_(avg_(perSession), 2)],
    ['Cards per session, median', median_(perSession)],
    ['Testers who peeked at least once', Object.keys(peekers).length + ' of ' + names.length],
    ['Peeks', peeks.length],
    ['Updated', new Date()]
  ]]);

  // Retention by days since each tester's first open
  const ret = [['Day', 'Eligible testers', 'Returned', 'Share']];
  for (let n = 0; n <= 7; n++) {
    let eligible = 0, back = 0;
    names.forEach(function (k) {
      const d = new Date(testers[k].first.getTime()); d.setDate(d.getDate() + n);
      if (d > today) return;
      eligible++;
      if (testers[k].days[key_(d)]) back++;
    });
    ret.push(['Day ' + n, eligible, back, eligible ? round_(back / eligible, 2) : '']);
  }
  blocks.push(['Retention (active on day N after first open)', ret]);

  // Daily activity
  const days = {};
  ev.forEach(function (r) {
    if (!(r.day instanceof Date)) return;
    const d = days[key_(r.day)] || (days[key_(r.day)] = {day: r.day, testers: {}, opens: 0, scratches: 0, scratchers: {}});
    d.testers[r.tester] = true;
    if (r.type === 'app_open') d.opens++;
  });
  sc.forEach(function (r) {
    if (!(r.day instanceof Date)) return;
    const d = days[key_(r.day)] || (days[key_(r.day)] = {day: r.day, testers: {}, opens: 0, scratches: 0, scratchers: {}});
    d.scratches++; d.scratchers[r.tester] = true;
  });
  const daily = [['Day', 'Active testers', 'App opens', 'Cards scratched', 'Testers who scratched']];
  Object.keys(days).sort().forEach(function (k) {
    const d = days[k];
    daily.push([d.day, Object.keys(d.testers).length, d.opens, d.scratches, Object.keys(d.scratchers).length]);
  });
  blocks.push(['Daily activity', daily]);

  // Grade mix by rank
  const gr = [['Rank', 'Cards'].concat(GRADES)];
  RANKS.forEach(function (name, i) {
    const rows = sc.filter(function (r) { return Number(r.rank) === i + 1; });
    gr.push([name, rows.length].concat(GRADES.map(function (g) { return rows.filter(function (r) { return r.grade === g; }).length; })));
  });
  gr.push(['All', sc.length].concat(GRADES.map(function (g) { return sc.filter(function (r) { return r.grade === g; }).length; })));
  blocks.push(['Condition grades by rank', gr]);

  // Do people scratch more carefully on rarer cards?
  const care = [['Rank', 'Cards', 'Median scratch time (s)', 'Median stroke speed (px/s)', 'Median weighted σ']];
  RANKS.forEach(function (name, i) {
    const rows = sc.filter(function (r) { return Number(r.rank) === i + 1; });
    care.push([name, rows.length,
      round_(median_(rows.map(function (r) { return Number(r.duration_ms) / 1000; })), 1),
      median_(rows.map(function (r) { return Number(r.speed_px_s); })),
      round_(median_(rows.map(function (r) { return Number(r.sigma_w); })), 3)]);
  });
  blocks.push(['Care by rank (slower and lower σ on rare cards would mean they care)', care]);

  // Where cards came from
  const src = {};
  sc.forEach(function (r) {
    const k = r.source === 'node' ? 'Node: ' + (r.place_src === 'osm' ? 'public place' : r.place_src === 'walk' ? 'walkable spot' : 'random spot') : r.source === 'daily' ? 'Daily card' : String(r.source || 'unknown');
    src[k] = (src[k] || 0) + 1;
  });
  blocks.push(['Card sources', [['Source', 'Cards']].concat(Object.keys(src).sort().map(function (k) { return [k, src[k]]; }))]);

  // Outliers
  blocks.push(['Outliers', [
    ['Holo', sc.filter(function (r) { return r.holo === true; }).length],
    ['Low print numbers', sc.filter(function (r) { return r.low_print === true; }).length],
    ['Ceiling breaks', sc.filter(function (r) { return String(r.broke || '') !== ''; }).length],
    ['New set slots filled', sc.filter(function (r) { return r.new_slot === true; }).length]
  ]]);

  // Sealed cards: who keeps them, which ranks, and how long they're held before scratching.
  sealedBlocks_(ev, sc).forEach(function (b) { blocks.push(b); });

  // Write the blocks down the sheet
  let row = 1;
  sum.getRange(row, 1).setValue('Pecan Pie pilot summary').setFontWeight('bold').setFontSize(14);
  row += 2;
  blocks.forEach(function (b) {
    sum.getRange(row, 1).setValue(b[0]).setFontWeight('bold');
    row++;
    const width = Math.max.apply(null, b[1].map(function (r) { return r.length; }));
    const vals = b[1].map(function (r) { const c = r.slice(); while (c.length < width) c.push(''); return c; });
    sum.getRange(row, 1, vals.length, width).setValues(vals);
    row += vals.length + 1;
  });
  sum.autoResizeColumns(1, 6);
}

/* ---------------- Sealed cards ---------------- */

function sealedBlocks_(ev, sc) {
  const now = Date.now();
  const kept = [], later = {};
  ev.forEach(function (r) {
    if (r.type !== 'card_kept_sealed' && r.type !== 'scratch_reveal') return;
    let d = {}; try { d = JSON.parse(r.data || '{}'); } catch (e) {}
    const at = r.at instanceof Date ? r.at.getTime() : NaN;
    if (r.type === 'card_kept_sealed') kept.push({id: d.instId || '', tester: r.tester, rank: Number(d.rank), newSlot: d.newSlot === true, at: at});
    else if (d.source === 'sealed' && d.instId) later[d.instId] = {at: at, heldMs: typeof d.heldMs === 'number' ? d.heldMs : NaN};   // missing means fall back to timestamps
  });
  // Pulls = every card taken from a node or the daily, whether scratched on the spot or kept sealed.
  const scratchedOnSpot = sc.filter(function (r) { return r.source === 'node' || r.source === 'daily'; });
  const pulls = kept.length + scratchedOnSpot.length;
  const holds = [], stillSealed = [];
  kept.forEach(function (k) {
    const l = k.id && later[k.id];
    if (l){ const h = isFinite(l.heldMs) ? l.heldMs : l.at - k.at; if (isFinite(h) && h >= 0){ k.held = h; holds.push(h); } }
    else if (isFinite(k.at)) stillSealed.push(now - k.at);
  });
  const testers = {}; kept.forEach(function (k) { if (k.tester) testers[k.tester] = true; });
  const dupKept = kept.filter(function (k) { return !k.newSlot; }).length;
  const firstPulls = scratchedOnSpot.filter(function (r) { return r.new_slot === true; }).length + kept.filter(function (k) { return k.newSlot; }).length;
  const dupPulls = pulls - firstPulls;

  const overview = [
    ['Cards kept sealed', kept.length],
    ['Share of pulls kept sealed', pulls ? round_(kept.length / pulls, 2) : ''],
    ['Testers who kept at least one sealed', Object.keys(testers).length],
    ['Scratched later', holds.length],
    ['Still sealed', stillSealed.length],
    ['Share of duplicates kept sealed', dupPulls ? round_(dupKept / dupPulls, 2) : ''],
    ['Share of first copies kept sealed', firstPulls ? round_((kept.length - dupKept) / firstPulls, 2) : ''],
    ['Average time held before scratching', dur_(avg_(holds))],
    ['Median time held before scratching', dur_(median_(holds))],
    ['Longest time held before scratching', dur_(holds.length ? Math.max.apply(null, holds) : '')],
    ['Longest still sealed (so far)', dur_(stillSealed.length ? Math.max.apply(null, stillSealed) : '')]
  ];
  const byRank = [['Rank', 'Kept sealed', 'Share of that rank\'s pulls', 'Scratched later', 'Average hold']];
  RANKS.forEach(function (name, i) {
    const k = kept.filter(function (x) { return x.rank === i + 1; });
    const spot = scratchedOnSpot.filter(function (r) { return Number(r.rank) === i + 1; }).length;
    const h = k.filter(function (x) { return isFinite(x.held); }).map(function (x) { return x.held; });
    byRank.push([name, k.length, (k.length + spot) ? round_(k.length / (k.length + spot), 2) : '', h.length, dur_(avg_(h))]);
  });
  return [['Sealed cards', overview], ['Sealed cards by rank', byRank]];
}
function dur_(ms) {
  if (ms === '' || !isFinite(ms)) return '';
  const min = ms / 60000;
  if (min < 90) return Math.round(min) + ' min';
  const h = min / 60;
  if (h < 48) return round_(h, 1) + ' h';
  return round_(h / 24, 1) + ' days';
}

/* ---------------- Helpers ---------------- */

function sheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function append_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
function rows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues(), head = vals[0];
  return vals.slice(1).map(function (v) { const o = {}; head.forEach(function (h, i) { o[h] = v[i]; }); return o; });
}
// Text from a phone is untrusted: cap it, and stop a leading = + - @ from being read as a formula.
function str_(v, max) {
  if (v == null) return '';
  let s = String(v).slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function num_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function date_(s) { const d = new Date(s); return isNaN(d.getTime()) ? '' : d; }
function day_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}
function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function key_(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function avg_(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : ''; }
function median_(a) {
  const v = a.filter(function (x) { return isFinite(x); }).sort(function (x, y) { return x - y; });
  if (!v.length) return '';
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function round_(x, p) { return x === '' ? '' : Math.round(x * Math.pow(10, p)) / Math.pow(10, p); }
function out_(msg) { return ContentService.createTextOutput(msg); }
