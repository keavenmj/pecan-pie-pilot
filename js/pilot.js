/* Pecan Pie pilot: map, nodes, collection, and logging around the scratch engine. */
(() => {
'use strict';
const E = window.Engine;
const $ = id => document.getElementById(id);
const app = $('app');

/* ================= Installed iPhone app sizing =================
   In an iPhone home-screen app with the status bar drawn over the page, iOS reports the viewport as shorter
   by the status bar's height yet draws from the very top, leaving a strip under the tab bar. The installed
   app always fills the screen, so size it to the physical screen instead. */
if (navigator.standalone === true){
  const fitScreen = () => {
    const land = window.matchMedia && matchMedia('(orientation: landscape)').matches;
    const h = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    document.documentElement.style.setProperty('--app-h', h + 'px');
  };
  fitScreen();
  window.addEventListener('resize', fitScreen);
  window.addEventListener('orientationchange', () => setTimeout(fitScreen, 250));
}

/* ================= Storage ================= */
// Everything lives in this phone's local storage. If a save fails because storage is full, logs are trimmed
// and the save retried, so the tester code, collection and nodes always win over diagnostic history.
const storageNoted = {};
const store = {
  get(k, d){ try{ const v = localStorage.getItem('pecan.' + k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){
    let text; try{ text = JSON.stringify(v); }catch{ return false; }
    try{ localStorage.setItem('pecan.' + k, text); return true; }catch{}
    let ok = false;
    try{ trimStorage(); localStorage.setItem('pecan.' + k, text); ok = true; }catch{}
    noteStorageTrouble(k, ok, text.length);
    return ok;
  }
};
function trimStorage(){
  try{ if (events.length > 100){ events = events.slice(-100); localStorage.setItem('pecan.events', JSON.stringify(events)); } }catch{}
  try{ const lab = JSON.parse(localStorage.getItem('scratchlab.log') || '[]'); if (lab.length > 30) localStorage.setItem('scratchlab.log', JSON.stringify(lab.slice(-30))); }catch{}
  try{ if (outbox.length > 1500){ outbox = outbox.slice(-1500); localStorage.setItem('pecan.outbox', JSON.stringify(outbox)); } }catch{}
}
function localChars(){
  let n = 0;
  try{ for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } }catch{}
  return n;
}
function noteStorageTrouble(key, recovered, chars){
  if (storageNoted[key + recovered]) return;           // once per key per launch, and never recursive
  storageNoted[key + recovered] = true;
  setTimeout(() => { try{ event('storage_failed', {key, recovered, chars, localChars:localChars()}); }catch{} }, 0);
}

/* ================= Config ================= */
const DEFAULT_CENTER = {lat:33.7701, lng:-118.1937};          // Long Beach, used only for mock location with no fix yet
const RANK_WEIGHTS = [45, 28, 17, 8, 2];                        // Common to Mythic, percent
const NODE_NAMES = ['Tidewater Post', 'Gull Rock', 'Lantern Steps', 'Rope Yard', 'Salt Gate', 'Breakwater Bench', 'Kelp Corner',
  'Pilot House', 'Harbor Clock', 'Net Loft', 'Bell Tower', 'Ferry Slip', 'Driftwood Arch', 'Signal Hill', 'Shell Walk', 'Mooring Post',
  'Old Customs', 'Fog Bell', 'Cannery Row', 'Pier Gate'];
const P = Object.assign({vis:400, ringMid:200, ringNear:100, reach:75, acc:100, cool:2, dieCool:6, mock:'off', walk:'1.4', tester:'', hook:'', debug:false, nodeSource:'osm'}, store.get('pilot', {}));
const saveP = () => store.set('pilot', P);
// Card spots now recharge in 2 hours (was 4). Settings saved before the change still say 4, so move them once.
if ((P.coolV || 0) < 2){ if (P.cool === 4) P.cool = 2; P.coolV = 2; saveP(); }

const NODES_V = 4;                                              // bump to reseed everyone after a node-format change
let nodes = store.get('nodesV', 0) === NODES_V ? store.get('nodes', null) : null;
let seedCenters = store.get('seedCenters', []);
let collection = store.get('collection', []);
let events = store.get('events', []);
let daily = store.get('daily', {last:0});
let testerId = store.get('tid', null);
const newIdentity = !testerId;
if (!testerId){ testerId = 'T-' + Math.floor(E.rng()*1e6).toString(36).toUpperCase(); store.set('tid', testerId); }
const session = Date.now().toString(36) + '-' + Math.floor(E.rng()*1e6).toString(36);

/* ================= Event log ================= */
const APP_V = '2.8';
const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS'
  : /Android/.test(navigator.userAgent) ? 'Android' : 'other';
const standalone = () => !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const endpoint = () => P.hook || (window.PECAN_CONFIG && window.PECAN_CONFIG.logEndpoint) || '';
let outbox = store.get('outbox', []);

function event(type, data){
  const now = new Date();
  const e = Object.assign({at:now.toISOString(), day:localDay(now), type, session, tester:P.tester || testerId,
    id:now.getTime().toString(36) + Math.floor(E.rng()*1e8).toString(36), app:APP_V, platform:PLATFORM, standalone:standalone()}, data || {});
  events.push(e); if (events.length > 300) events = events.slice(-300);   // the Sheet keeps the full record
  store.set('events', events);
  if (endpoint()){
    outbox.push(e); if (outbox.length > 2000) outbox = outbox.slice(-2000);
    store.set('outbox', outbox); scheduleFlush();
  }
}

/* Delivery: batch the outbox, keep anything that fails, retry later. Each event carries an id so the receiver drops repeats. */
let flushing = false, flushTimer = null, flushAt = 0;
function scheduleFlush(ms){
  const at = Date.now() + (ms == null ? 4000 : ms);
  if (flushTimer && flushAt <= at) return;                   // an earlier send is already scheduled
  clearTimeout(flushTimer); flushAt = at; flushTimer = setTimeout(flush, at - Date.now());
}
async function flush(){
  clearTimeout(flushTimer); flushTimer = null;
  const url = endpoint();
  if (flushing || !outbox.length || !url || !navigator.onLine) return updateOutboxNote();
  flushing = true;
  const batch = outbox.slice(0, 100), body = JSON.stringify({v:1, events:batch});
  try{
    await fetch(url, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body, keepalive:body.length < 60000});
    const sent = new Set(batch.map(e => e.id));
    outbox = outbox.filter(e => !sent.has(e.id)); store.set('outbox', outbox);
  }catch{}                                                   // offline or blocked: keep the batch for next time
  flushing = false;
  if (outbox.length) scheduleFlush(15000);
  updateOutboxNote();
}
function beaconFlush(){
  const url = endpoint();
  if (!url || !outbox.length || !navigator.sendBeacon) return;
  const batch = outbox.slice(0, 50), blob = new Blob([JSON.stringify({v:1, events:batch})], {type:'text/plain;charset=utf-8'});
  try{ if (navigator.sendBeacon(url, blob)){ const sent = new Set(batch.map(e => e.id)); outbox = outbox.filter(e => !sent.has(e.id)); store.set('outbox', outbox); } }catch{}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beaconFlush(); else scheduleFlush(500); });
window.addEventListener('pagehide', beaconFlush);
window.addEventListener('online', () => scheduleFlush(500));
setInterval(() => { if (outbox.length) flush(); }, 30000);
function updateOutboxNote(){
  const el = document.getElementById('dOutbox'); if (!el) return;
  const url = endpoint();
  el.textContent = !url ? 'No log endpoint: events stay on this phone.'
    : `${P.hook ? 'Custom endpoint' : 'Built-in endpoint'}. ${outbox.length ? outbox.length + ' event' + (outbox.length === 1 ? '' : 's') + ' waiting to send.' : 'Everything sent.'}`;
}

/* ================= Bingo ================= */
/* One personal 5x5 board. Every copy carries a bingo ball on its border (any letter, number 1 to 30), so duplicates
   can still fill squares. A copy daubs its square the moment it's collected, scratched or kept sealed. */
const LETTERS = 'BINGO', BALL_MAX = 30;
const rollBall = () => ({l:LETTERS[Math.floor(E.rng()*5)], n:1 + Math.floor(E.rng()*BALL_MAX)});
const LINES = [];
for (let r = 0; r < 5; r++) LINES.push([0, 1, 2, 3, 4].map(c => r*5 + c));
for (let c = 0; c < 5; c++) LINES.push([0, 1, 2, 3, 4].map(r => r*5 + c));
LINES.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
function newBoard(){
  const cells = new Array(25);
  for (let c = 0; c < 5; c++){
    const nums = new Set(); while (nums.size < 5) nums.add(1 + Math.floor(E.rng()*BALL_MAX));
    [...nums].sort((a, b) => a - b).forEach((n, r) => { cells[r*5 + c] = {l:LETTERS[c], n, by:null}; });
  }
  cells[12] = {l:'N', n:0, by:'free'};
  return {id:'b' + Date.now().toString(36), at:new Date().toISOString(), cells, lines:[], paid:[], done:false};
}
let board = store.get('bingo', null);
if (!board || !Array.isArray(board.cells) || board.cells.length !== 25){ board = newBoard(); store.set('bingo', board); }
let badges = store.get('badges', []);
const openCell = b => !b || board.done ? -1 : board.cells.findIndex(x => !x.by && x.l === b.l && x.n === b.n);
const numberOpen = b => !!b && !board.done && board.cells.some(x => !x.by && x.n === b.n);
// A spot's ball is fixed until its card is taken, so walking closer never changes it.
function ballFor(n){
  const p = pending['node:' + n.id];
  if (p && p.ball) return p.ball;
  if (!n.ball){ n.ball = rollBall(); store.set('nodes', nodes); }
  return n.ball;
}
// Rewards pay once per direction: the first row, the first column and the first diagonal. Whichever is finished
// first pays an Uncommon die, the second a Rare, the third a Legendary. Other lines pay nothing; a full board pays a Mythic.
const KIND = li => li < 5 ? 'row' : li < 10 ? 'column' : 'diagonal';
const KINDS = ['row', 'column', 'diagonal'];
const PAID_DIE = k => [2, 3, 4][k - 1];
const paidKinds = () => board.paid || (board.paid = [...new Set(board.lines.map(KIND))]);   // older boards: derive from lines done
function addBadge(id, name){ if (badges.some(b => b.id === id)) return; badges.push({id, name, at:new Date().toISOString()}); store.set('badges', badges); }
// Returns notices to show the player. Test cards never count.
function daub(inst){
  if (!inst || !inst.ball || inst.bingo || inst.source === 'debug') return [];
  const i = openCell(inst.ball); if (i < 0) return [];
  const cell = board.cells[i], notes = [`${cell.l}·${cell.n} daubed on your bingo board.`];
  cell.by = inst.id; cell.at = new Date().toISOString(); inst.bingo = board.id + ':' + i;
  if (!inst.debugFill) store.set('collection', collection);
  const filled = board.cells.filter(c => c.by).length - 1;
  event('bingo_daub', {square:cell.l + cell.n, cell:i, instId:inst.id, card:inst.cardId || '', filled, board:board.id});
  const extra = [];
  LINES.forEach((ln, li) => {
    if (board.lines.includes(li) || !ln.every(j => board.cells[j].by)) return;
    const kind = KIND(li), paid = paidKinds(), first = !paid.includes(kind);   // read before recording this line
    board.lines.push(li);
    if (first){
      paid.push(kind);
      const rank = PAID_DIE(paid.length);
      grantDie(rank, 'bingo_line');
      addBadge(board.id + ':' + kind, `First ${kind}`);
      notes.push(`Bingo! Your first ${kind}. You earned ${article(E.RANKS[rank - 1])} ${E.RANKS[rank - 1]} die (${E.dieName(rank)}).`);
    } else extra.push(kind);
    event('bingo_line', {n:board.lines.length, line:li, kind, paid:first, dieRank:first ? PAID_DIE(paidKinds().length) : undefined, board:board.id});
  });
  // Lines in a direction that already paid get one combined notice, so a busy square doesn't stack up several.
  const done = board.cells.every(c => c.by);
  if (extra.length && !done){
    const left = KINDS.filter(k => !paidKinds().includes(k));
    notes.push((extra.length > 1 ? `${extra.length} more lines done.` : `Another ${extra[0]} done.`) + (left.length ? ` Your first ${left.join(' or ')} still pays a die.` : ' Fill the whole board for a Mythic die.'));
  }
  if (!board.done && done){
    board.done = true;
    grantDie(5, 'blackout'); addBadge(board.id + ':blackout', 'Blackout');
    notes.push('Blackout! Every square is filled. You earned a Mythic die (3d8) and the Blackout badge.');
    event('bingo_blackout', {board:board.id, days:+((Date.now() - new Date(board.at).getTime())/864e5).toFixed(2)});
  }
  store.set('bingo', board);
  return notes;
}

/* ================= Dice ================= */
/* Stat-Mod Dice: committed before a scratch, rolled at the reveal, the total added to all four stats.
   Found dice come from bingo lines and dice caches on the map. The basic Common die recharges with Distance. */
let dice = store.get('dice', []);
const DIE_ODDS = [60, 30, 8, 2, 0];                       // dice caches: mostly Common and Uncommon
const DIST_CHARGE = 1000, DIST_CAP = 3000, IDLE_RATE = DIST_CHARGE/7200;   // 1 km walked, or 2 h with the app open; 3 charges a day
let basic = Object.assign({pts:0, ready:false, day:'', today:0, walkM:0, idleS:0, anchor:null, lastMoveT:0}, store.get('basicDie', {}));
const saveBasic = () => store.set('basicDie', basic);
function grantDie(rank, from){
  dice.push({id:'d' + Date.now().toString(36) + Math.floor(E.rng()*1e4).toString(36), rank, from, at:new Date().toISOString()});
  store.set('dice', dice); event('die_earned', {rank, from, held:dice.length});
  updateDiceChip();
}
function pickupDie(n){
  let r = E.rng()*100, rank = 1;
  for (let i = 0; i < DIE_ODDS.length; i++){ if (r < DIE_ODDS[i]){ rank = i + 1; break; } r -= DIE_ODDS[i]; }
  grantDie(rank, 'cache');
  n.coolUntil = Date.now() + P.dieCool*3600e3; store.set('nodes', nodes);
  event('die_pickup', {node:n.id, rank, src:n.src});
  closeSheet(); refreshNodes();
  toast([`You found ${article(E.RANKS[rank - 1])} ${E.RANKS[rank - 1]} die (${E.dieName(rank)}). Add it before your next scratch.`]);
}
// Distance: walking while moving, idle time while not, never both, under one daily cap (see the doc's Distance economy).
function addDistance(pts, mode){
  const day = localDay(new Date());
  if (basic.day !== day){ basic.day = day; basic.today = 0; basic.walkM = 0; basic.idleS = 0; }
  if (basic.ready || pts <= 0) return;
  const add = Math.min(pts, DIST_CAP - basic.today); if (add <= 0) return;
  basic.pts += add; basic.today += add;
  if (mode === 'walk') basic.walkM += add; else basic.idleS += add/IDLE_RATE;
  if (basic.pts >= DIST_CHARGE){
    basic.pts = 0; basic.ready = true;
    event('basic_die_charged', {mode, todayPts:Math.round(basic.today), walkM:Math.round(basic.walkM), idleS:Math.round(basic.idleS)});
    toast(['Your basic die is charged. Add it before a scratch for +1 to +4 on every stat.']);
  }
  saveBasic(); updateDiceChip();
}
function trackMove(lat, lng, acc){
  if (acc > 35) return;                                   // too rough to tell a step from drift
  const now = Date.now(), a = basic.anchor;
  if (!a){ basic.anchor = {lat, lng, t:now}; return; }
  const d = dist(a, {lat, lng}), dt = Math.max(1, (now - a.t)/1000);
  if (d < Math.max(12, acc*.8)) return;                   // jitter: keep the anchor
  basic.anchor = {lat, lng, t:now};
  if (d/dt > 3) return;                                   // faster than a brisk walk: a car, a bus, or a GPS jump
  basic.lastMoveT = now;
  addDistance(d, 'walk');
}
setInterval(() => {
  if (document.visibilityState === 'visible' && Date.now() - basic.lastMoveT > 60000) addDistance(10*IDLE_RATE, 'idle');
}, 10000);
// The basic die lives in a fixed button at the map's edge (screen furniture, not a pin): a gold ring fills as it
// charges, the die tumbles a little whenever it gains a percent, and it bounces and glows once it's ready.
let hudPct = null, hudReady = null;
function updateDiceChip(){
  const el = $('dieHud'); if (!el) return;
  const pct = basic.ready ? 100 : Math.floor(basic.pts/DIST_CHARGE*100);
  el.style.setProperty('--p', pct);
  el.classList.toggle('ready', basic.ready);
  $('dieHudLabel').textContent = basic.ready ? 'Ready' : pct + '%';
  const found = $('dieHudFound'); found.hidden = !dice.length; found.textContent = '+' + dice.length;
  el.setAttribute('aria-label', `Your dice. Basic die ${basic.ready ? 'ready' : pct + '% charged'}${dice.length ? `, ${dice.length} found` : ''}`);
  if (hudPct !== null && pct > hudPct && !basic.ready) bump(el, 'tumble', 650);
  if (hudReady === false && basic.ready) bump(el, 'charged', 900);
  hudPct = pct; hudReady = basic.ready;
  if (!$('diceSheet').hidden) $('diceSheetBody').innerHTML = diceMarkup();
  const seg = $('segDice'); if (seg) seg.textContent = `Dice ${dice.length + (basic.ready ? 1 : 0)}`;
}
function bump(el, cls, ms){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
function openDiceSheet(){ closeSheet(); $('diceSheetBody').innerHTML = diceMarkup(); $('diceSheet').hidden = false; event('view', {view:'dice_sheet', dice:dice.length, basicReady:basic.ready}); }
$('dieHud').addEventListener('click', () => { if ($('diceSheet').hidden) openDiceSheet(); else $('diceSheet').hidden = true; });
$('diceSheetClose').addEventListener('click', () => { $('diceSheet').hidden = true; });
$('diceSheetMore').addEventListener('click', () => { $('diceSheet').hidden = true; showView('vCollection'); setSeg('dice'); });

/* ---------- Committing a die before a scratch ---------- */
let heldNotes = [];
// Dice show rank the way cards do: four round pips and a diamond for Mythic, never a color.
const miniPips = r => `<span class="mini-pips" role="img" aria-label="Rank ${r}">${[1, 2, 3, 4].map(i => `<i class="${r >= i ? 'on' : ''}"></i>`).join('')}<i class="dia${r >= 5 ? ' on' : ''}"></i></span>`;
const dieChoices = () => {
  const out = [];
  if (basic.ready) out.push({key:'basic', rank:1, src:'basic', label:'Basic die', sub:'Common · d4 · recharges with Distance'});
  for (let r = 5; r >= 1; r--){ const n = dice.filter(d => d.rank === r).length; if (n) out.push({key:'r' + r, rank:r, src:'found', label:`${E.RANKS[r - 1]} die`, sub:`${E.dieName(r)} · +${E.DICE[r][0]} to +${E.DICE[r][0]*E.DICE[r][1]} · you have ${n}`}); }
  return out;
};
function currentCommit(){
  if (!current) return null;
  const pk = pendKey(current);
  return pk ? (pending[pk] && pending[pk].die) || null : current.dieCommit || null;
}
function updateDieBtn(){
  const btn = $('scratchDie'); if (!btn || !current) return;
  const c = currentCommit(), canChange = !E.started && !E.revealed;
  btn.hidden = E.revealed || (!c && (!canChange || !dieChoices().length));
  btn.disabled = !canChange;
  btn.classList.toggle('on', !!c);
  btn.innerHTML = `<span class="chip-die" aria-hidden="true"></span>` + (c ? `${E.RANKS[c.rank - 1]} die in play` : 'Add a die');
}
function releaseDie(c){
  if (!c) return;
  if (c.src === 'basic'){ basic.ready = true; saveBasic(); }
  else dice.push({id:c.id, rank:c.rank, from:c.from || 'returned', at:c.at || new Date().toISOString()});
  store.set('dice', dice); updateDiceChip();
}
function commitDie(choice){
  if (!current || E.started || E.revealed) return;
  const pk = pendKey(current), prev = currentCommit();
  releaseDie(prev);
  let c = null;
  if (choice && choice.src === 'basic'){ basic.ready = false; basic.pts = 0; saveBasic(); c = {rank:1, src:'basic'}; }
  else if (choice){ const i = dice.findIndex(d => d.rank === choice.rank); if (i >= 0){ const d = dice.splice(i, 1)[0]; c = {rank:d.rank, src:'found', id:d.id, from:d.from, at:d.at}; } }
  store.set('dice', dice);
  if (pk && pending[pk]){ pending[pk].die = c; store.set('pending', pending); } else current.dieCommit = c;
  E.state.ctx.die = c ? c.rank : null;
  event(c ? 'die_commit' : 'die_uncommit', {rank:c ? c.rank : prev && prev.rank, src:c ? c.src : prev && prev.src, source:current.source, card:E.state.card && E.state.card.id});
  updateDieBtn(); updateDiceChip(); closeDiePick();
}
function openDiePick(){
  const list = $('diePickList'), choices = dieChoices(), c = currentCommit();
  list.innerHTML = choices.map((d, i) => `<button class="die-opt" type="button" data-i="${i}"><span class="die-ico r${d.rank}" aria-hidden="true"></span><span><b>${d.label}${miniPips(d.rank)}</b><small>${d.sub}</small></span></button>`).join('')
    + (c ? '<button class="die-opt none" type="button" data-i="-1"><span><b>No die</b><small>Put the die back for later</small></span></button>' : '');
  list._choices = choices;
  $('diePick').hidden = false;
}
function closeDiePick(){ const el = $('diePick'); if (el) el.hidden = true; }
$('scratchDie').addEventListener('click', () => { if ($('diePick').hidden) openDiePick(); else closeDiePick(); });
$('diePickClose').addEventListener('click', closeDiePick);
$('diePickList').addEventListener('click', e => {
  const b = e.target.closest('.die-opt'); if (!b) return;
  const i = +b.dataset.i; commitDie(i < 0 ? null : $('diePickList')._choices[i]);
});

/* ---------- Notices ---------- */
let toastQ = [], toastBusy = false;
function toast(lines){
  lines = (lines || []).filter(Boolean); if (!lines.length) return;
  toastQ = toastQ.concat(lines); if (!toastBusy) nextToast();
}
function nextToast(){
  const el = $('toast'), t = toastQ.shift();
  if (!t){ toastBusy = false; el.hidden = true; return; }
  toastBusy = true; el.textContent = t; el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  if (/^(Bingo|Blackout)/.test(t)){ try{ E.Sound.reveal(4, false); }catch{} try{ navigator.vibrate && navigator.vibrate([20, 40, 20]); }catch{} }
  setTimeout(nextToast, Math.min(6500, 2600 + t.length*35));
}
$('toast').addEventListener('click', () => nextToast());

function diceMarkup(){
  const pct = Math.floor(basic.pts/DIST_CHARGE*100), left = DIST_CHARGE - basic.pts, capped = basic.today >= DIST_CAP && !basic.ready;
  const basicLine = basic.ready ? 'Charged. Add it before a scratch.'
    : capped ? 'You’ve earned today’s 3 charges. It starts charging again tomorrow.'
    : `${pct}% charged. About ${fmtDist(left)} more walking, or ${Math.ceil(left/IDLE_RATE/60)} min with the app open.`;
  const byRank = [5, 4, 3, 2, 1].map(r => ({r, n:dice.filter(d => d.rank === r).length})).filter(x => x.n);
  return `<section class="dice-home">
    <div class="dice-panel">
      <div class="drow"><span class="die-ico r1" aria-hidden="true"></span><div><b>Basic die</b>${miniPips(1)} <small>Common · d4</small><div class="meter-bar"><i style="width:${basic.ready ? 100 : pct}%"></i></div><small>${basicLine}</small></div></div>
      ${byRank.length ? byRank.map(x => `<div class="drow"><span class="die-ico r${x.r}" aria-hidden="true"></span><div><b>${E.RANKS[x.r - 1]} die ×${x.n}</b>${miniPips(x.r)} <small>${E.dieName(x.r)} · +${E.DICE[x.r][0]} to +${E.DICE[x.r][0]*E.DICE[x.r][1]}</small></div></div>`).join('')
        : '<p class="group-note">No found dice yet.</p>'}
      <p class="group-note">Before you scratch, tap <b>Add a die</b>. Its roll is added to all four stats when the card resolves, which can push a stat past its ceiling (shown in gold).</p>
      <p class="group-note">Find more at <b>dice caches</b> (the die pins on the map), and from your first bingo row, column and diagonal.</p>
    </div>
  </section>`;
}
/* ---------- Bingo tab ---------- */
function bingoMarkup(){
  const filled = board.cells.filter(c => c.by).length - 1, k = board.lines.length, paid = paidKinds(), kindsLeft = KINDS.filter(x => !paid.includes(x));
  const head = LETTERS.split('').map(l => `<div class="bhead" style="--bc:${E.BALL_COL[l]}">${l}</div>`).join('');
  const cells = board.cells.map((c, i) => {
    if (c.by === 'free') return `<div class="bcell free"><span>★</span><small>Free</small></div>`;
    if (c.by) return `<button class="bcell daubed" type="button" data-cell="${i}" style="--bc:${E.BALL_COL[c.l]}" aria-label="${c.l} ${c.n}, daubed"><span>${c.n}</span></button>`;
    return `<div class="bcell" aria-label="${c.l} ${c.n}, open"><span>${c.n}</span></div>`;
  }).join('');
  const nextRank = kindsLeft.length ? E.RANKS[PAID_DIE(paid.length + 1) - 1] : '';
  const lineNote = board.done ? 'Blackout! Every square is filled.'
    : (kindsLeft.length ? `Your first ${kindsLeft.join(', ').replace(/, ([^,]*)$/, ' or $1')} earns ${article(nextRank)} ${nextRank} die. ` : 'You’ve earned a die for a row, a column and a diagonal. ')
      + 'A full board earns a Mythic die.';
  const rewards = KINDS.map(x => `<span class="reward${paid.includes(x) ? ' done' : ''}">${paid.includes(x) ? '✓ ' : ''}First ${x}</span>`).join('') + `<span class="reward${board.done ? ' done' : ''}">${board.done ? '✓ ' : ''}Full board</span>`;
  return `<section class="bingo">
    <div class="bboard" role="grid" aria-label="Bingo board, ${filled} of 24 filled">${head}${cells}</div>
    <div class="rewards">${rewards}</div>
    <p class="bnote">${lineNote}</p>
    <p class="group-note">Every card has a bingo ball on its border. When you collect a card whose ball matches an open square, it's daubed automatically. On the map, nearby spots show their ball: a gold ring means that number is open on your board, and a pulsing star up close means the exact square is.</p>
    ${board.done ? '<button class="btn primary wide" id="newBoard" type="button">Start a new board</button>' : ''}
    ${badges.length ? `<h2 class="group-head">Badges <span>${badges.length}</span></h2><div class="badges">${badges.map(b => `<span class="badge${/Blackout/.test(b.name) ? ' gold' : ''}">${E.esc(b.name)}</span>`).join('')}</div>` : ''}
    <p class="group-note">Rewards are dice: see the <button class="linklike" type="button" data-seg="dice">Dice tab</button>.</p>
  </section>`;
}

/* ================= Geometry ================= */
const R_EARTH = 6371000, rad = d => d*Math.PI/180;
function dist(a, b){
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R_EARTH*Math.asin(Math.sqrt(h));
}
function offset(p, meters, bearing){
  const dLat = meters*Math.cos(bearing)/R_EARTH, dLng = meters*Math.sin(bearing)/(R_EARTH*Math.cos(rad(p.lat)));
  return {lat:p.lat + dLat*180/Math.PI, lng:p.lng + dLng*180/Math.PI};
}
const fmtDist = m => m < 1000 ? `${Math.round(m/5)*5} m` : `${(m/1000).toFixed(1)} km`;
function fmtLeft(ms){
  const m = Math.max(1, Math.ceil(ms/60000)), h = Math.floor(m/60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/* ================= Map ================= */
const map = L.map('map', {zoomControl:false, attributionControl:true}).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 17);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
/* Base map: our dark vector style on OpenFreeMap tiles. If the phone has no WebGL, or the style
   can't load within ten seconds, fall back to OpenStreetMap's raster tiles, darkened with CSS. */
let baseLayer = null, baseMode = 'none';
function hasWebGL(){ try{ const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }catch{ return false; } }
function useRaster(reason, detail){
  if (baseMode === 'raster') return;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  $('map').classList.add('raster-dark'); baseMode = 'raster';
  if (reason) event('map_fallback', {reason, detail:String(detail || '').slice(0, 160)});
  window.__mapFallback = {reason, detail:String(detail || '')};
}
function useVector(){
  if (!window.maplibregl || !L.maplibreGL || !window.PECAN_MAPSTYLE || !hasWebGL()) return useRaster(hasWebGL() ? 'missing_library' : 'no_webgl');
  let ok = false;
  baseLayer = L.maplibreGL({style:window.PECAN_MAPSTYLE, interactive:false});
  // One short credit line that still names and links all three required parties. (The bridge would otherwise
  // join the long credit from both tile sources, which doubles it and wraps onto two lines on a phone.)
  baseLayer.getAttribution = () => '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  baseLayer.addTo(map);
  baseMode = 'vector';
  const gl = baseLayer.getMaplibreMap();
  // Working once the tile service has answered with its metadata; any error before that means it's unreachable.
  gl.on('sourcedata', e => { if (e.sourceId === 'omt' && e.sourceDataType === 'metadata') ok = true; });
  gl.on('error', e => {
    const msg = String((e && e.error && (e.error.message || e.error)) || 'unknown');
    (window.__mapErrors = window.__mapErrors || []).push(msg.slice(0, 200));
    if (!ok) useRaster('style_error', msg);
  });
  setTimeout(() => { if (!ok && baseMode === 'vector') useRaster('style_timeout'); }, 10000);
}
useVector();
let me = null, meAcc = Infinity, hadFix = false, follow = true;
const meMarker = L.marker([0, 0], {icon:L.divIcon({className:'', html:'<div class="me"></div>', iconSize:[18, 18], iconAnchor:[9, 9]}), interactive:false, keyboard:false, zIndexOffset:1000});
const accCircle = L.circle([0, 0], {radius:1, color:'#2F7DE1', weight:1, fillOpacity:.1, interactive:false});
const reachCircle = L.circle([0, 0], {radius:P.reach, color:'#C9971C', weight:1.5, dashArray:'4 6', fill:false, interactive:false});
map.on('dragstart', () => { follow = false; });
$('recenter').addEventListener('click', () => { follow = true; if (me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16)); });

function setPosition(lat, lng, acc){
  me = {lat, lng}; meAcc = acc;
  const ll = [lat, lng];
  meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(Math.min(acc, 2000)); reachCircle.setLatLng(ll);
  if (!hadFix){
    hadFix = true;
    accCircle.addTo(map); reachCircle.addTo(map); meMarker.addTo(map);
    map.setView(ll, 17);
    if (!nodes || !nodes.length || !seedCenters.length) seedArea(me, true);
  } else if (follow) map.panTo(ll, {animate:true, duration:.5});
  if (hadFix && !seeding && seedCenters.length && seedCenters.every(c => dist(c, me) > 500) && Date.now() - lastSeedTry > 30000) seedArea(me, false);
  if (P.mock === 'on') store.set('mockPos', me);
  trackMove(lat, lng, acc);
  updateGps(); refreshNodes();
}

function updateGps(){
  const el = $('gpsChip');
  if (P.mock === 'on'){ el.className = 'gps mock'; el.textContent = 'Mock location'; return; }
  if (!hadFix){ el.className = 'gps'; el.textContent = 'Finding you…'; return; }
  const a = Math.round(meAcc);
  if (meAcc <= 20){ el.className = 'gps good'; el.textContent = `GPS ±${a} m`; }
  else if (meAcc <= P.acc){ el.className = 'gps fair'; el.textContent = `GPS ±${a} m`; }
  else { el.className = 'gps bad'; el.textContent = `GPS ±${a} m, too rough to scratch`; }
}

/* ================= Location sources ================= */
let watchId = null, lastLocState = null;
function locState(s){ if (s !== lastLocState){ lastLocState = s; event('location_state', {state:s}); } }
function startReal(){
  if (!('geolocation' in navigator)) return showPerm('unsupported');
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(pos => {
    if (P.mock === 'on') return;
    hidePerm(); locState('granted');
    setPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy || 999);
  }, err => {
    if (err.code === 1){ stopReal(); showPerm('denied'); locState('denied'); }
    else { const el = $('gpsChip'); el.className = 'gps bad'; el.textContent = err.code === 3 ? 'Waiting for GPS…' : 'GPS unavailable, retrying…'; }
  }, {enableHighAccuracy:true, maximumAge:3000, timeout:20000});
}
function stopReal(){ if (watchId != null){ navigator.geolocation.clearWatch(watchId); watchId = null; } }
async function initLocation(){
  if (P.mock === 'on') return startMock();
  if (!('geolocation' in navigator)) return showPerm('unsupported');
  let st = 'prompt';
  try{ if (navigator.permissions && navigator.permissions.query) st = (await navigator.permissions.query({name:'geolocation'})).state; }catch{}
  if (st === 'granted') startReal();
  else if (st === 'denied'){ showPerm('denied'); locState('denied'); }
  else { showPerm('prompt'); locState('prompt'); }
}

/* Mock walking for desk testing */
let walkTimer = null;
function startMock(){
  stopReal(); hidePerm();
  const p = me || store.get('mockPos', null) || DEFAULT_CENTER;
  setPosition(p.lat, p.lng, 5);
}
function stopMock(){ clearInterval(walkTimer); walkTimer = null; }
map.on('click', e => {
  if (P.mock !== 'on' || !me) return;
  const target = {lat:e.latlng.lat, lng:e.latlng.lng}, speed = +P.walk;
  stopMock();
  if (!speed) return setPosition(target.lat, target.lng, 5);
  walkTimer = setInterval(() => {
    const d = dist(me, target), step = speed*.25;
    if (d <= step){ stopMock(); return setPosition(target.lat, target.lng, 5); }
    const k = step/d;
    setPosition(me.lat + (target.lat - me.lat)*k, me.lng + (target.lng - me.lng)*k, 5);
  }, 250);
});

/* ================= Permission screen ================= */
function showPerm(kind){
  const s = $('permScreen'); s.hidden = false;
  const title = $('permTitle'), body = $('permBody'), go = $('permGo'), note = $('permNote');
  note.textContent = '';
  if (kind === 'prompt'){
    title.textContent = 'Turn on location';
    body.textContent = 'Pecan Pie shows nodes near you and checks when you reach one. Your location stays on this phone.';
    go.textContent = 'Turn on location'; go.hidden = false;
    go.onclick = () => { note.textContent = 'Choose Allow when your phone asks.'; startReal(); };
  } else if (kind === 'denied'){
    title.textContent = 'Location is off for Pecan Pie';
    body.innerHTML = 'Nodes need your location. To turn it back on:<ol><li><b>iPhone:</b> Settings, then Privacy &amp; Security, Location Services, Safari Websites, and choose While Using the App.</li><li><b>Android (Chrome):</b> tap the icon left of the web address, then Permissions, Location, and choose Allow.</li></ol>Then come back and tap Try again.';
    go.textContent = 'Try again'; go.hidden = false;
    go.onclick = () => location.reload();
    note.textContent = 'Your daily card and collection still work without location.';
  } else {
    title.textContent = 'Location isn’t available';
    body.textContent = 'This browser can’t share your location, so nodes can’t appear. Your daily card and collection still work.';
    go.hidden = true;
  }
}
function hidePerm(){ $('permScreen').hidden = true; }
$('permSkip').addEventListener('click', () => showView('vCollection'));

/* ================= Nodes ================= */
/* Nodes come from public places in OpenStreetMap, with random spots only as a fallback. */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SKIP_HISTORIC = new Set(['memorial', 'tomb', 'grave', 'wayside_shrine', 'wayside_cross', 'cemetery']);
const AMENITY_KIND = {library:['Library', 7], fountain:['Fountain', 8], clock:['Public clock', 6], arts_centre:['Arts center', 6], theatre:['Theater', 6],
  cinema:['Cinema', 5], community_centre:['Community center', 5], townhall:['Town hall', 6], marketplace:['Market', 6], cafe:['Cafe', 5],
  ice_cream:['Ice cream shop', 5], post_office:['Post office', 4]};
function kindOf(t){
  if (t.access === 'private' || t.access === 'no' || t.access === 'customers') return null;
  if (t.man_made === 'lighthouse') return ['Lighthouse', 10];
  if (t.man_made === 'pier') return ['Pier', 8];
  if (t.tourism === 'artwork') return ['Public art', 9];
  if (t.tourism === 'viewpoint') return ['Viewpoint', 9];
  if (t.tourism === 'museum') return ['Museum', 7];
  if (t.tourism === 'attraction') return ['Landmark', 6];
  if (t.historic && !SKIP_HISTORIC.has(t.historic)) return ['Historic site', 8];
  if (t.leisure === 'park') return ['Park', 7];
  if (t.leisure === 'garden') return ['Garden', 6];
  if (t.amenity && AMENITY_KIND[t.amenity]) return AMENITY_KIND[t.amenity];
  return null;
}
/* One request per area: public places (centers) plus walkways and hazards (geometry). */
const WALK_RE = '^(footway|path|pedestrian|cycleway|bridleway|track)$';
const ROAD_RE = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road|busway)$';
function overpassQuery(c, r){
  const a = `(around:${r},${c.lat.toFixed(6)},${c.lng.toFixed(6)})`, h = `(around:${r + 60},${c.lat.toFixed(6)},${c.lng.toFixed(6)})`;
  return `[out:json][timeout:25];` +
    `(nwr${a}["tourism"~"^(artwork|viewpoint|museum|attraction)$"];nwr${a}["historic"];` +
    `nwr${a}["leisure"~"^(park|garden)$"];nwr${a}["man_made"~"^(lighthouse|pier)$"];` +
    `nwr${a}["amenity"~"^(library|fountain|clock|arts_centre|theatre|cinema|community_centre|townhall|marketplace|cafe|ice_cream|post_office)$"];);out center tags 400;` +
    `way${a}["highway"~"${WALK_RE}"]["footway"!~"^(sidewalk|crossing)$"]["access"!~"^(private|no|customers)$"]["tunnel"!="yes"]["indoor"!="yes"];out tags geom 1500;` +
    `(way${h}["highway"~"${ROAD_RE}"];way${h}["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|monorail)$"]["tunnel"!="yes"];` +
    `way${h}["waterway"~"^(river|canal|stream|drain)$"]["tunnel"!~"^(yes|culvert)$"];way${h}["natural"="water"];);out tags geom;`;
}
async function fetchArea(c, r){
  const body = 'data=' + encodeURIComponent(overpassQuery(c, r));
  for (const url of OVERPASS){
    try{
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, {method:'POST', body, headers:{'Content-Type':'application/x-www-form-urlencoded'}, signal:ctl.signal});
      clearTimeout(to);
      if (!res.ok) continue;
      const j = await res.json();
      if (Array.isArray(j.elements)) return parseArea(j.elements, c);
    }catch{}
  }
  return null;
}

/* Local flat projection in meters around the seed center: plenty accurate within a kilometer. */
function projector(c){
  const kx = 111320*Math.cos(rad(c.lat)), ky = 110540;
  return {fwd:(lat, lng) => ({x:(lng - c.lng)*kx, y:(lat - c.lat)*ky}), back:(x, y) => ({lat:c.lat + y/ky, lng:c.lng + x/kx})};
}
const CELL = 50;
function parseArea(elements, c){
  const pr = projector(c), pois = [], walks = [], segs = new Map(), polys = [];
  const addSeg = (a, b, t) => {
    const x0 = Math.floor(Math.min(a.x, b.x)/CELL) - 1, x1 = Math.floor(Math.max(a.x, b.x)/CELL) + 1;
    const y0 = Math.floor(Math.min(a.y, b.y)/CELL) - 1, y1 = Math.floor(Math.max(a.y, b.y)/CELL) + 1;
    const sg = {a, b, t};
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++){ const k = gx + ',' + gy; let l = segs.get(k); if (!l) segs.set(k, l = []); l.push(sg); }
  };
  for (const el of elements){
    const t = el.tags || {};
    if (!el.geometry){ pois.push(el); continue; }
    const pts = el.geometry.filter(g => g && g.lat != null).map(g => pr.fwd(g.lat, g.lon));
    if (pts.length < 2) continue;
    let kind = null;
    if (t.highway && new RegExp(WALK_RE).test(t.highway) && t.footway !== 'sidewalk' && t.footway !== 'crossing') { walks.push({pts, t}); continue; }
    if (t.highway && new RegExp(ROAD_RE).test(t.highway)) kind = 'road';
    else if (t.railway) kind = 'rail';
    else if (t.waterway) kind = 'waterway';
    else if (t.natural === 'water'){ kind = 'water'; const first = pts[0], last = pts[pts.length - 1]; if (Math.hypot(first.x - last.x, first.y - last.y) < 1) polys.push(pts); }
    if (!kind) continue;
    for (let i = 1; i < pts.length; i++) addSeg(pts[i - 1], pts[i], kind);
  }
  return {pr, pois, walks, segs, polys};
}
function segDist(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y, L = dx*dx + dy*dy;
  let k = L ? ((p.x - a.x)*dx + (p.y - a.y)*dy)/L : 0; k = k < 0 ? 0 : k > 1 ? 1 : k;
  return Math.hypot(p.x - a.x - k*dx, p.y - a.y - k*dy);
}
function inPoly(p, poly){
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x)*(p.y - a.y)/(b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// Distance limits in meters from each hazard; a point must clear all of them.
const WALK_CLEAR = {road:15, rail:15, waterway:8, water:5, inWater:true};
const POI_CLEAR = {road:6, rail:10, waterway:0, water:0, inWater:true};
function clearOf(area, p, lim){
  const gx = Math.floor(p.x/CELL), gy = Math.floor(p.y/CELL);
  for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++){
    const l = area.segs.get(ix + ',' + iy); if (!l) continue;
    for (const sg of l){ const m = lim[sg.t]; if (m && segDist(p, sg.a, sg.b) < m) return false; }
  }
  if (lim.inWater) for (const poly of area.polys) if (inPoly(p, poly)) return false;
  return true;
}
function nearestRoad(area, p){
  let best = 60; const gx = Math.floor(p.x/CELL), gy = Math.floor(p.y/CELL);
  for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++){
    const l = area.segs.get(ix + ',' + iy); if (!l) continue;
    for (const sg of l) if (sg.t === 'road') best = Math.min(best, segDist(p, sg.a, sg.b));
  }
  return best;
}

const article = w => /^[aeiou]/i.test(w) ? 'an' : 'a';
function spacedFrom(list, q){ return list.every(o => dist(o, q) > 45); }
function pickPlaces(area, c, want, taken){
  const cands = [];
  for (const el of area.pois){
    const t = el.tags || {}, k = kindOf(t); if (!k) continue;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat, lng = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lng == null) continue;
    const osm = el.type[0] + el.id; if (taken.some(n => n.osm === osm)) continue;
    const xy = area.pr.fwd(lat, lng), byWater = k[0] === 'Pier' || k[0] === 'Lighthouse' || k[0] === 'Viewpoint';
    if (!clearOf(area, xy, byWater ? Object.assign({}, POI_CLEAR, {inWater:false}) : POI_CLEAR)) continue;   // e.g. art in a road median
    const q = {osm, lat, lng, kind:k[0], name:t.name || '', score:k[1] + (t.name ? 3 : 0) + E.rng()*1.5};
    q.d = dist(c, q); cands.push(q);
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const q of cands.filter(q => q.d <= 200)){ if (out.length >= 3) break; if (spacedFrom(taken.concat(out), q)) out.push(q); }
  for (const q of cands){ if (out.length >= want) break; if (!out.includes(q) && spacedFrom(taken.concat(out), q)) out.push(q); }
  return out.map(q => ({id:'o' + q.osm, osm:q.osm, src:'osm', name:q.name || q.kind, kind:q.kind,
    prov:q.name ? `First pulled at ${q.name}` : `First pulled at ${article(q.kind)} ${q.kind.toLowerCase()}`, lat:q.lat, lng:q.lng, coolUntil:0}));
}
const WALK_KIND = {footway:['Footpath', 1], path:['Trail', 1], pedestrian:['Plaza', 2], cycleway:['Bike path', 0], bridleway:['Bridleway', 0], track:['Track', -1]};
function pickWalkSpots(area, c, count, needNear, taken, r){
  if (count <= 0 && needNear <= 0) return [];
  const cands = [];
  area.walks.forEach((w, wi) => {
    const [kind, base] = WALK_KIND[w.t.highway] || ['Footpath', 0];
    let carry = 15;                                                   // first sample 15 m in, then every 30 m
    for (let i = 1; i < w.pts.length; i++){
      const a = w.pts[i - 1], b = w.pts[i], L = Math.hypot(b.x - a.x, b.y - a.y);
      let s = carry;
      for (; s < L; s += 30){
        const p = {x:a.x + (b.x - a.x)*s/L, y:a.y + (b.y - a.y)*s/L};
        if (Math.hypot(p.x, p.y) > r || !clearOf(area, p, WALK_CLEAR)) continue;
        const ll = area.pr.back(p.x, p.y);
        cands.push({lat:ll.lat, lng:ll.lng, d:Math.hypot(p.x, p.y), kind, wname:w.t.name || '', wi,
          score:base + (w.t.name ? 2 : 0) + Math.min(2, nearestRoad(area, p)/30) + E.rng()*2});
      }
      carry = s - L;
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const out = [], all = () => taken.concat(out), perWay = new Map(), total = Math.max(count, needNear);
  const take = (q, cap) => { const n = perWay.get(q.wi) || 0; if (n >= cap || out.includes(q) || !spacedFrom(all(), q)) return; out.push(q); perWay.set(q.wi, n + 1); };
  for (const q of cands.filter(q => q.d <= 200)){ if (out.length >= needNear) break; take(q, 3); }
  for (const q of cands){ if (out.length >= total) break; take(q, 3); }          // at most three per path...
  for (const q of cands){ if (out.length >= total) break; take(q, Infinity); }   // ...unless nothing else fits
  const used = new Set(taken.map(n => n.name)), names = NODE_NAMES.filter(n => !used.has(n)).sort(() => E.rng() - .5);
  return out.map((q, i) => {
    const name = q.wname || names[i % Math.max(1, names.length)] || 'Scratch Spot';
    return {id:'w' + Date.now().toString(36) + i, src:'walk', name, kind:q.kind, prov:q.wname ? `First pulled on ${q.wname}` : `First pulled at ${name}`, lat:q.lat, lng:q.lng, coolUntil:0};
  });
}
function randomNodes(c, count, taken){
  const used = new Set(taken.map(n => n.name)), names = NODE_NAMES.filter(n => !used.has(n)).sort(() => E.rng() - .5), out = [];
  for (let i = 0; i < count; i++){
    let p = null;
    for (let tries = 0; tries < 12; tries++){
      const near = taken.concat(out).filter(o => dist(o, c) <= 200).length < 3;
      const q = offset(c, near ? 50 + E.rng()*120 : 150 + E.rng()*450, E.rng()*Math.PI*2);
      if (taken.concat(out).every(o => dist(o, q) > 45)){ p = q; break; }
    }
    if (!p) p = offset(c, 150 + E.rng()*450, E.rng()*Math.PI*2);
    const name = names[i % Math.max(1, names.length)] || 'Scratch Spot';
    out.push({id:'r' + Date.now().toString(36) + i, src:'random', name, kind:'Scratch spot', prov:`First pulled at ${name}`, lat:p.lat, lng:p.lng, coolUntil:0});
  }
  return out;
}
let seeding = false, lastSeedTry = 0, noteTimer = null;
function mapNote(text, ms){
  const el = $('mapNote'); clearTimeout(noteTimer);
  if (!text){ el.hidden = true; return; }
  el.textContent = text; el.hidden = false;
  if (ms) noteTimer = setTimeout(() => { el.hidden = true; }, ms);
}
async function seedArea(c, fresh){
  if (seeding) return;
  seeding = true; lastSeedTry = Date.now();
  if (fresh){ nodes = []; seedCenters = []; markers.forEach(m => m.remove()); markers.clear(); }
  const want = fresh ? 15 : 10, R = 650;
  let added = [], area = null;
  if (P.nodeSource !== 'random'){
    mapNote('Finding places near you…');
    area = await fetchArea(c, R);
    mapNote(null);
    if (area){
      const places = P.nodeSource === 'osm' ? pickPlaces(area, c, want, nodes) : [];
      const near = nodes.concat(places).filter(n => dist(c, n) <= 200).length;
      const walk = pickWalkSpots(area, c, want - places.length, Math.max(0, 3 - near), nodes.concat(places), R);
      added = places.concat(walk);
      event('places_fetched', {ok:true, pois:area.pois.length, walkways:area.walks.length, places:places.length, walkSpots:walk.length});
    } else event('places_fetched', {ok:false});
  }
  if (added.length < 3){
    added = added.concat(randomNodes(c, (fresh ? 8 : 5) - added.length, nodes.concat(added)));
    if (P.nodeSource !== 'random') mapNote(area ? 'Few walkable places are mapped here, so some nodes are placed at random.' : 'Couldn’t reach map data, so nodes are placed at random for now.', 6000);
  }
  // Dice caches: a few extra spots per area, placed by the same rules, that give a die instead of a card.
  const dieWant = fresh ? 3 : 2;
  let dieSpots = area ? pickWalkSpots(area, c, dieWant, 0, nodes.concat(added), R) : [];
  if (dieSpots.length < dieWant) dieSpots = dieSpots.concat(randomNodes(c, dieWant - dieSpots.length, nodes.concat(added, dieSpots)));
  dieSpots.forEach(d => { d.type = 'die'; d.id = 'd' + d.id; d.kind = 'Dice cache'; });
  added = added.concat(dieSpots);
  nodes = nodes.concat(added); seedCenters.push({lat:c.lat, lng:c.lng});
  if (nodes.length > 150) nodes = nodes.slice(-150);
  store.set('nodes', nodes); store.set('nodesV', NODES_V); store.set('seedCenters', seedCenters);
  event('nodes_seeded', {count:added.length, osm:added.filter(n => n.src === 'osm').length, walk:added.filter(n => n.src === 'walk').length, dice:dieSpots.length, fresh});
  seeding = false;
  refreshNodes();
}

const markers = new Map();
const wasInRange = new Set();
function nodeInfo(n){
  const now = Date.now();
  if (n.coolUntil > now) return {st:'cooling', d:me ? dist(me, n) : Infinity, left:n.coolUntil - now};
  if (!me) return {st:'hidden', d:Infinity};
  const d = dist(me, n);
  if (d > P.vis) return {st:'hidden', d};
  if (d <= P.reach && meAcc <= P.acc) return {st:'inrange', d};
  return {st:'visible', d};
}
function refreshNodes(){
  if (!nodes) return;
  for (const n of nodes){
    const info = nodeInfo(n);
    let m = markers.get(n.id);
    const show = info.st !== 'hidden' && (info.st !== 'cooling' || info.d <= P.vis);
    if (!show){ if (m){ m.remove(); markers.delete(n.id); } continue; }
    const label = info.st === 'cooling' ? fmtLeft(info.left) : info.st === 'inrange' ? 'In reach' : fmtDist(info.d);
    const look = markerLook(n, info);
    const key = info.st + '|' + label + '|' + look.key;
    if (!m){
      m = L.marker([n.lat, n.lng], {keyboard:true, title:n.name});
      m.on('click', () => openSheet(n));
      m.addTo(map); markers.set(n.id, m);
    }
    if (m._key !== key){
      m._key = key;
      m.setIcon(L.divIcon({className:'', iconSize:[34, 44], iconAnchor:[17, 40],
        html:`<div class="node ${info.st} ${look.cls}">${look.html}<div class="t">${label}</div></div>`}));
      m.setZIndexOffset(look.z);
    }
    if (info.st === 'inrange' && !wasInRange.has(n.id)){ wasInRange.add(n.id); event('node_in_range', {node:n.id, type:n.type || 'card', d:Math.round(info.d), acc:Math.round(meAcc)}); }
    if (info.st !== 'inrange') wasInRange.delete(n.id);
  }
  if (sheetNode) updateSheet();
}

/* Three rings for card spots: far shows the card, the middle ring shows its bingo ball (highlighted when the number
   is open somewhere on your board), and the near ring adds a stronger highlight when that exact square is open. */
function markerLook(n, info){
  if (n.type === 'die') return {key:'die', cls:'dienode', z:0, html:'<div class="dieico" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>'};
  if (info.st === 'cooling' || info.d > P.ringMid) return {key:'far', cls:'', z:0, html:'<div class="tok">HL</div>'};
  const b = ballFor(n), exact = openCell(b) >= 0, num = numberOpen(b), near = info.d <= P.ringNear;
  const m = near && exact ? 'p2' : num ? 'p1' : 'dim';
  return {key:m + b.l + b.n, cls:'ballnode ' + m, z:m === 'p2' ? 500 : m === 'p1' ? 200 : 0,
    html:`<div class="ball" style="--bc:${E.BALL_COL[b.l]}"><div class="face"><i>${b.l}</i><span>${b.n}</span></div>${m === 'p2' ? '<b class="star">★</b>' : ''}</div>`};
}

/* Node sheet */
let sheetNode = null;
function openSheet(n){ sheetNode = n; $('diceSheet').hidden = true; $('nodeSheet').hidden = false; updateSheet(); event('node_tap', {node:n.id}); }
function closeSheet(){ sheetNode = null; $('nodeSheet').hidden = true; }
function updateSheet(){
  const n = sheetNode, info = nodeInfo(n), btn = $('nsScratch');
  $('nsName').textContent = n.name;
  if (n.type === 'die'){
    let sub = 'Dice cache · ';
    if (info.st === 'cooling') sub += `Restocking. Ready in ${fmtLeft(info.left)}.`;
    else if (info.st === 'inrange') sub += 'You’re here. Pick up a die.';
    else if (me && dist(me, n) <= P.reach && meAcc > P.acc) sub += `You’re close, but GPS is rough right now (±${Math.round(meAcc)} m).`;
    else sub += `${fmtDist(info.d)} away. Walk within ${P.reach} m to pick up a die.`;
    $('nsDist').textContent = sub; btn.disabled = info.st !== 'inrange'; btn.textContent = 'Pick up die';
    return;
  }
  let sub = (n.kind && n.kind !== n.name ? n.kind + ' · ' : '');
  if (info.st === 'cooling') sub += `Recharging. Ready in ${fmtLeft(info.left)}.`;
  else if (info.st === 'inrange') sub += 'You’re here. Scratch to pull a card.';
  else if (me && dist(me, n) <= P.reach && meAcc > P.acc) sub += `You’re close, but GPS is rough right now (±${Math.round(meAcc)} m). Step into the open or wait a moment.`;
  else sub += `${fmtDist(info.d)} away. Walk within ${P.reach} m to scratch.`;
  $('nsDist').textContent = sub;
  btn.disabled = info.st !== 'inrange';
  const started = pending['node:' + n.id] && pending['node:' + n.id].progress;
  btn.textContent = started ? 'Finish scratching' : 'Scratch';
  if (started && info.st !== 'cooling') $('nsDist').textContent = 'You started a card here. ' + sub;
  if (info.st !== 'cooling' && info.d <= P.ringMid){
    const b = ballFor(n), exact = openCell(b) >= 0, num = numberOpen(b);
    $('nsDist').textContent += exact ? ` Its bingo ball, ${b.l}·${b.n}, is open on your board.` : num ? ` Its bingo ball is ${b.l}·${b.n}; ${b.n} is open in another column.` : ` Its bingo ball is ${b.l}·${b.n}.`;
  }
}
$('nsClose').addEventListener('click', closeSheet);
$('nsScratch').addEventListener('click', () => {
  const n = sheetNode; if (!n || nodeInfo(n).st !== 'inrange') return;
  if (n.type === 'die') return pickupDie(n);
  const m = markers.get(n.id), tok = m && m.getElement() ? m.getElement().querySelector('.tok, .ball') : null;
  closeSheet();
  const key = 'node:' + n.id, card = pendingCard(key, ballFor(n));
  openScratch(card, {source:'node', node:n.id, label:n.name, provenance:n.prov || `First pulled at ${n.name}`, ball:pending[key].ball, die:pending[key].die ? pending[key].die.rank : null}, tok, pending[key].progress);
  event('node_scratch', {node:n.id, src:n.src, kind:n.kind});
});

/* ================= Cards ================= */
function drawCard(){
  const forced = E.settings.card;
  if (forced && forced !== 'random'){ const c = E.CARDS.find(c => c.id === forced); if (c) return c; }
  let r = E.rng()*100, rank = 1;
  for (let i = 0; i < RANK_WEIGHTS.length; i++){ if (r < RANK_WEIGHTS[i]){ rank = i + 1; break; } r -= RANK_WEIGHTS[i]; }
  const pool = E.CARDS.filter(c => c.rank === rank);
  return pool[Math.floor(E.rng()*pool.length)];
}

/* ================= Scratch flow ================= */
/* A node's or the daily card's identity is fixed the first time it's opened, and any scratch progress is saved
   when the player leaves, so backing out never re-rolls the card and coming back resumes the same scratch. */
let pending = store.get('pending', {});
const pendKey = ctx => ctx.source === 'node' ? 'node:' + ctx.node : ctx.source === 'daily' ? 'daily' : ctx.source === 'sealed' ? 'sealed:' + ctx.instId : null;
function pendingCard(key, ball){
  const p = pending[key], c = p && E.CARDS.find(c => c.id === p.cardId);
  if (c){ if (!p.ball){ p.ball = ball || rollBall(); store.set('pending', pending); } return c; }
  const card = drawCard();
  pending[key] = {cardId:card.id, at:Date.now(), ball:ball || rollBall()}; store.set('pending', pending);
  return card;
}
function snapshotProgress(){
  const st = E.state, m = st.mask; if (!m) return null;
  // Saved at half resolution (a quarter of the size); restoreProgress scales it back up.
  const w = Math.ceil(st.mw/2), h = Math.ceil(st.mh/2), b = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let sum = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++){ const yy = y*2 + dy, xx = x*2 + dx; if (yy < st.mh && xx < st.mw){ sum += m[yy*st.mw + xx]; n++; } }
    b[y*w + x] = Math.round(sum/n*255);
  }
  let bin = ''; for (let i = 0; i < b.length; i += 4096) bin += String.fromCharCode.apply(null, b.subarray(i, i + 4096));
  return {mw:w, mh:h, mask:btoa(bin), strokes:st.strokes, pathLen:st.pathLen, drawMs:st.drawMs,
    elapsed:st.firstT ? Math.max(0, Math.round((st.lastMoveT || performance.now()) - st.firstT)) : 0};
}
function restoreProgress(pr){
  const st = E.state; if (!pr || !st.mask) return;
  const bin = atob(pr.mask), m = st.mask;
  for (let y = 0; y < st.mh; y++) for (let x = 0; x < st.mw; x++){
    const sx = Math.min(pr.mw - 1, Math.floor(x*pr.mw/st.mw)), sy = Math.min(pr.mh - 1, Math.floor(y*pr.mh/st.mh));
    m[y*st.mw + x] = bin.charCodeAt(sy*pr.mw + sx)/255;
  }
  st.strokes = pr.strokes || 0; st.pathLen = pr.pathLen || 0; st.drawMs = pr.drawMs || 0;
  st.firstT = performance.now() - (pr.elapsed || 0);
  st.lastMoveT = performance.now();   // the engine's last-move time belongs to the earlier visit; restart it here
  st.maskDirty = true; st.dirty = true;
  $('hint').textContent = 'Picking up where you left off.';
}
// Save an unfinished scratch: on Back, and whenever the page is hidden or closed (the phone may discard it).
function saveProgress(){
  const key = current && pendKey(current);
  if (!key || !pending[key] || E.revealed) return;
  if (E.started){ const pr = snapshotProgress(); if (pr) pending[key].progress = pr; }
  store.set('pending', pending);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && current) saveProgress(); });
window.addEventListener('pagehide', () => { if (current) saveProgress(); });
let current = null;
function openScratch(card, ctx, fromEl, progress){
  current = ctx;
  const motionOk = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fromRect = fromEl && motionOk ? fromEl.getBoundingClientRect() : null;
  showView('vScratch'); app.classList.add('scratching');
  $('scratchWhere').textContent = ctx.label;
  $('scratchDone').hidden = true; $('scratchBack').hidden = false;
  $('scratchKeep').hidden = !(ctx.source === 'node' || ctx.source === 'daily') || !!progress;
  $('vScratch').scrollTop = 0; $('vScratch').scrollLeft = 0;
  heldNotes = [];
  E.newCard(card, ctx);
  updateDieBtn();
  if (progress) restoreProgress(progress);
  event('scratch_open', {source:ctx.source, node:ctx.node || null, card:card.id, rank:card.rank, resumed:!!progress});
  if (fromRect && fromRect.width) flyIn(fromRect, ctx.source === 'node');
}

/* The tapped token lifts off the map, spins and grows into the card, then the real card fades in beneath it. */
function flyIn(from, gold){
  const view = $('vScratch'), cardEl = $('stage').querySelector('.card');
  if (!cardEl) return;
  // Keep the map on screen under the flight: the scratch view floats above it, invisible, until the card lands.
  const mapView = $('vMap');
  mapView.hidden = false; app.classList.add('flying');
  const to = cardEl.getBoundingClientRect();
  if (!to.width){ mapView.hidden = true; app.classList.remove('flying'); return; }
  view.style.opacity = '0'; view.style.pointerEvents = 'none';
  const dim = mapView.animate([{filter:'brightness(1)'}, {filter:'brightness(.35)'}], {duration:760, easing:'ease-in', fill:'forwards'});
  const fly = document.createElement('div');
  fly.className = 'flyer' + (gold ? ' gold' : '');
  fly.innerHTML = '<div class="fly-face"><span>HL</span></div>';
  Object.assign(fly.style, {left:to.left + 'px', top:to.top + 'px', width:to.width + 'px', height:to.height + 'px', fontSize:(to.width*.26) + 'px'});
  document.body.appendChild(fly);
  const s = Math.min(from.width/to.width, from.height/to.height);
  const dx = from.left + from.width/2 - (to.left + to.width/2), dy = from.top + from.height/2 - (to.top + to.height/2);
  const P = 'perspective(1100px) ';
  const anim = fly.animate([
    {transform:`${P}translate(${dx}px, ${dy}px) scale(${s}) rotateY(0deg)`},
    {transform:`${P}translate(${dx*.45}px, ${dy*.45 - 40}px) scale(${(s + 1)/2.4}) rotateY(560deg)`, offset:.5},
    {transform:`${P}translate(0px, 0px) scale(1) rotateY(1080deg)`}
  ], {duration:760, easing:'cubic-bezier(.33,.05,.2,1)', fill:'forwards'});
  const done = () => {
    const v = view.animate([{opacity:0}, {opacity:1}], {duration:180, fill:'forwards'});
    const f = fly.animate([{opacity:1}, {opacity:0}], {duration:220, fill:'forwards'});
    v.finished.then(() => {
      view.style.opacity = ''; view.style.pointerEvents = ''; v.cancel();
      if (app.classList.contains('scratching')) mapView.hidden = true;
      app.classList.remove('flying'); dim.cancel();
    }, () => {});
    f.finished.then(() => fly.remove(), () => fly.remove());
    try{ E.Sound.land(1); }catch{}
    try{ navigator.vibrate && navigator.vibrate(14); }catch{}
  };
  anim.finished.then(done, done);
}
function closeScratch(){
  const back = current && current.returnTo || 'vMap';
  // A die committed to a test card (which has no saved state) goes back to the player if the card was never revealed.
  if (current && !pendKey(current) && current.dieCommit && !E.revealed) releaseDie(current.dieCommit);
  closeDiePick();
  app.classList.remove('scratching'); current = null;
  showView(back);
  setTimeout(maybeShowInstallTip, 600);
}
$('scratchBack').addEventListener('click', () => {
  if (E.revealed || E.sequenceRunning) return closeScratch();
  saveProgress();
  event('scratch_leave', {source:current && current.source, started:E.started, coverage:+(E.state.cells ? Array.from(E.state.cells).reduce((a, b) => a + b, 0)/64 : 0).toFixed(3)});
  closeScratch();
});
$('scratchDone').addEventListener('click', closeScratch);

function encodeMask(){
  const st = E.state, m = st.mask, mw = st.mw, mh = st.mh;
  if (!m) return null;
  const w = 128, h = Math.max(4, Math.round(128*mh/mw)), out = new Uint8Array(w*h);
  for (let y = 0; y < h; y++){
    const ya = Math.floor(y*mh/h), yb = Math.max(ya + 1, Math.floor((y + 1)*mh/h));
    for (let x = 0; x < w; x++){
      const xa = Math.floor(x*mw/w), xb = Math.max(xa + 1, Math.floor((x + 1)*mw/w));
      let s = 0; for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) s += m[yy*mw + xx];
      out[y*w + x] = Math.round(s/((yb - ya)*(xb - xa))*255);
    }
  }
  let bin = ''; for (let i = 0; i < out.length; i += 4096) bin += String.fromCharCode.apply(null, out.subarray(i, i + 4096));
  return {w, h, b64:btoa(bin)};
}

/* ---------- Keep sealed ---------- */
// Before the first stroke, a pulled card can be kept unscratched: the set slot fills now, and the payload is
// rolled only when someone finally scratches it. Any scratching breaks the seal.
$('scratchKeep').addEventListener('click', () => {
  if (!current || E.started || E.revealed || !(current.source === 'node' || current.source === 'daily')) return;
  const ctx = current, card = E.state.card;
  const firstCopy = !realCards().some(c => c.cardId === card.id);
  const pk = pendKey(ctx), pend = pk && pending[pk];
  const inst = {id:'c' + Date.now().toString(36) + Math.floor(E.rng()*1e4).toString(36), cardId:card.id, at:new Date().toISOString(),
    source:ctx.source, node:ctx.node || null, provenance:ctx.provenance || '', sealed:true, ball:ctx.ball || (pend && pend.ball) || rollBall()};
  if (pend && pend.die) inst.dieCommit = pend.die;            // a committed die stays with the card until it's scratched
  collection.push(inst); store.set('collection', collection);
  if (ctx.source === 'node' && nodes){ const n = nodes.find(n => n.id === ctx.node); if (n){ n.coolUntil = Date.now() + P.cool*3600e3; delete n.ball; store.set('nodes', nodes); } }
  if (ctx.source === 'daily'){ daily.last = Date.now(); store.set('daily', daily); }
  if (pend){ delete pending[pk]; store.set('pending', pending); }
  const notes = daub(inst);
  event('card_kept_sealed', {instId:inst.id, source:ctx.source, node:ctx.node || null, card:card.id, rank:card.rank, newSlot:firstCopy, ball:inst.ball.l + inst.ball.n, daubed:!!inst.bingo, dieRank:inst.dieCommit ? inst.dieCommit.rank : undefined});
  current.dieCommit = null;
  closeScratch(); updateChips();
  toast([`Kept ${card.name} sealed. It's waiting in Collection, under My cards.`].concat(notes));
});
// The seal breaks with the first stroke: hide Keep sealed, and remember it so the card shows as Started.
$('stage').addEventListener('pointerdown', () => setTimeout(() => {
  if (!current || !E.started) return;
  $('scratchKeep').hidden = true; updateDieBtn(); closeDiePick();
  if (current.source === 'sealed'){ const inst = collection.find(c => c.id === current.instId); if (inst && !inst.started){ inst.started = true; store.set('collection', collection); } }
}, 60));
function openSealed(inst, fromEl){
  const card = E.CARDS.find(c => c.id === inst.cardId); if (!card) return;
  const key = 'sealed:' + inst.id;
  if (!pending[key]){ pending[key] = {cardId:card.id, at:Date.now(), ball:inst.ball, die:inst.dieCommit || null}; store.set('pending', pending); }
  event('sealed_open', {card:card.id, rank:card.rank, keptFrom:inst.source});
  openScratch(card, {source:'sealed', instId:inst.id, label:card.name, provenance:inst.provenance, returnTo:'vCollection', ball:inst.ball,
    die:pending[key].die ? pending[key].die.rank : null}, fromEl, pending[key].progress);
}

window.Pilot = {
  event,
  onReveal({row, payload:p, card, ctx, pristine}){
    if (ctx.source === 'sealed'){
      const inst = collection.find(c => c.id === ctx.instId);
      if (inst){
        Object.assign(inst, {sealed:false, started:false, scratchedAt:new Date().toISOString(), grade:p.grade, sigmaW:row.sigmaW, isHolo:p.isHolo,
          printNumber:p.printNumber, cf:p.chanceFactors, broke:p.broke, token:p.microGameToken, mask:pristine ? null : encodeMask(),
          die:p.die ? {rank:p.die.rank, total:p.die.total} : null, race:p.race ? {winner:p.race.winner, photo:p.race.photo} : undefined});
        delete inst.dieCommit;
        if (!store.set('collection', collection)){ inst.mask = null; store.set('collection', collection); }
      }
      const pk = pendKey(ctx); if (pending[pk]){ delete pending[pk]; store.set('pending', pending); }
      event('scratch_reveal', {source:'sealed', instId:ctx.instId, keptFrom:inst ? inst.source : '', node:inst ? inst.node : null, card:card.id, rank:card.rank, grade:p.grade,
        computedGrade:row.computedGrade, sigmaW:row.sigmaW, holo:p.isHolo, print:p.printNumber, broke:row.broke, token:p.microGameToken,
        durationMs:row.durationMs, strokes:row.strokes, speedPxS:row.speedPxS, coverage:row.coverage, fx:row.fx, newSlot:false,
        heldMs:inst ? Date.now() - new Date(inst.at).getTime() : undefined, ball:inst && inst.ball ? inst.ball.l + inst.ball.n : '', daubed:false,
        dieRank:p.die ? p.die.rank : undefined, dieRoll:p.die ? p.die.total : undefined,
        raceWinner:p.race ? p.race.winner : undefined, racePhoto:p.race ? p.race.photo : undefined});
      if (current) current.dieCommit = null;
      updateChips();
      return;
    }
    const inst = {
      id:'c' + Date.now().toString(36) + Math.floor(E.rng()*1e4).toString(36), cardId:card.id, at:new Date().toISOString(),
      source:ctx.source || 'debug', node:ctx.node || null, provenance:ctx.provenance || '',
      grade:p.grade, sigmaW:row.sigmaW, isHolo:p.isHolo, printNumber:p.printNumber, cf:p.chanceFactors, broke:p.broke, token:p.microGameToken,
      mask:pristine ? null : encodeMask(), ball:ctx.ball || null, die:p.die ? {rank:p.die.rank, total:p.die.total} : null,
      race:p.race ? {winner:p.race.winner, photo:p.race.photo} : undefined
    };
    collection.push(inst);
    heldNotes = heldNotes.concat(daub(inst));                 // shown once the reveal finishes, so nothing is spoiled
    if (current) current.dieCommit = null;
    if (!store.set('collection', collection)){ inst.mask = null; store.set('collection', collection); }
    if (ctx.source === 'node' && nodes){ const n = nodes.find(n => n.id === ctx.node); if (n){ n.coolUntil = Date.now() + P.cool*3600e3; delete n.ball; store.set('nodes', nodes); } }
    if (ctx.source === 'daily'){ daily.last = Date.now(); store.set('daily', daily); }
    const pk = pendKey(ctx); if (pk && pending[pk]){ delete pending[pk]; store.set('pending', pending); }
    const place = ctx.source === 'node' && nodes ? nodes.find(n => n.id === ctx.node) : null;
    const lowPrint = !!(card.run && p.printNumber > 0 && p.printNumber <= Math.max(3, Math.ceil(card.run.size*.02)));
    event('scratch_reveal', {source:inst.source, node:inst.node, placeSrc:place ? place.src : '', placeKind:place ? place.kind : '', lowPrint, card:card.id, rank:card.rank, grade:p.grade, computedGrade:row.computedGrade,
      sigmaW:row.sigmaW, holo:p.isHolo, print:p.printNumber, broke:row.broke, token:p.microGameToken, durationMs:row.durationMs,
      strokes:row.strokes, speedPxS:row.speedPxS, coverage:row.coverage, fx:row.fx, newSlot:inst.source !== 'debug' && realCards().filter(c => c.cardId === card.id).length === 1,
      ball:inst.ball ? inst.ball.l + inst.ball.n : '', daubed:!!inst.bingo, dieRank:p.die ? p.die.rank : undefined, dieRoll:p.die ? p.die.total : undefined,
      raceWinner:p.race ? p.race.winner : undefined, racePhoto:p.race ? p.race.photo : undefined});
    updateChips();
  },
  onFinish(){ $('scratchDone').hidden = false; $('scratchBack').hidden = true; $('scratchDie').hidden = true; installTipEarned = true; askPersist();
    if (heldNotes.length){ const n = heldNotes; heldNotes = []; setTimeout(() => toast(n), 500); } }
};

/* ================= Daily card ================= */
const DAY = 24*3600e3;
const dailyReady = () => Date.now() - daily.last >= DAY;
$('dailyBtn').addEventListener('click', () => {
  if (!dailyReady()) return;
  event('daily_open');
  const card = pendingCard('daily');
  openScratch(card, {source:'daily', label:'Daily card', provenance:'Daily card', ball:pending.daily.ball, die:pending.daily.die ? pending.daily.die.rank : null}, $('dailyBtn'), pending.daily.progress);
});
function updateChips(){
  const d = $('dailyBtn');
  if (dailyReady()){ d.textContent = pending.daily && pending.daily.progress ? 'Finish daily card' : 'Daily card ready'; d.classList.add('ready'); }
  else { d.textContent = `Next daily in ${fmtLeft(daily.last + DAY - Date.now())}`; d.classList.remove('ready'); }
  const owned = new Set(realCards().map(c => c.cardId)).size;
  $('setChip').textContent = `Harbor Lights ${owned}/${E.CARDS.length}`;
  updateDiceChip();
  const nSealed = realCards().filter(c => c.sealed).length, tab = document.querySelector('.tabs button[data-view="vCollection"]');
  // Only touch the tab when the count changes: rebuilding it every second could swallow a tap in progress.
  if (tab && tab.dataset.sealed !== String(nSealed)){ tab.dataset.sealed = String(nSealed); tab.innerHTML = 'Collection' + (nSealed ? `<span class="tab-badge" aria-label="${nSealed} sealed">${nSealed}</span>` : ''); }
}
$('setChip').addEventListener('click', () => showView('vCollection'));

/* ================= Static cards (collection and inspect) ================= */
const GRADE_ORDER = {Pristine:0, Good:1, Fair:2, Poor:3};
const isTest = c => c.source === 'debug';
const realCards = () => collection.filter(c => !isTest(c));
function cardMarkup(card, inst, idx){
  const esc = E.esc;
  const ed = card.run ? `Launch Ed. · Run ${card.run.label} of ${card.run.size}` : 'Launch Ed. · Evergreen';
  const sealed = !!(inst && inst.sealed);
  const shown = inst && !sealed ? inst : null;   // a sealed card has no payload yet
  const v = shown ? {holo:inst.isHolo ? 'Holo' : 'Normal', print:inst.printNumber > 0 ? `${inst.printNumber}/${card.run.size}` : 'Evergr.', grade:inst.grade, token:inst.token}
                 : {holo:'?', print:'?', grade:'?', token:'?'};
  const cf = E.STATS.map(k => {
    let track = '', val = '?', broke = false;
    if (shown){
      const g = E.cfGeom(card, k), x = inst.cf[k]; broke = !!(inst.broke && inst.broke[k]);
      track = `<div class="band" style="left:${g.pct(g.lo)}%; width:${g.pct(g.hi) - g.pct(g.lo)}%"></div><div class="mark${broke ? ' broke' : ''}" style="left:${g.pct(x)}%"></div>`;
      val = x.toFixed(1);
    }
    return `<div class="cfrow"><span class="lbl">${E.STAT_LABEL[k]}</span><div class="track">${track}</div><span class="cfv${broke ? ' broke' : ''}">${val}</span></div>`;
  }).join('');
  const prov = inst ? esc(inst.provenance || 'Harbor Lights') : 'Harbor Lights';
  const date = inst ? new Date(inst.at).toLocaleDateString('en-US') : `No. ${card.no}`;
  const resid = shown && inst.mask ? `<canvas class="resid" data-i="${idx}"></canvas>` : '';
  return `<div class="card${shown && inst.isHolo ? ' holo' : ''}${inst && isTest(inst) ? ' test' : ''}">
    <div class="topline${inst && inst.ball ? ' has-ball' : ''}"><span class="sig">${inst && inst.ball ? E.ballToken(inst.ball) : `<b>${card.sig[0]}·${card.sig[1]}</b>`}<b>${card.ttt}</b></span><span class="settag">Harbor Lights</span></div>
    <div class="banner"><span class="name">${esc(card.name)}</span><span class="ed">${ed}</span></div>
    <div class="art">${E.artSVG(card)}</div>
    ${E.pipRow(card.rank, shown ? `<span class="grade-badge shown g-${inst.grade}">${inst.grade}</span>` : '')}
    <div class="desc${shown ? '' : ' unknown'}${sealed ? ' sealed' + (inst.started ? ' started' : '') : ''}${resid ? ' has-resid' : ''}">
      <div class="desc-grid">
        <div class="slot"><span class="lbl">Finish</span><span class="val">${v.holo}</span></div>
        <div class="slot"><span class="lbl">Print</span><span class="val">${v.print}</span></div>
        <div class="slot"><span class="lbl">Token</span><span class="val">${v.token}</span></div>
      </div>
      ${shown && inst.race ? E.soloHTML(card, inst.race.winner, inst.cf[inst.race.winner]) : `<div class="cf">${cf}</div>`}
      ${shown && inst.die ? `<div class="die-chip landed r${inst.die.rank}">${E.dieChipHTML(inst.die, inst.die.total)}</div>` : ''}
      ${resid}
    </div>
    <div class="provenance"><span>${prov}</span><span>${date}</span></div>
    <div class="foil"></div>
  </div>`;
}
function paintResidue(cv, mask){
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.max(1, Math.round(r.width*dpr)), H = Math.max(1, Math.round(r.height*dpr));
  const coat = document.createElement('canvas'); coat.width = W; coat.height = H;
  const c = coat.getContext('2d'); E.paintSurface(c, W, H);
  const mc = document.createElement('canvas'); mc.width = mask.w; mc.height = mask.h;
  const mctx = mc.getContext('2d'), img = mctx.createImageData(mask.w, mask.h), bin = atob(mask.b64);
  for (let i = 0; i < bin.length; i++) img.data[i*4 + 3] = bin.charCodeAt(i);
  mctx.putImageData(img, 0, 0);
  c.globalCompositeOperation = 'destination-out'; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(mc, 0, 0, W, H);
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.shadowColor = 'rgba(20,24,30,.45)'; ctx.shadowBlur = 2*dpr; ctx.shadowOffsetY = 1.2*dpr;
  ctx.drawImage(coat, 0, 0);
}

/* ================= Collection view ================= */
let colMode = 'cat', shown = [];
function bestCopy(list){
  return list.slice().sort((a, b) => ((a.sealed ? 1 : 0) - (b.sealed ? 1 : 0)) || (GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]) || (b.isHolo - a.isHolo) || ((a.printNumber > 0 ? a.printNumber : 1e9) - (b.printNumber > 0 ? b.printNumber : 1e9)))[0];
}
function tileCap(card, inst, right){
  return `<div class="tile-cap"><b>${E.esc(card.name)}</b><span class="tags">${right}</span></div>`;
}
const holoTag = inst => inst.isHolo ? '<span class="holo-tag">Holo</span>' : '';
/* ---------- Versions (Chance Factor race) ----------
   With the race on, each copy keeps one Chance Factor, so each card comes in four versions: Prob, Luck, Entr, Var.
   The Set still counts 12 designs; versions are a second layer shown as chips under each card. */
const versionsOn = () => !!E.settings.fxRace;
const raceCopies = cardId => realCards().filter(c => c.cardId === cardId && c.race && !c.sealed);
const isGoldCopy = (c, card) => c.cf[c.race.winner] > card.cf.probability[1];
function versionState(card){
  const st = {}; E.STATS.forEach(k => { const cs = raceCopies(card.id).filter(c => c.race.winner === k); st[k] = !cs.length ? '' : cs.some(c => isGoldCopy(c, card)) ? 'gold' : 'own'; });
  return st;
}
function bestOfVersion(card, k){
  return raceCopies(card.id).filter(c => c.race.winner === k).sort((a, b) => (isGoldCopy(b, card) - isGoldCopy(a, card)) || (GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]) || (b.cf[k] - a.cf[k]))[0];
}
const versionChips = (card, cls) => { const st = versionState(card); return `<div class="vchips${cls ? ' ' + cls : ''}">${E.STATS.map(k => `<span class="${st[k] ? 'own ' + st[k] : ''}" data-v="${k}">${E.STAT_LABEL[k]}</span>`).join('')}</div>`; };
function renderCollection(){
  const grid = $('colGrid'), cards = E.CARDS.slice().sort((a, b) => a.no - b.no);
  grid.classList.toggle('bingo-mode', colMode === 'bingo' || colMode === 'dice'); $('setFilterRow').hidden = colMode === 'bingo' || colMode === 'dice';
  $('segBingo').textContent = `Bingo ${board.cells.filter(c => c.by).length - 1}/24`;
  const real = realCards(), tests = collection.filter(isTest);
  const owned = new Set(real.map(c => c.cardId)).size;
  $('segCat').textContent = `Set ${owned}/${cards.length}`;
  $('segAll').textContent = `Cards ${real.length}`;
  shown = [];
  let html = '';
  const tile = (card, inst, right, label, extra) => { const i = shown.push(inst) - 1;
    return `<button class="tile" type="button" data-i="${i}" aria-label="${E.esc(label)}">${cardMarkup(card, inst, i)}${tileCap(card, inst, right)}${extra || ''}</button>`; };
  if (colMode === 'dice'){
    $('segCat').textContent = `Set ${owned}/${cards.length}`; $('segAll').textContent = `Cards ${real.length}`;
    grid.innerHTML = diceMarkup(); updateDiceChip();
    event('view', {view:'dice', dice:dice.length, basicReady:basic.ready});
    $('testerCode').textContent = P.tester || testerId;
    return;
  }
  if (colMode === 'bingo'){
    $('segCat').textContent = `Set ${owned}/${cards.length}`; $('segAll').textContent = `Cards ${real.length}`;
    grid.innerHTML = bingoMarkup();
    event('view', {view:'bingo', filled:board.cells.filter(c => c.by).length - 1, lines:board.lines.length, dice:dice.length, basicReady:basic.ready});
    $('testerCode').textContent = P.tester || testerId;
    return;
  }
  if (colMode === 'cat'){
    const vOn = versionsOn();
    if (vOn){
      const owned = cards.reduce((n, c) => n + Object.values(versionState(c)).filter(Boolean).length, 0);
      html += `<p class="vhead">Versions <b>${owned}/${cards.length*4}</b> · each card comes in Prob, Luck, Entr and Var</p>
        <p class="vlegend"><span><i class="own"></i>Owned</span><span><i class="gold"></i>Owned with a gold stat</span><span><i></i>Not yet</span></p>`;
    }
    for (const card of cards){
      const mine = real.filter(c => c.cardId === card.id);
      if (mine.length){
        const inst = bestCopy(mine);
        html += tile(card, inst, (inst.sealed ? '<span class="seal-tag">Sealed</span>' : holoTag(inst)) + (mine.length > 1 ? `<span class="count">×${mine.length}</span>` : ''), `${card.name}, ${mine.length} owned`, vOn ? versionChips(card) : '');
      } else {
        html += `<div class="tile slot-empty" aria-label="Empty slot ${card.no}">${cardMarkup(card, null, -1)}<div class="tile-cap"><b>No. ${card.no}</b><span class="tags">${E.RANKS[card.rank - 1]}</span></div>${vOn ? versionChips(card) : ''}</div>`;
      }
    }
  } else {
    if (!real.length) html += '<p class="empty-note">No cards yet. Walk to a node on the map, or claim your daily card.</p>';
    const sealed = real.filter(c => c.sealed);
    if (sealed.length){
      html += `<h2 class="group-head first">Sealed <span>${sealed.length}</span></h2><p class="group-note">Tap one to scratch it. What's under the panel isn't decided until you do.</p>`;
      for (const inst of sealed.slice().reverse()){
        const card = E.CARDS.find(c => c.id === inst.cardId); if (!card) continue;
        html += tile(card, inst, `<span class="seal-tag">${inst.started ? 'Started' : 'Sealed'}</span>`, `Sealed ${card.name}, tap to scratch`);
      }
      if (real.length > sealed.length) html += `<h2 class="group-head">Scratched <span>${real.length - sealed.length}</span></h2>`;
    }
    for (const inst of real.filter(c => !c.sealed).slice().reverse()){
      const card = E.CARDS.find(c => c.id === inst.cardId); if (!card) continue;
      html += tile(card, inst, holoTag(inst) + `<span class="g-${inst.grade}">${inst.grade}</span>`, `${card.name}, ${inst.isHolo ? 'holo, ' : ''}${inst.grade}`);
    }
    if (tests.length){
      html += `<h2 class="group-head">Test cards <span>${tests.length}</span></h2><p class="group-note">Pulled from the Debug tab. They don’t count toward your set or your card total.</p>`;
      for (const inst of tests.slice().reverse()){
        const card = E.CARDS.find(c => c.id === inst.cardId); if (!card) continue;
        html += tile(card, inst, '<span class="test-tag">Test</span>' + holoTag(inst) + `<span class="g-${inst.grade}">${inst.grade}</span>`, `Test card, ${card.name}, ${inst.grade}`);
      }
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('canvas.resid').forEach(cv => { const inst = shown[+cv.dataset.i]; if (inst && inst.mask) paintResidue(cv, inst.mask); });
  event('view', {view:colMode === 'cat' ? 'set' : 'my_cards', owned, cards:real.length, testCards:tests.length});
  $('testerCode').textContent = P.tester || testerId;
}
$('colGrid').addEventListener('click', e => {
  const cell = e.target.closest('[data-cell]');
  if (cell){ const inst = collection.find(c => c.id === board.cells[+cell.dataset.cell].by); if (inst){ if (inst.sealed) openSealed(inst, null); else openInspect(inst); } return; }
  const sg = e.target.closest('[data-seg]'); if (sg){ setSeg(sg.dataset.seg); return; }
  if (e.target.closest('#newBoard')){ board = newBoard(); store.set('bingo', board); event('bingo_new_board', {id:board.id}); renderCollection(); refreshNodes(); return; }
  const t = e.target.closest('button.tile'); if (!t) return;
  const inst = shown[+t.dataset.i];
  if (inst && inst.sealed) openSealed(inst, t.querySelector('.card')); else openInspect(inst);
});
function setSeg(mode){ colMode = mode; [['segCat', 'cat'], ['segAll', 'all'], ['segBingo', 'bingo'], ['segDice', 'dice']].forEach(([id, m]) => $(id).setAttribute('aria-selected', mode === m)); renderCollection(); }
$('segCat').addEventListener('click', () => setSeg('cat'));
$('segAll').addEventListener('click', () => setSeg('all'));
$('segBingo').addEventListener('click', () => setSeg('bingo'));
$('segDice').addEventListener('click', () => setSeg('dice'));
$('setFilter').addEventListener('change', renderCollection);

/* ================= Inspect ================= */
function openInspect(inst){
  if (!inst) return;
  const card = E.CARDS.find(c => c.id === inst.cardId);
  $('inspect').hidden = false;
  const vs = $('inspVersions'), showV = versionsOn() && raceCopies(card.id).length && !isTest(inst);
  vs.hidden = !showV;
  if (showV){ vs.innerHTML = `<span class="vlabel">Your best of each version</span>` + versionChips(card, 'big');
    vs.querySelectorAll('[data-v]').forEach(el => el.classList.toggle('current', !!(inst.race && inst.race.winner === el.dataset.v))); vs.dataset.card = card.id; }
  $('inspCard').innerHTML = cardMarkup(card, inst, 0);
  const cv = $('inspCard').querySelector('canvas.resid');
  if (cv) paintResidue(cv, inst.mask);
  $('inspHint').textContent = isTest(inst) ? 'A test card from the Debug tab. It doesn’t count toward your set.' : inst.mask ? 'Hold the panel to read through the residue.' : inst.grade === 'Pristine' ? 'A Pristine copy. The panel came off clean.' : '';
  const cfRows = inst.race ? (() => { const w = inst.race.winner, [lo, hi] = card.cf.probability, b = inst.cf[w] > hi;
      const rest = E.STATS.filter(k => k !== w).sort((a, c) => inst.cf[c] - inst.cf[a]).map(k => `${E.STAT_LABEL[k]} ${inst.cf[k].toFixed(1)}`).join(', ');
      return `<dt>${E.RNAME[w]}</dt><dd>${inst.cf[w].toFixed(1)} <span style="color:var(--muted)">(${lo}–${hi})</span>${b ? ' <span class="flag">broke the ceiling</span>' : ''}</dd>
        <dt>Race</dt><dd>Won over ${rest}${inst.race.photo ? ', in a photo finish' : ''}</dd>`; })()
    : E.STATS.map(k => { const [lo, hi] = card.cf[k]; const b = inst.broke && inst.broke[k];
    return `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${inst.cf[k].toFixed(1)} <span style="color:var(--muted)">(${lo}–${hi})</span>${b ? ' <span class="flag">broke the ceiling</span>' : ''}</dd>`; }).join('');
  $('inspSlab').innerHTML = `<div class="slab"><div class="slab-head"><div><div class="t">${E.esc(card.name)}</div><div class="s">Harbor Lights · Launch · ${E.RANKS[card.rank - 1]}</div></div>
    <div class="slab-grade"><div class="g g-${inst.grade}">${inst.grade}</div></div></div>
    <dl class="kv"><dt>Finish</dt><dd>${inst.isHolo ? 'Holo' : 'Normal'}</dd><dt>Print</dt><dd>${inst.printNumber > 0 ? inst.printNumber + ' / ' + card.run.size : 'Evergreen'}</dd>
    <dt>Token</dt><dd>${inst.token}</dd>${inst.die ? `<dt>Die</dt><dd>${E.RANKS[inst.die.rank - 1]} ${E.dieName(inst.die.rank)}, +${inst.die.total} to every stat</dd>` : ''}${cfRows}
    ${inst.ball ? `<dt>Bingo</dt><dd>${inst.ball.l}·${inst.ball.n}${inst.bingo ? ', daubed on your board' : ''}</dd>` : ''}<dt>Pulled</dt><dd>${E.esc(inst.provenance || '')}, ${new Date(inst.at).toLocaleDateString('en-US')}</dd>${isTest(inst) ? '<dt>Status</dt><dd>Test card, not in your set</dd>' : ''}</dl></div>`;
  const desc = $('inspCard').querySelector('.desc.has-resid');
  if (desc){
    let t = null;
    const stop = () => { clearTimeout(t); desc.classList.remove('peeking'); };
    desc.addEventListener('pointerdown', e => { e.preventDefault(); clearTimeout(t); t = setTimeout(() => { desc.classList.add('peeking'); event('peek', {where:'inspect', card:card.id}); try{ navigator.vibrate && navigator.vibrate(12); }catch{} }, 250); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => desc.addEventListener(k, stop));
    desc.addEventListener('contextmenu', e => e.preventDefault());
  }
  event('inspect', {card:card.id, grade:inst.grade});
}
function closeInspect(){ $('inspect').hidden = true; $('inspCard').innerHTML = ''; }
$('inspClose').addEventListener('click', closeInspect);
$('inspVersions').addEventListener('click', e => {
  const el = e.target.closest('[data-v]'); if (!el || !el.classList.contains('own')) return;
  const card = E.CARDS.find(c => c.id === $('inspVersions').dataset.card), best = card && bestOfVersion(card, el.dataset.v);
  if (best){ openInspect(best); event('version_view', {card:card.id, version:el.dataset.v}); }
});
$('inspect').addEventListener('click', e => { if (e.target === $('inspect')) closeInspect(); });

/* ================= Views ================= */
const VIEWS = ['vMap', 'vScratch', 'vCollection', 'vDebug'];
function showView(id){
  for (const v of VIEWS) $(v).hidden = v !== id;
  document.querySelectorAll('.tabs button').forEach(b => { if (b.dataset.view === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (id === 'vMap'){ setTimeout(() => map.invalidateSize(), 0); refreshNodes(); updateChips(); }
  if (id === 'vCollection') renderCollection();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

/* ================= Debug ================= */
function applyDebug(){
  $('tabDebug').hidden = !P.debug;
  const testerOn = !!E.settings.tester;
  if (P.debug === testerOn) $('testerBtn').click();       // debug unlocked shows lab panels; locked hides them
}
let taps = [];
$('vMap').querySelector('.brand').addEventListener('click', () => {
  const now = Date.now(); taps = taps.filter(t => now - t < 3000); taps.push(now);
  if (taps.length >= 5){ taps = []; P.debug = !P.debug; saveP(); applyDebug(); event('debug_toggle', {on:P.debug}); }
});
if (location.hash === '#debug'){ P.debug = true; saveP(); }
// Coming back from the survey, problem report or guide: land on Collection, where those were opened.
if (location.hash === '#collection'){ showView('vCollection'); try{ history.replaceState(null, '', location.pathname + location.search); }catch{} }

function bindPRange(id, key, fmt, after){
  const el = $(id), out = $('o' + id.slice(1));
  el.value = P[key]; out.textContent = fmt(+el.value);
  el.addEventListener('input', () => { P[key] = +el.value; out.textContent = fmt(P[key]); saveP(); after && after(); });
}
bindPRange('dVis', 'vis', v => v + ' m', refreshNodes);
bindPRange('dReach', 'reach', v => v + ' m', () => { reachCircle.setRadius(P.reach); refreshNodes(); });
bindPRange('dAcc', 'acc', v => '±' + v + ' m', () => { updateGps(); refreshNodes(); });
bindPRange('dCool', 'cool', v => v ? v + ' h' : 'None', null);
bindPRange('dRingMid', 'ringMid', v => v + ' m', refreshNodes);
bindPRange('dRingNear', 'ringNear', v => v + ' m', refreshNodes);
$('dMock').value = P.mock;
$('dMock').addEventListener('change', () => {
  P.mock = $('dMock').value; saveP(); stopMock();
  if (P.mock === 'on') startMock(); else { hadFix = false; initLocation(); }
  updateGps();
});
$('dWalk').value = String(P.walk);
$('dWalk').addEventListener('change', () => { P.walk = $('dWalk').value; saveP(); });
$('dReseed').addEventListener('click', () => { if (me){ seedArea(me, true); $('dNote').textContent = 'Reseeding nodes around you.'; } else $('dNote').textContent = 'No location yet.'; });
$('dSource').value = P.nodeSource;
$('dSource').addEventListener('change', () => { P.nodeSource = $('dSource').value; saveP(); $('dNote').textContent = 'Tap Reseed nodes around me to apply.'; });
$('dReady').addEventListener('click', () => { if (nodes){ nodes.forEach(n => { n.coolUntil = 0; delete n.ball; }); store.set('nodes', nodes); refreshNodes(); $('dNote').textContent = 'All nodes ready.'; } });
$('dDaily').addEventListener('click', () => { daily.last = 0; store.set('daily', daily); updateChips(); $('dNote').textContent = 'Daily card is ready.'; });
$('dTester').value = P.tester;
$('dTester').placeholder = testerId;
$('dTester').addEventListener('change', () => { P.tester = $('dTester').value.trim(); saveP(); });
$('dHook').value = P.hook;
$('dHook').placeholder = (window.PECAN_CONFIG && window.PECAN_CONFIG.logEndpoint) ? 'Using the built-in endpoint' : 'https://script.google.com/macros/s/…/exec';
$('dHook').addEventListener('change', () => { P.hook = $('dHook').value.trim(); saveP(); if (P.hook) event('endpoint_set'); updateOutboxNote(); });
$('dSend').addEventListener('click', () => flush());
$('dCopyEvents').addEventListener('click', () => {
  const txt = JSON.stringify(events, null, 1), ta = $('dOut');
  const fallback = () => { ta.hidden = false; ta.value = txt; ta.focus(); ta.select(); $('dNote').textContent = 'Copy the selected text below.'; };
  try{ navigator.clipboard.writeText(txt).then(() => { $('dNote').textContent = `Copied ${events.length} events.`; ta.hidden = true; }, fallback); }catch{ fallback(); }
});
let wipeArmed = false;
$('dWipe').addEventListener('click', () => {
  if (!wipeArmed){ wipeArmed = true; $('dWipe').textContent = 'Tap again to erase'; setTimeout(() => { wipeArmed = false; $('dWipe').textContent = 'Erase collection'; }, 3000); return; }
  collection = []; store.set('collection', collection); wipeArmed = false; $('dWipe').textContent = 'Erase collection';
  $('dNote').textContent = 'Collection erased.'; updateChips(); event('collection_erased');
});
$('newCard').addEventListener('click', () => openScratch(drawCard(), {source:'debug', label:'Test card', provenance:'Test card', ball:rollBall()}));
$('dDice').addEventListener('click', () => { for (let r = 1; r <= 5; r++) grantDie(r, 'debug'); $('dNote').textContent = 'Added one die of each rank.'; });
$('dCharge').addEventListener('click', () => { basic.ready = true; basic.pts = 0; saveBasic(); updateDiceChip(); $('dNote').textContent = 'Basic die charged.'; });
$('dDaub').addEventListener('click', () => {
  const open = board.cells.map((c, i) => c.by ? -1 : i).filter(i => i >= 0); if (!open.length) return;
  const i = open[Math.floor(E.rng()*open.length)], c = board.cells[i];
  toast(daub({id:'debug' + Date.now().toString(36), ball:{l:c.l, n:c.n}, source:'node', debugFill:true}));
  $('dNote').textContent = `Filled ${c.l}·${c.n}.`;
});
$('dBoard').addEventListener('click', () => { board = newBoard(); store.set('bingo', board); refreshNodes(); $('dNote').textContent = 'New bingo board.'; });

/* ================= Home-screen install ================= */
// Offline shell: the service worker keeps the app's own files on the phone.
if ('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// A one-time tip after the first card. Android gets a real Install button; iPhone gets the Share steps.
let installPrompt = null, installTipEarned = false;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { event('app_installed'); hideInstallTip('installed'); });
function maybeShowInstallTip(){
  if (standalone() || store.get('installTip', '') || $('vMap').hidden) return;
  if (!installTipEarned && !realCards().length) return;
  const tip = $('installTip'); if (!tip.hidden) return;
  if (installPrompt){ $('installGo').hidden = false; $('installHow').textContent = 'Opens full screen like an app. Install before collecting more: the installed app keeps its own collection.'; }
  else if (PLATFORM !== 'iOS'){ $('installHow').textContent = 'Open your browser menu and choose Add to Home screen or Install app. Do it before collecting more: the installed app keeps its own collection.'; }
  tip.hidden = false;
  event('install_tip_shown', {platform:PLATFORM, prompt:!!installPrompt});
}
function hideInstallTip(why){ $('installTip').hidden = true; store.set('installTip', why || 'dismissed'); }
$('installLater').addEventListener('click', () => { hideInstallTip('dismissed'); event('install_tip_dismissed'); });
$('installGo').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try{ const choice = await installPrompt.userChoice; event('install_prompt_result', {outcome:choice && choice.outcome}); if (choice && choice.outcome === 'accepted') hideInstallTip('installed'); }catch{}
  installPrompt = null; $('installGo').hidden = true;
});

/* ================= Boot ================= */
applyDebug();
updateChips(); updateGps();
const IN_APP = /FBAN|FBAV|Instagram|Line\/|GSA\/|Snapchat|Twitter|LinkedInApp|MicroMessenger|; wv\)/.test(navigator.userAgent);
event('app_open', {cards:collection.length, inApp:IN_APP});
if (newIdentity){
  let ref = ''; try{ ref = document.referrer ? new URL(document.referrer).hostname : ''; }catch{}
  event('new_identity', {inApp:IN_APP, referrer:ref, localChars:localChars()});
}
// Storage health for diagnosing resets: how full it is, and whether the browser promised to keep it.
(async () => {
  try{
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
    event('storage_status', {localChars:localChars(), usageKB:est ? Math.round(est.usage/1024) : null, quotaKB:est ? Math.round(est.quota/1024) : null, persisted});
  }catch{}
})();
// Ask the browser not to clear our storage. Asked once there's something worth keeping, or right away when installed.
function askPersist(){
  if (store.get('persistAsked', false) || !(navigator.storage && navigator.storage.persist)) return;
  store.set('persistAsked', true);
  navigator.storage.persist().then(granted => event('storage_persist', {granted}), () => {});
}
if (standalone() || realCards().length) askPersist();
// In another app's built-in browser, storage is separate and often cleared: say so plainly.
if (IN_APP) setTimeout(() => mapNote('You’re in another app’s browser. Open Pecan Pie in your phone’s browser or from your home screen to keep your collection.', 10000), 1500);
// Spots already recharging under the old 4-hour cooldown come back no later than 2 hours from now.
if (nodes && !store.get('cool2Capped', false)){ const cap = Date.now() + P.cool*3600e3; nodes.forEach(n => { if (n.type !== 'die' && n.coolUntil > cap) n.coolUntil = cap; }); store.set('nodes', nodes); store.set('cool2Capped', true); }
// Copies collected before bingo existed get a ball now, so they can count toward the board.
(() => { let changed = false, notes = [];
  for (const inst of collection){ if (!inst.ball && !isTest(inst)){ inst.ball = rollBall(); changed = true; notes = notes.concat(daub(inst)); } }
  if (changed){ store.set('collection', collection); event('bingo_backfill', {cards:realCards().length, daubed:notes.length}); }
})();
updateDiceChip();
updateOutboxNote(); scheduleFlush(1500);
initLocation();
setInterval(() => { refreshNodes(); updateChips(); }, 1000);
setTimeout(maybeShowInstallTip, 4000);
window.__pilot = {get baseMode(){ return baseMode; }, get gl(){ return baseLayer && baseLayer.getMaplibreMap ? baseLayer.getMaplibreMap() : null; }, get outbox(){ return outbox; }, flush, get nodes(){ return nodes; }, get collection(){ return collection; }, get events(){ return events; }, P, setPosition, seedArea, showView, get board(){ return board; }, get dice(){ return dice; }, get basic(){ return basic; }, get badges(){ return badges; }, trackMove, refreshNodes, markerLook, nodeInfo, openSheet, daub};
})();
