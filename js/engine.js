/* Pecan Pie scratch engine, carried over from the Scratch Lab. */
(() => {
'use strict';

/* ================= Config and data ================= */
const RANKS = ['Common','Uncommon','Rare','Legendary','Mythic'];
const GRADES = ['Pristine','Good','Fair','Poor'];
const TOKENS = ['Rock','Paper','Scissors'];
const STATS = ['probability','luck','entropy','variance'];
const STAT_LABEL = {probability:'Prob', luck:'Luck', entropy:'Entr', variance:'Var'};

function cfTemplate(rank){ // floor, ceiling, fudge per stat, scaled by rank
  const f = 10 + rank*6, c = 40 + rank*10, z = 4 + rank;
  return {probability:[f, c, z], luck:[f-2, c-4, z], entropy:[f+2, c-2, z], variance:[f, c+2, z]};
}
const CARDS = [
  {id:'gull',    no:1,  name:'Harbor Gull',       rank:1, run:null,                 sig:['B','4'],  ttt:'O', sky:['#8FB8D2','#E9D6AE'], glyph:'gull'},
  {id:'lamp',    no:2,  name:'Pier Lamp',         rank:1, run:{label:'A',size:500}, sig:['I','19'], ttt:'X', sky:['#22324E','#C38A52'], glyph:'lamp'},
  {id:'buoy',    no:3,  name:'Bell Buoy',         rank:1, run:null,                 sig:['N','33'], ttt:'O', sky:['#5E8FA8','#CFE0E6'], glyph:'buoy'},
  {id:'net',     no:4,  name:'Drift Net',         rank:1, run:{label:'A',size:500}, sig:['G','47'], ttt:'X', sky:['#3D6670','#B9C9B0'], glyph:'net'},
  {id:'clock',   no:5,  name:'Tide Clock',        rank:2, run:{label:'A',size:500}, sig:['N','38'], ttt:'O', sky:['#4C7A8C','#D9C59A'], glyph:'clock'},
  {id:'crab',    no:6,  name:'Pier Crab',         rank:2, run:{label:'A',size:400}, sig:['O','61'], ttt:'X', sky:['#6F98A6','#E8C9A0'], glyph:'crab'},
  {id:'flags',   no:7,  name:'Signal Flags',      rank:2, run:{label:'A',size:400}, sig:['B','9'],  ttt:'O', sky:['#7FA7C9','#EEF2F4'], glyph:'flags'},
  {id:'lantern', no:8,  name:'Kelp Lantern',      rank:3, run:{label:'A',size:250}, sig:['G','52'], ttt:'X', sky:['#123B3A','#5FA38A'], glyph:'lantern'},
  {id:'pool',    no:9,  name:'Tide Pool',         rank:3, run:{label:'A',size:250}, sig:['I','24'], ttt:'O', sky:['#2E5E6B','#9CC7B8'], glyph:'pool'},
  {id:'keeper',  no:10, name:'Lighthouse Keeper', rank:4, run:{label:'A',size:100}, sig:['O','67'], ttt:'O', sky:['#1D2440','#E7A35E'], glyph:'lighthouse'},
  {id:'whale',   no:11, name:'Grey Whale',        rank:4, run:{label:'A',size:100}, sig:['N','42'], ttt:'X', sky:['#20384F','#7FA2B8'], glyph:'whale'},
  {id:'ferry',   no:12, name:'Night Ferry',       rank:5, run:{label:'A',size:25},  sig:['B','11'], ttt:'X', sky:['#0B1028','#3B3F7A'], glyph:'ferry'},
].map(c => ({...c, cf: cfTemplate(c.rank)}));

const DEFAULTS = {threshold:65, brush:10, strength:40, haze:100, coat:'peel', peelStrength:20, fxFlaky:true, fxShavings:true, fxAudio:true, fxTension:true, fxStaged:true, fxRace:true, weight:'gaussian', spread:70, pristine:7.5, good:15, fair:25,
  heat:'off', holoRate:12, sound:true, tester:false, card:'random'};

/* ================= Storage (best effort) ================= */
const store = {
  get(k, d){ try{ const v = localStorage.getItem('scratchlab.'+k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem('scratchlab.'+k, JSON.stringify(v)); }catch{} }
};
const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
// Grade cutoffs v2, set from the first real scratches (Nov 10): Pristine was landing on a single quick sweep.
// Every phone saved the old cutoffs (13/22/32), so move them once; Debug sliders can still change them afterward.
// The Chance Factor race became the default for everyone (Nov 13); phones that saved it as off move once.
if ((settings.raceV || 0) < 1){ settings.fxRace = true; settings.raceV = 1; store.set('settings', settings); }
if ((settings.gradeV || 0) < 2){ Object.assign(settings, {pristine:DEFAULTS.pristine, good:DEFAULTS.good, fair:DEFAULTS.fair, gradeV:2}); store.set('settings', settings); }
let log = store.get('log', []);
if (!Array.isArray(log)) log = [];

/* ================= RNG ================= */
function rng(){ const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
const pick = arr => arr[Math.floor(rng()*arr.length)];

/* ================= Grading (pure) ================= */
function makeWeights(mode, spread){
  const w = new Float64Array(64);
  for (let i = 0; i < 64; i++){
    const cx = i % 8, cy = (i / 8) | 0;
    const x = (cx - 3.5) / 3.5, y = (cy - 3.5) / 3.5;
    if (mode === 'border') w[i] = (cx === 0 || cx === 7 || cy === 0 || cy === 7) ? 0 : 1;
    else if (mode === 'gaussian'){ const s = spread / 100; w[i] = Math.exp(-(x*x + y*y) / (2*s*s)); }
    else w[i] = 1;
  }
  return w;
}
function gridStats(cells, w){
  let n = 0, su = 0, sw = 0, sww = 0;
  for (let i = 0; i < 64; i++){ su += cells[i]; sw += w[i]*cells[i]; sww += w[i]; n++; }
  const meanU = su / n, meanW = sww ? sw / sww : 0;
  let vu = 0, vw = 0;
  for (let i = 0; i < 64; i++){ vu += (cells[i]-meanU)**2; vw += w[i]*(cells[i]-meanW)**2; }
  return {meanU, meanW, sigmaU: Math.sqrt(vu / n), sigmaW: sww ? Math.sqrt(vw / sww) : 0};
}
function gradeFor(sigma, s){
  if (sigma < s.pristine/100) return 'Pristine';
  if (sigma < s.good/100) return 'Good';
  if (sigma < s.fair/100) return 'Fair';
  return 'Poor';
}

/* ================= Payload (pure apart from rng) ================= */
function rollPayload(card, grade, force, holoRate, bonus){
  const isHolo = force.holo === 'holo' ? true : force.holo === 'normal' ? false : rng() < holoRate/100;
  let printNumber = -1;
  if (card.run){
    const n = card.run.size;
    printNumber = force.print === 'low' ? 1 + Math.floor(rng()*3) : force.print === 'high' ? n - Math.floor(rng()*3) : 1 + Math.floor(rng()*n);
  }
  const cf = {}, broke = {};
  const forcedStat = force.cf === 'ceiling' ? pick(STATS) : null;
  for (const k of STATS){
    const [lo, hi, fudge] = card.cf[k];
    let v;
    if (force.cf === 'flat') v = (lo + hi) / 2;
    else if (k === forcedStat) v = hi + fudge*(0.3 + 0.7*rng());
    else {
      const base = lo + rng()*(hi - lo);
      const soft = ((rng() + rng() + rng()) / 1.5) - 1;   // -1..1, clustered at 0
      v = base + fudge*soft;                              // never clamped at the ceiling
      if (v < lo) v = lo + (lo - v);                      // no floor breaks: a dip below the floor bounces back up
    }
    v += bonus || 0;                                      // a committed die adds the same amount to every stat
    cf[k] = Math.round(v*10)/10;
    broke[k] = cf[k] > hi ? 'ceiling' : null;
  }
  const token = force.token !== 'auto' ? force.token : pick(TOKENS);
  return {isHolo, printNumber, grade, chanceFactors: cf, broke, microGameToken: token};
}

/* ================= Card art ================= */
function artSVG(card){
  const [a, b] = card.sky;
  const waves = `<path d="M0 44 Q12 40 25 44 T50 44 T75 44 T100 44 V60 H0Z" fill="#0d2a3a" opacity=".85"/><path d="M0 49 Q12 45 25 49 T50 49 T75 49 T100 49 V60 H0Z" fill="#081c28"/>`;
  const g = {
    gull:`<circle cx="76" cy="16" r="7" fill="#fff6dd" opacity=".9"/><path d="M28 26 q8 -9 16 0 q8 -9 16 0" stroke="#1b2733" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M58 18 q4 -5 8 0 q4 -5 8 0" stroke="#1b2733" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    lamp:`<circle cx="50" cy="16" r="14" fill="#ffd27a" opacity=".25"/><rect x="48.5" y="18" width="3" height="27" fill="#1a1f26"/><path d="M44 12 h12 l-2 8 h-8z" fill="#1a1f26"/><circle cx="50" cy="15.5" r="3.4" fill="#ffe2a0"/><rect x="20" y="40" width="60" height="3" fill="#1a1f26"/>`,
    clock:`<circle cx="50" cy="24" r="15" fill="#f4ead2" stroke="#1a1f26" stroke-width="2"/><path d="M50 24 V14 M50 24 L58 28" stroke="#1a1f26" stroke-width="2" stroke-linecap="round"/><circle cx="50" cy="24" r="1.6" fill="#1a1f26"/>`,
    lantern:`<path d="M30 60 q4 -14 -2 -26 q-4 -8 2 -16" stroke="#3E8C5E" stroke-width="2" fill="none"/><path d="M70 60 q-4 -14 2 -26 q4 -8 -2 -16" stroke="#3E8C5E" stroke-width="2" fill="none"/><circle cx="50" cy="26" r="16" fill="#9CF2C8" opacity=".25"/><rect x="43" y="16" width="14" height="20" rx="3" fill="#C9FFE4" stroke="#0e2b25" stroke-width="2"/><path d="M45 13 h10 M50 9 v4" stroke="#0e2b25" stroke-width="2"/>`,
    lighthouse:`<path d="M50 16 L100 4 V22Z" fill="#ffd994" opacity=".35"/><path d="M44 46 L47 18 H53 L56 46Z" fill="#f2ece1"/><path d="M45.2 36 H54.8 L55.4 41 H44.6Z M46.3 26 H53.7 L54.2 31 H45.8Z" fill="#b83a2c"/><rect x="45.5" y="12" width="9" height="6" fill="#ffe3a6"/><path d="M44 12 L50 7 L56 12Z" fill="#1a1f26"/>`,
    ferry:`<circle cx="22" cy="14" r="6" fill="#f3f0ff"/><circle cx="24.5" cy="12.5" r="5.2" fill="${a}"/><path d="M26 40 H76 L70 47 H32Z" fill="#e8e6f2"/><rect x="36" y="32" width="30" height="8" fill="#d2d0e4"/><rect x="48" y="26" width="6" height="6" fill="#b83a2c"/><g fill="#ffd27a"><rect x="39" y="34.5" width="3" height="3"/><rect x="45" y="34.5" width="3" height="3"/><rect x="51" y="34.5" width="3" height="3"/><rect x="57" y="34.5" width="3" height="3"/></g><g fill="#fff" opacity=".8"><circle cx="70" cy="9" r=".7"/><circle cx="84" cy="18" r=".6"/><circle cx="60" cy="6" r=".5"/><circle cx="92" cy="7" r=".7"/></g>`,
    buoy:`<circle cx="50" cy="15" r="8" fill="#ffd27a" opacity=".25"/><path d="M43 45 L50 18 L57 45Z" fill="#c8402f"/><path d="M45.6 34 H54.4 L55.5 38.5 H44.5Z" fill="#f2ece1"/><circle cx="50" cy="15.5" r="2.6" fill="#ffe2a0"/><path d="M47 18 h6" stroke="#1a1f26" stroke-width="1.6"/>`,
    net:`<g stroke="#20313a" stroke-width=".9" opacity=".75">${Array.from({length:9}, (_, i) => `<path d="M${14 + i*9} 6 L${4 + i*9} 44"/><path d="M${4 + i*9} 6 L${14 + i*9} 44"/>`).join('')}</g><path d="M8 7 Q50 15 92 7" stroke="#20313a" stroke-width="1.6" fill="none"/><g fill="#e2742f"><circle cx="20" cy="9.5" r="2.6"/><circle cx="40" cy="12" r="2.6"/><circle cx="60" cy="12" r="2.6"/><circle cx="80" cy="9.5" r="2.6"/></g>`,
    crab:`<g stroke="#9b3324" stroke-width="1.8" stroke-linecap="round"><path d="M40 36 l-8 5 M40 33 l-9 2 M60 36 l8 5 M60 33 l9 2"/><path d="M42 28 q-8 -8 -10 -14 M58 28 q8 -8 10 -14"/></g><circle cx="31" cy="13" r="4.2" fill="#d2553a"/><circle cx="69" cy="13" r="4.2" fill="#d2553a"/><ellipse cx="50" cy="33" rx="12" ry="7.5" fill="#d2553a"/><path d="M46 26 v-4 M54 26 v-4" stroke="#1a1f26" stroke-width="1.4"/><circle cx="46" cy="21.5" r="1.5" fill="#1a1f26"/><circle cx="54" cy="21.5" r="1.5" fill="#1a1f26"/>`,
    flags:`<path d="M10 10 Q50 20 90 10" stroke="#1a1f26" stroke-width="1" fill="none"/><path d="M50 15 V45" stroke="#1a1f26" stroke-width="1.6"/>${[[16,'#c8402f'],[28,'#f2c230'],[40,'#2d5fa0'],[60,'#f2ece1'],[72,'#c8402f'],[84,'#2d5fa0']].map(([x, c]) => { const y = 10 + 10*(1 - Math.pow((x - 50)/40, 2))*.5; return `<path d="M${x - 4} ${y} L${x + 4} ${y} L${x} ${y + 9}Z" fill="${c}" stroke="#1a1f26" stroke-width=".4"/>`; }).join('')}`,
    pool:`<path d="M8 44 Q14 30 26 34 Q34 24 46 32 Q58 26 66 34 Q80 28 92 44Z" fill="#4a5a58"/><ellipse cx="50" cy="40" rx="30" ry="5" fill="#7fc3c0" opacity=".85"/><path d="M38 38 l2 -4 l2 4 l4 1 l-3 2 l1 4 l-4 -2 l-4 2 l1 -4 l-3 -2z" fill="#e07a4a"/><circle cx="60" cy="39" r="2.2" fill="#6c3f7a"/><circle cx="64" cy="41" r="1.6" fill="#6c3f7a"/><path d="M24 30 q2 -6 0 -12 M28 31 q3 -5 2 -10" stroke="#3E8C5E" stroke-width="1.6" fill="none"/>`,
    whale:`<path d="M47 22 q-2 -7 -6 -9 M47 22 q2 -7 6 -9 M47 22 v-8" stroke="#dbe7ef" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M22 36 Q30 22 52 24 Q70 25 78 33 L88 27 L86 37 L90 44 L78 39 Q66 46 46 44 Q28 43 22 36Z" fill="#8a99a6"/><path d="M26 37 Q44 42 70 39" stroke="#6f7f8c" stroke-width="1" fill="none"/><circle cx="33" cy="32" r="1.3" fill="#1a1f26"/>`
  }[card.glyph];
  return `<svg viewBox="0 0 100 58" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sky-${card.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="58" fill="url(#sky-${card.id})"/>${g}${waves}</svg>`;
}

/* ================= DOM refs ================= */
const $ = id => document.getElementById(id);
const app = $('app'), stage = $('stage');

/* ================= State ================= */
const state = {
  card:null, payload:null, revealed:false, cells:new Float64Array(64), weights:null,
  drawing:false, last:null, strokes:0, pathLen:0, drawMs:0, lastMoveT:0, firstT:0, revealT:0, pointerType:'',
  dirty:false, dpr:1, brushPx:20, wiping:false, mask:null, mw:192, mh:64, maskDirty:false
};
let ctx, heatCtx, scratchEl, heatEl, descEl, cardEl;
const surfaceCv = document.createElement('canvas');   // the untouched coating with its label, at device pixels
const surfacePlain = document.createElement('canvas'); // same coating, no label: used for frozen residue
const maskCv = document.createElement('canvas');      // erase amount per mask pixel, drawn as alpha
let maskCtx = maskCv.getContext('2d'), maskImg = null;
const coatCv = document.createElement('canvas');      // coating after erase, before the relief shadow
const dispCv = document.createElement('canvas');      // flaky display mask, about 2x the erase field
let dispCtx = dispCv.getContext('2d'), dispImg = null, chipNoise = null, bil = null;
const seq = {id:0, running:false, skip:false, wakers:new Set()};
function seqWait(ms){   // a delay that a skip cuts short
  if (seq.skip) return Promise.resolve();
  return new Promise(r => { const w = () => { clearTimeout(t); seq.wakers.delete(w); r(); }; const t = setTimeout(w, ms); seq.wakers.add(w); });
}
function seqSkip(){ seq.skip = true; for (const w of [...seq.wakers]) w(); }
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

/* ================= Card rendering ================= */
function pipRow(rank, extra){
  let h = '';
  for (let i = 1; i <= 4; i++) h += `<span class="pip${rank >= i ? ' on' : ''}"></span>`;
  h += `<span class="pip dia${rank >= 5 ? ' on' : ''}"></span>`;
  return `<div class="pips"><span class="pip-set" role="img" aria-label="Rank ${rank}, ${RANKS[rank-1]}">${h}</span>${extra || ''}</div>`;
}
// Bingo square: a per-copy border value, shown as a ball in its column's color (the same ball appears on the map).
const BALL_COL = {B:'#3D7FD9', I:'#D9534A', N:'#E9E6DD', G:'#3DA65F', O:'#EE8C2E'};
function ballToken(ball){
  return `<span class="btok" style="--bc:${BALL_COL[ball.l] || '#888'}" role="img" aria-label="Bingo ${ball.l} ${ball.n}"><span class="face"><span class="l">${ball.l}</span><span class="n">${ball.n}</span></span></span>`;
}
// Stat-Mod Dice: summed dice per rank, so higher ranks cluster around a mean. The total adds flat to all four stats.
const DICE = {1:[1, 4], 2:[1, 6], 3:[1, 8], 4:[2, 8], 5:[3, 8]};
const dieName = rank => { const [n, d] = DICE[rank]; return (n > 1 ? n : '') + 'd' + d; };
function rollDie(rank){
  const [n, d] = DICE[rank], faces = [];
  for (let i = 0; i < n; i++) faces.push(1 + Math.floor(rng()*d));
  return {rank, faces, total:faces.reduce((a, b) => a + b, 0)};
}
// Condition is an outcome of the scratch, not a hidden value, so it shows as a badge on the pip band after the reveal.
function showGrade(g, animate){
  const el = $('vGrade'); if (!el) return;
  el.textContent = g; el.className = 'grade-badge shown g-' + g;
  if (!animate) return;
  void el.offsetWidth; el.classList.add('stamping');
  // The stamp hits 72% of the way through (650 ms of 900): thud, ink ring, a jolt through the card, a haptic tap.
  setTimeout(() => {
    el.classList.add('inked');
    try{ Sound.stamp(); }catch{}
    vibrate(18);
    if (cardEl && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      cardEl.animate([{transform:'translateY(0)'}, {transform:'translateY(.8%) scale(.994)'}, {transform:'translateY(0)'}], {duration:200, easing:'ease-out'});
  }, 650);
}
function renderCard(card, prov){
  const ed = card.run ? `Launch Ed. · Run ${card.run.label} of ${card.run.size}` : 'Launch Ed. · Evergreen';
  const today = new Date().toLocaleDateString('en-US');
  stage.innerHTML = `
  <div class="card" id="card">
    <div class="topline${state.ctx.ball ? ' has-ball' : ''}"><span class="sig">${state.ctx.ball ? ballToken(state.ctx.ball) : `<b>${card.sig[0]}·${card.sig[1]}</b>`}<b>${card.ttt}</b></span><span class="settag">Harbor Lights</span></div>
    <div class="banner"><span class="name">${card.name}</span><span class="ed">${ed}</span></div>
    <div class="art">${artSVG(card)}</div>
    ${pipRow(card.rank, '<span class="grade-badge" id="vGrade" aria-live="polite"></span>')}
    <div class="desc unknown" id="desc">
      <div class="desc-grid">
        <div class="slot"><span class="lbl">Finish</span><span class="val" id="vHolo">?</span></div>
        <div class="slot"><span class="lbl">Print</span><span class="val" id="vPrint">?</span></div>
        <div class="slot"><span class="lbl">Token</span><span class="val" id="vToken">?</span></div>
      </div>
      ${state.raceMode ? raceLanesHTML(card) : `<div class="cf">${STATS.map(k => `<div class="cfrow"><span class="lbl">${STAT_LABEL[k]}</span><div class="track" id="t-${k}"></div><span class="cfv" id="c-${k}">?</span></div>`).join('')}</div>`}
      <div class="die-chip" id="vDie" hidden></div>
      <div class="glow" id="glow"></div>
      <canvas class="scratch" id="scratch" aria-label="Scratch surface"></canvas>
      <canvas class="heat" id="heat" aria-hidden="true"></canvas>
    </div>
    <div class="provenance"><span>${esc(prov || 'First pulled in Scratch Lab')}</span><span>${today}</span></div>
    <div class="foil"></div>
  </div>
  <div class="flash" id="flash"></div>
  <canvas class="burst" id="burst"></canvas>
  <canvas class="shav" id="shav"></canvas>`;
  cardEl = $('card'); descEl = $('desc'); scratchEl = $('scratch'); heatEl = $('heat');
  ctx = scratchEl.getContext('2d'); heatCtx = heatEl.getContext('2d');
  sizeCanvases(true);
  shavInit();
  bindScratch();
  bindPeek();
}

function sizeCanvases(fresh){
  const r = descEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.max(1, Math.round(r.width*dpr)), H = Math.max(1, Math.round(r.height*dpr));
  scratchEl.width = W; scratchEl.height = H; heatEl.width = W; heatEl.height = H;
  surfaceCv.width = W; surfaceCv.height = H; surfacePlain.width = W; surfacePlain.height = H;
  state.dpr = dpr; state.cssW = r.width;
  paintSurface(surfacePlain.getContext('2d'), W, H);
  const sc = surfaceCv.getContext('2d'); sc.drawImage(surfacePlain, 0, 0); paintLabel(sc, W, H);
  if (fresh || !state.mask){
    state.mw = 384; state.mh = Math.max(8, Math.round(384*r.height/r.width));
    state.mask = new Float32Array(state.mw*state.mh);
    maskCv.width = state.mw; maskCv.height = state.mh;
    maskImg = maskCtx.createImageData(state.mw, state.mh);
    buildChips();
  }
  coatCv.width = W; coatCv.height = H;
  updateBrush();
  state.maskDirty = true; state.dirty = true;
  renderScratch();
}
function updateBrush(){
  if (!descEl) return;
  state.brushPx = Math.max(16, settings.brush/100 * state.cssW);
  state.rM = state.brushPx * state.mw / state.cssW;          // radius in mask pixels
  state.stepM = settings.coat === 'peel' ? state.rM / 3 : state.rM / 4;   // stamp spacing in mask pixels
  state.laneW = Math.max(1, 1.0 * state.mw / state.cssW);    // coin striation width, about 1 CSS px
  state.pressL = 14 * state.mw / state.cssW;                   // pressure changes over about 14 CSS px
  state.segL = 7 * state.mw / state.cssW;                     // striations break into uneven dashes, about 7 CSS px on average
  // per-stamp strength so one pass through a point's center removes exactly `strength` of the coating
  state.stampS = 1 - Math.pow(1 - Math.min(settings.strength, 99.5)/100, 1/8);
}

function paintSurface(c, W, H){
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#B9BEC4'); g.addColorStop(.45, '#E2E5E8'); g.addColorStop(.55, '#C9CDD2'); g.addColorStop(1, '#A7ADB4');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const img = c.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4){ const n = (Math.random()-.5)*26; d[i]+=n; d[i+1]+=n; d[i+2]+=n; d[i+3]=255; }
  c.putImageData(img, 0, 0);
  c.save(); c.globalAlpha = .16; c.fillStyle = '#3a4450';
  const s = Math.round(H/5);
  c.font = `700 ${Math.round(s*.42)}px "Alegreya SC", Georgia, serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let y = s/2, row = 0; y < H + s; y += s, row++)
    for (let x = (row % 2 ? s : s/2); x < W + s; x += s*2) c.fillText('HL', x, y);
  c.restore();
}
function paintLabel(c, W, H){
  c.save(); c.fillStyle = 'rgba(30,38,48,.55)'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `700 ${Math.round(H*.13)}px system-ui, sans-serif`;
  c.fillText('SCRATCH HERE', W/2, H/2);
  c.restore();
}

function buildChips(){
  const dW = Math.min(384, scratchEl.width), dH = Math.max(8, Math.round(dW*state.mh/state.mw));
  dispCv.width = dW; dispCv.height = dH; dispImg = dispCtx.createImageData(dW, dH);
  const n = new Float32Array(dW*dH);
  const layer = (cell, amp) => {
    const gw = Math.ceil(dW/cell) + 2, gh = Math.ceil(dH/cell) + 2, g = new Float32Array(gw*gh);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    for (let y = 0; y < dH; y++){
      const fy = y/cell, iy = fy | 0, ty = fy - iy, sy = ty*ty*(3 - 2*ty);
      for (let x = 0; x < dW; x++){
        const fx = x/cell, ix = fx | 0, tx = fx - ix, sx = tx*tx*(3 - 2*tx);
        const a = g[iy*gw + ix], b = g[iy*gw + ix + 1], c = g[(iy + 1)*gw + ix], d = g[(iy + 1)*gw + ix + 1];
        n[y*dW + x] += amp*(a + (b - a)*sx + (c - a)*sy + (a - b - c + d)*sx*sy);
      }
    }
  };
  layer(dW/22, .55); layer(dW/60, .3);
  for (let i = 0; i < n.length; i++) n[i] += .15*Math.random();
  // rank-equalize so the share of chips cleared tracks the erase amount
  const idx = new Uint32Array(n.length); for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => n[a] - n[b]);
  chipNoise = new Float32Array(n.length);
  for (let r = 0; r < idx.length; r++) chipNoise[idx[r]] = 0.05 + 0.9*(r + .5)/idx.length;
  const mw = state.mw, mh = state.mh;
  bil = {x0:new Int32Array(dW), x1:new Int32Array(dW), tx:new Float32Array(dW), y0:new Int32Array(dH), y1:new Int32Array(dH), ty:new Float32Array(dH)};
  for (let x = 0; x < dW; x++){ const f = clamp((x + .5)*mw/dW - .5, 0, mw - 1); bil.x0[x] = f | 0; bil.x1[x] = Math.min(mw - 1, (f | 0) + 1); bil.tx[x] = f - (f | 0); }
  for (let y = 0; y < dH; y++){ const f = clamp((y + .5)*mh/dH - .5, 0, mh - 1); bil.y0[y] = f | 0; bil.y1[y] = Math.min(mh - 1, (f | 0) + 1); bil.ty[y] = f - (f | 0); }
}

function renderScratch(){
  if (!state.maskDirty || !ctx) return;
  state.maskDirty = false;
  const W = scratchEl.width, H = scratchEl.height, m = state.mask;
  let src;
  if (settings.coat === 'flaky' && chipNoise){
    const d = dispImg.data, dW = dispCv.width, dH = dispCv.height, mw = state.mw, n = chipNoise;
    const {x0, x1, tx, y0, y1, ty} = bil;
    for (let y = 0, o = 3, i = 0; y < dH; y++){
      const r0 = y0[y]*mw, r1 = y1[y]*mw, wy = ty[y];
      for (let x = 0; x < dW; x++, o += 4, i++){
        const wx = tx[x], a = m[r0 + x0[x]], b = m[r0 + x1[x]], c = m[r1 + x0[x]], e = m[r1 + x1[x]];
        const v = (a + (b - a)*wx)*(1 - wy) + (c + (e - c)*wx)*wy;
        const k = (v - n[i] + .04)/.08;
        d[o] = k <= 0 ? 0 : k >= 1 ? 255 : k*255;
      }
    }
    dispCtx.putImageData(dispImg, 0, 0); src = dispCv;
  } else {
    const d = maskImg.data;
    for (let i = 0, o = 3; i < m.length; i++, o += 4) d[o] = Math.round(m[i]*255);
    maskCtx.putImageData(maskImg, 0, 0); src = maskCv;
  }
  const cc = coatCv.getContext('2d');
  cc.globalCompositeOperation = 'source-over'; cc.clearRect(0, 0, W, H);
  cc.drawImage(state.frozen ? surfacePlain : surfaceCv, 0, 0);
  cc.globalCompositeOperation = 'destination-out';
  cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = 'high';
  cc.drawImage(src, 0, 0, W, H);
  cc.globalCompositeOperation = 'source-over';
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  if (settings.coat !== 'smooth'){
    ctx.save(); ctx.shadowColor = 'rgba(20,24,30,.45)'; ctx.shadowBlur = 2*state.dpr; ctx.shadowOffsetY = 1.2*state.dpr;
    ctx.drawImage(coatCv, 0, 0); ctx.restore();
  } else ctx.drawImage(coatCv, 0, 0);
}

/* ================= Shavings ================= */
const Shav = {parts:[], cv:null, c:null};
function shavInit(){
  Shav.cv = $('shav'); const r = Shav.cv.getBoundingClientRect();
  Shav.cv.width = Math.max(1, r.width*state.dpr); Shav.cv.height = Math.max(1, r.height*state.dpr);
  Shav.c = Shav.cv.getContext('2d'); Shav.parts = [];
}
function spawnShavings(e, dx, dy, speed){
  if (!settings.fxShavings || reduceMotion() || !Shav.c) return;
  const len = Math.hypot(dx, dy); if (len < .5) return;
  const lp = localPos(e), mi = clamp(lp.y | 0, 0, state.mh - 1)*state.mw + clamp(lp.x | 0, 0, state.mw - 1);
  if (state.mask[mi] > .96) return;                        // nothing left to shave here
  const r = Shav.cv.getBoundingClientRect(), dpr = state.dpr;
  const x = (e.clientX - r.left)*dpr, y = (e.clientY - r.top)*dpr, ux = dx/len, uy = dy/len;
  const count = Math.min(5, Math.floor(speed*2.2 + rng()*1.6));
  for (let i = 0; i < count; i++){
    if (Shav.parts.length > 260) Shav.parts.shift();
    const a = (rng() - .5)*1.7, sp = (0.7 + rng()*1.5)*(1 + speed*.8)*dpr;
    const vx = (ux*Math.cos(a) - uy*Math.sin(a))*sp, vy = (ux*Math.sin(a) + uy*Math.cos(a))*sp - rng()*dpr;
    Shav.parts.push({x, y, vx, vy, life:1, decay:.014 + rng()*.022, w:(1 + rng()*2.8)*dpr, h:(.6 + rng()*1.5)*dpr, rot:rng()*6.28, vr:(rng() - .5)*.6, shade:150 + Math.floor(rng()*80)});
  }
}
const Curl = {active:null, falling:[]};
function growCurl(e, speed){
  const pd = state.passDir;
  const area = (state.removed || 0) * (state.cssW/state.mw)**2; state.removed = 0;
  if (!pd || !settings.fxShavings || reduceMotion() || !Shav.c) return;
  const r = Shav.cv.getBoundingClientRect(), dpr = state.dpr, b = state.brushPx;
  const lead = b*.6;
  const x = (e.clientX - r.left + pd.x*lead)*dpr, y = (e.clientY - r.top + pd.y*lead)*dpr;
  let c = Curl.active;
  if (!c) c = Curl.active = {x, y, ang:0, area:0, roll:0, th:0, len:b*(.75 + rng()*.35)*dpr};
  c.x = x; c.y = y; c.ang = Math.atan2(pd.y, pd.x);
  c.area += area; c.roll += speed*.35*(area > 0 ? 1 : .2);
  c.th = Math.min(b*.5, 1.2 + Math.sqrt(c.area)*.17)*dpr;
  if (area > 0 && rng() < .12) crumb(x, y, pd.x*(1 + speed)*dpr, pd.y*(1 + speed)*dpr - dpr);
  if (c.th >= b*.42*dpr) detachCurl(speed);
}
function detachCurl(speed){
  const c = Curl.active; if (!c) return;
  Curl.active = null;
  if (c.area < 8) return;
  const pd = state.passDir || {x:0, y:-1}, dpr = state.dpr, v = 1 + (speed || 0);
  c.vx = pd.x*v*1.3*dpr + (rng() - .5)*dpr; c.vy = pd.y*v*1.3*dpr - (1.2 + rng()*1.6)*dpr;
  c.spin = (rng() - .5)*.22; c.life = 1;
  Curl.falling.push(c); if (Curl.falling.length > 40) Curl.falling.shift();
  for (let i = 0; i < 2 + (rng()*3 | 0); i++) crumb(c.x, c.y, c.vx + (rng() - .5)*2*dpr, c.vy - rng()*dpr);
  Sound.crinkle(Math.min(1, c.th/(state.brushPx*.42*dpr)));
}
function crumb(x, y, vx, vy){
  if (Shav.parts.length > 260) Shav.parts.shift();
  const dpr = state.dpr;
  Shav.parts.push({x, y, vx, vy, life:1, decay:.02 + rng()*.025, w:(.8 + rng()*1.6)*dpr, h:(.6 + rng()*1.1)*dpr, rot:rng()*6.28, vr:(rng() - .5)*.6, shade:120 + Math.floor(rng()*70)});
}
function drawCurl(g, c, alpha){
  const dpr = state.dpr, L = c.len, T = Math.max(1.4*dpr, c.th);
  if (c.area < 3) return;
  g.save(); g.translate(c.x, c.y); g.rotate(c.ang + Math.PI/2); g.globalAlpha = alpha;
  g.shadowColor = 'rgba(10,14,20,.4)'; g.shadowBlur = 3*dpr; g.shadowOffsetY = 1.5*dpr;
  const grad = g.createLinearGradient(0, -T/2, 0, T/2);
  grad.addColorStop(0, '#6f7780'); grad.addColorStop(.28, '#eef0f2'); grad.addColorStop(.55, '#b3b9c0'); grad.addColorStop(1, '#565e67');
  g.fillStyle = grad; g.beginPath();
  if (g.roundRect) g.roundRect(-L/2, -T/2, L, T, T/2); else g.rect(-L/2, -T/2, L, T);
  g.fill();
  g.shadowColor = 'transparent';
  // bands that drift across the tube so it reads as rolling
  g.strokeStyle = 'rgba(50,56,64,.28)'; g.lineWidth = Math.max(.6, T*.07);
  const k = c.roll % 1;
  for (let i = -2; i <= 2; i++){
    const yy = ((i + k)/2.6)*T/2;
    if (Math.abs(yy) > T*.45) continue;
    g.beginPath(); g.moveTo(-L/2 + T*.45, yy); g.lineTo(L/2 - T*.45, yy); g.stroke();
  }
  // spiral end caps
  for (const sx of [-1, 1]){
    g.save(); g.translate(sx*(L/2 - T*.32), 0);
    g.fillStyle = '#4b525a'; g.beginPath(); g.ellipse(0, 0, T*.26, T*.47, 0, 0, Math.PI*2); g.fill();
    g.strokeStyle = '#d4d8dd'; g.lineWidth = Math.max(.5, T*.06); g.beginPath();
    for (let a = 0; a < Math.PI*3.4; a += .25){
      const rr = T*(.05 + a*.04), px = Math.cos(a + c.roll*5)*rr*.55, py = Math.sin(a + c.roll*5)*rr;
      if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke(); g.restore();
  }
  g.restore();
}
function updateShavings(){
  if (!Shav.c || (!Shav.parts.length && !Curl.active && !Curl.falling.length)) return;
  const c = Shav.c, dpr = state.dpr;
  c.clearRect(0, 0, Shav.cv.width, Shav.cv.height);
  for (const f of Curl.falling){
    f.x += f.vx; f.y += f.vy; f.vy += .22*dpr; f.vx *= .98; f.ang += f.spin; f.roll += .04; f.life -= .011;
    if (f.life > 0) drawCurl(c, f, Math.min(1, f.life*1.6));
  }
  Curl.falling = Curl.falling.filter(f => f.life > 0);
  if (Curl.active) drawCurl(c, Curl.active, 1);
  for (const p of Shav.parts){
    p.x += p.vx; p.y += p.vy; p.vy += .2*dpr; p.vx *= .97; p.rot += p.vr; p.life -= p.decay;
    if (p.life <= 0) continue;
    const s = Math.round(p.shade*(.72 + .38*Math.abs(Math.cos(p.rot))));
    c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, p.life*1.4);
    c.fillStyle = `rgb(${s},${s + 4},${s + 10})`; c.fillRect(-p.w/2, -p.h/2, p.w, p.h); c.restore();
  }
  Shav.parts = Shav.parts.filter(p => p.life > 0);
  if (!Shav.parts.length && !Curl.active && !Curl.falling.length) c.clearRect(0, 0, Shav.cv.width, Shav.cv.height);
}

/* ================= Scratch input ================= */
function localPos(e){   // position in mask pixels
  const r = scratchEl.getBoundingClientRect();
  return {x:(e.clientX - r.left)*state.mw/r.width, y:(e.clientY - r.top)*state.mh/r.height};
}
const PHI = 0.6180339887;
function hash2(x, y){
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function stampPeel(p){   // a coin pass: full clear inside chosen striations, ragged at the edge of the track
  const m = state.mask, mw = state.mw, mh = state.mh, r = state.rM;
  const n = state.passN, d0 = state.passDir0, seed = state.passSeed, frac = Math.min(settings.peelStrength, 100)/100, lw = state.laneW, sl = state.segL, pl = state.pressL;
  const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(mw - 1, Math.ceil(p.x + r));
  const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(mh - 1, Math.ceil(p.y + r));
  const r2 = r*r; let removed = 0;
  for (let y = y0; y <= y1; y++){
    const dy = y + .5 - p.y;
    for (let x = x0; x <= x1; x++){
      const dx = x + .5 - p.x, q = (dx*dx + dy*dy)/r2;
      if (q >= 1) continue;
      const d = Math.sqrt(q);
      if (d > .78 && hash2(x, y) > (1 - d)/.22) continue;          // ragged track edge
      let lane = Math.floor((x*n.x + y*n.y)/lw);
      if (hash2(lane >> 2, seed) < .3) lane = (lane >> 2)*4 + 1000003;   // some passes drag four striations as one wide streak
      const hl = hash2(lane, 104729), len = sl*(.3 + 2.6*hl*hl);           // mostly short dashes, a few long gouges
      const along = x*d0.x + y*d0.y;
      const seg = Math.floor((along + hash2(lane, 7919)*sl*6)/len);
      const t = along/pl, i0 = Math.floor(t), f = t - i0, sm = f*f*(3 - 2*f);
      const press = hash2(i0, seed)*(1 - sm) + hash2(i0 + 1, seed)*sm;    // coin pressure drifts along the stroke, mean 0.5
      if (hash3(lane, seg, seed) >= frac*(.35 + 1.3*press)) continue;   // this dash was skipped on this pass
      const i = y*mw + x; removed += 1 - m[i]; m[i] = 1;
    }
  }
  state.removed = (state.removed || 0) + removed;
  state.maskDirty = true; state.dirty = true;
}
function hash3(a, b, c){ return hash2(a ^ Math.imul(c, 0x9E3779B1), b + Math.imul(c, 0x85EBCA77)); }
function newPass(ux, uy){
  detachCurl(state.lastSpeed || .3);
  state.passDir0 = {x:ux, y:uy}; state.passDir = {x:ux, y:uy};
  state.passN = {x:-uy, y:ux}; state.passSeed = (rng()*2147483647) | 0;
}
function stamp(p){
  if (settings.coat === 'peel'){ if (state.passN) stampPeel(p); return; }
  const m = state.mask, mw = state.mw, mh = state.mh, r = state.rM, s = state.stampS;
  const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(mw - 1, Math.ceil(p.x + r));
  const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(mh - 1, Math.ceil(p.y + r));
  const r2 = r*r;
  for (let y = y0; y <= y1; y++){
    const dy = y + .5 - p.y;
    for (let x = x0; x <= x1; x++){
      const dx = x + .5 - p.x, q = (dx*dx + dy*dy)/r2;
      if (q >= 1) continue;
      const f = (1 - q)*(1 - q);                       // soft falloff, 1 at center
      const i = y*mw + x; m[i] = 1 - (1 - m[i])*(1 - s*f);
    }
  }
  state.maskDirty = true; state.dirty = true;
}
function strokeTo(p){   // stamps at fixed spacing, carrying leftover distance so every pass erases the same amount
  const a = state.last, dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy);
  if (dist === 0) return 0;
  if (settings.coat === 'peel'){
    const an = state.anchor || (state.anchor = {x:a.x, y:a.y});
    const ax = p.x - an.x, ay = p.y - an.y, al = Math.hypot(ax, ay);
    if (al >= 4){
      const ux = ax/al, uy = ay/al, d0 = state.passDir0;
      if (!d0 || ux*d0.x + uy*d0.y < .5) newPass(ux, uy);      // turned more than 60 degrees: a new pass
      else state.passDir = {x:ux, y:uy};
      state.anchor = {x:p.x, y:p.y};
    }
  }
  let t = state.carry || 0, step = state.stepM;
  let traveled = step - t;
  while (traveled <= dist){ stamp({x:a.x + dx*traveled/dist, y:a.y + dy*traveled/dist}); traveled += step; }
  state.carry = step - (traveled - dist);
  state.last = p;
  const cssDist = dist * state.cssW / state.mw;
  state.pathLen += cssDist;
  return cssDist;
}
function bindScratch(){
  scratchEl.addEventListener('pointerdown', e => {
    if (state.revealed) return;
    e.preventDefault();
    if (state.drawing) return;                 // one finger scratches at a time; extra fingers are ignored
    state.pointerId = e.pointerId;
    try{ scratchEl.setPointerCapture(e.pointerId); }catch{}
    state.drawing = true; state.pointerType = e.pointerType; state.strokes++;
    const now = performance.now(); if (!state.firstT) state.firstT = now; state.lastMoveT = now;
    state.last = localPos(e); state.carry = 0;
    state.passDir = state.passDir0 = state.passN = null; state.anchor = null; state.removed = 0;
    stamp(state.last);
    state.lastClient = {x:e.clientX, y:e.clientY};
    Sound.start();
  });
  scratchEl.addEventListener('pointermove', e => {
    if (!state.drawing || state.revealed || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    let moved = 0;
    for (const ev of (evs.length ? evs : [e])) moved += strokeTo(localPos(ev));
    const now = performance.now(), dt = Math.min(now - state.lastMoveT, 100);
    state.drawMs += dt; state.lastMoveT = now;
    const speed = dt > 0 ? moved/dt : 0;               // CSS px per ms
    Sound.move(speed, state.tension || 0);
    if (settings.fxAudio){
      state.hapDist = (state.hapDist || 0) + moved;
      const every = 34 - (state.tension || 0)*14;
      if (state.hapDist > every && now - (state.lastHap || 0) > 35){ state.hapDist = 0; state.lastHap = now; vibrate((state.tension || 0) > .5 ? 8 : 5); }
    }
    const lc = state.lastClient;
    state.lastSpeed = speed;
    if (settings.coat === 'peel') growCurl(e, speed);
    else if (lc) spawnShavings(e, e.clientX - lc.x, e.clientY - lc.y, speed);
    state.lastClient = {x:e.clientX, y:e.clientY};
  });
  const end = e => {
    if (!state.drawing || e.pointerId !== state.pointerId) return;
    detachCurl(state.lastSpeed || .2); state.drawing = false; state.pointerId = null; state.lastClient = null; Sound.stop();
  };
  scratchEl.addEventListener('pointerup', end);
  scratchEl.addEventListener('pointercancel', end);
  scratchEl.addEventListener('lostpointercapture', end);
}

/* ================= Sampling loop ================= */
function sample(){   // average erase amount inside each of the 8x8 cells
  const m = state.mask, mw = state.mw, mh = state.mh;
  for (let cy = 0; cy < 8; cy++){
    const ya = Math.floor(cy*mh/8), yb = Math.floor((cy + 1)*mh/8);
    for (let cx = 0; cx < 8; cx++){
      const xa = Math.floor(cx*mw/8), xb = Math.floor((cx + 1)*mw/8);
      let sum = 0;
      for (let y = ya; y < yb; y++){ let o = y*mw + xa; for (let x = xa; x < xb; x++, o++) sum += m[o]; }
      state.cells[cy*8 + cx] = sum / ((yb - ya)*(xb - xa));
    }
  }
}
function tick(){
  if (state.dirty && !state.revealed && scratchEl){
    state.dirty = false;
    renderScratch();
    sample();
    const st = gridStats(state.cells, state.weights);
    updateMeters(st);
    drawHeat();
    state.tension = settings.fxTension ? clamp((st.meanU/(settings.threshold/100) - .75)/.25, 0, 1) : 0;
    applyTension(state.tension);
    if (st.meanU >= settings.threshold/100) resolve(st);
  }
  if (cardEl){
    if (state.drawing && !state.revealed && state.tension > .5 && !reduceMotion()){
      const a = (state.tension - .5)*2*1.3;
      cardEl.style.translate = `${((rng() - .5)*a).toFixed(2)}px ${((rng() - .5)*a).toFixed(2)}px`;
    } else if (cardEl.style.translate) cardEl.style.translate = '';
  }
  updateShavings();
  requestAnimationFrame(tick);
}
function applyTension(t){
  const g = $('glow'); if (g) g.style.opacity = (t*.55).toFixed(3);
  if (cardEl) cardEl.style.boxShadow = t > 0 ? `0 0 ${Math.round(8 + t*26)}px ${Math.round(t*3)}px rgba(255,210,140,${(t*.55).toFixed(2)}), 0 14px 30px -12px rgba(10,20,30,.45)` : '';
}

function updateMeters(st){
  $('mCov').textContent = Math.round(st.meanU*100) + '%';
  $('mSigW').textContent = st.sigmaW.toFixed(3);
  $('mSigU').textContent = st.sigmaU.toFixed(3);
  const g = st.meanU > 0.02 ? gradeFor(st.sigmaW, settings) : null;
  $('mGrade').innerHTML = g ? `<span class="g-${g}">${g}</span>` : '–';
  $('covFill').style.width = Math.min(100, st.meanU*100) + '%';
}
function placeTick(){ $('covTick').style.left = settings.threshold + '%'; }

function drawHeat(){
  if (!heatCtx) return;
  const W = heatEl.width, H = heatEl.height;
  heatCtx.clearRect(0, 0, W, H);
  const mode = settings.heat;
  if (settings.tester || mode === 'off') return;
  if (mode === 'on' && state.revealed) return;
  const cw = W/8, ch = H/8;
  heatCtx.font = `600 ${Math.round(ch*.32)}px ui-monospace, monospace`;
  heatCtx.textAlign = 'center'; heatCtx.textBaseline = 'middle';
  const wmax = Math.max(...state.weights);
  for (let i = 0; i < 64; i++){
    const x = (i % 8)*cw, y = ((i/8)|0)*ch, c = state.cells[i], w = state.weights[i]/wmax;
    heatCtx.fillStyle = `hsla(${Math.round(10 + c*140)}, 85%, 50%, ${0.18 + 0.32*w})`;
    heatCtx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    if (w < 0.05){ heatCtx.strokeStyle = 'rgba(20,20,20,.35)'; heatCtx.beginPath(); heatCtx.moveTo(x, y); heatCtx.lineTo(x + cw, y + ch); heatCtx.stroke(); }
    if (mode === 'always'){ heatCtx.fillStyle = 'rgba(10,14,20,.85)'; heatCtx.fillText(Math.round(c*100), x + cw/2, y + ch/2); }
  }
}

/* ================= Chance Factor race (experimental: Feel › Chance Factor race) =================
   All four Chance Factors share one range per card and are rolled together at the reveal line, like every other
   value. Once the coating locks, any residue lifts and the four race up to their values in full view; the highest
   takes the card, the other three crumble, and the single surviving stat fills the panel. The swings during the
   race are presentation, like the print number rolling; the result was fixed at the reveal. */
const RNAME = {probability:'Probability', luck:'Luck', entropy:'Entropy', variance:'Variance'};
const raceRange = card => card.cf.probability;                 // equal ranges: all four use one range per card
const raceGeom = card => { const [lo, hi, fz] = raceRange(card), min = lo - fz*1.6, max = hi + fz*1.6; return {lo, hi, pct:x => clamp((x - min)/(max - min)*100, 0, 100)}; };
function raceLanesHTML(card){
  const g = raceGeom(card);
  return `<div class="race" id="race"><span class="photo" id="racePhoto">Photo finish</span>${STATS.map(k => `<div class="lane" data-k="${k}"><span class="lbl">${STAT_LABEL[k]}</span><div class="tr"><div class="band" style="left:${g.pct(g.lo)}%;width:${g.pct(g.hi) - g.pct(g.lo)}%"></div><div class="ceil" style="left:${g.pct(g.hi)}%"></div><div class="fill" style="width:0"></div></div><span class="v">?</span></div>`).join('')}</div>`;
}
function soloHTML(card, k, v, cls){
  const g = raceGeom(card), gold = v > g.hi;
  return `<div class="solo${gold ? ' gold' : ''}${cls ? ' ' + cls : ''}" data-k="${k}"><div class="name">${RNAME[k]}</div><div class="val">${v.toFixed(1)}</div><div class="trk"><div class="band" style="left:${g.pct(g.lo)}%;width:${g.pct(g.hi) - g.pct(g.lo)}%"></div><div class="mk" style="left:${g.pct(v)}%"></div></div><div class="rng">Range ${g.lo}–${g.hi}</div></div>`;
}
const raceLeader = v => STATS.reduce((a, b) => v[b] > v[a] ? b : a);
// The same roll as today, with all four stats on the card's shared range.
function raceRoll(card, bonus){
  const [lo, hi, fz] = raceRange(card), cf = {}, broke = {};
  for (const k of STATS){
    let v = lo + rng()*(hi - lo) + fz*(((rng() + rng() + rng())/1.5) - 1);
    if (v < lo) v = lo + (lo - v);
    cf[k] = Math.round((v + (bonus || 0))*10)/10; broke[k] = cf[k] > hi ? 'ceiling' : null;
  }
  const winner = raceLeader(cf), s = STATS.map(k => cf[k]).sort((a, b) => b - a);
  return {cf, broke, race:{winner, photo:s[0] - s[1] < 1, lo, hi}};
}
function raceDraw(v){
  const race = $('race'); if (!race) return;
  const g = raceGeom(state.card), lead = raceLeader(v);
  race.querySelectorAll('.lane').forEach(el => {
    const k = el.dataset.k; el.querySelector('.fill').style.width = g.pct(v[k]) + '%'; el.querySelector('.v').textContent = v[k].toFixed(1);
    el.classList.toggle('lead', k === lead && v[k] > g.lo + .05); el.classList.toggle('gold', v[k] > g.hi);
  });
}
async function raceFinish(card, p, alive){
  const race = $('race'); if (!race) return;
  const g = raceGeom(card), R = p.race, bonus = p.die ? p.die.total : 0, skip = () => seq.skip;
  descEl.classList.add('race-fade', 'racing');                  // lift any residue so the race is in full view (not 'peeking': lifting the finger ends a peek)
  const target = {}, wob = {}; STATS.forEach(k => { target[k] = p.chanceFactors[k] - bonus; wob[k] = {ph:rng()*6.28, amp:(5 + rng()*4)*(g.hi - g.lo)/42, f:1.6 + rng()*1.4}; });
  await seqWait(250); if (!alive()) return;
  // Lead changes come from wobble that fades to nothing at the finish, so the bars always land on the real values.
  const D = 1900 + card.rank*80, slowFrom = .78, slowK = R.photo ? 2.6 : 1, t0 = performance.now();
  let lastLead = null, shown = false;
  while (!skip() && alive()){
    const el = performance.now() - t0, fast = D*slowFrom, t = el < fast ? el/D : Math.min(1, slowFrom + (el - fast)/(D*slowK));
    if (R.photo && t > slowFrom && !shown){ shown = true; $('racePhoto').classList.add('on'); }
    const e = 1 - Math.pow(1 - t, 3), cur = {};
    STATS.forEach(k => { const w = wob[k]; cur[k] = t >= 1 ? target[k] : Math.max(g.lo, g.lo + (target[k] - g.lo)*e + w.amp*Math.sin(w.f*t*6.28 + w.ph)*Math.pow(1 - t, 1.6)); });
    raceDraw(cur);
    const lead = raceLeader(cur); if (lastLead && lead !== lastLead && t < .97) Sound.tick(.7); lastLead = lead;
    if (t >= 1) break; await frame();
  }
  if (!alive()) return;
  raceDraw(target);
  const winEl = race.querySelector(`.lane[data-k="${R.winner}"]`);
  winEl.classList.add('win'); Sound.hit(.8); vibrate(18);
  await seqWait(380); if (!alive()) return;
  const dr = descEl.getBoundingClientRect();
  race.querySelectorAll('.lane').forEach(el => {
    if (el === winEl) return;
    el.classList.add('lost');
    if (skip() || reduceMotion()) return;
    const fr = el.querySelector('.tr').getBoundingClientRect(), w = fr.width*g.pct(target[el.dataset.k])/100;
    for (let i = 0; i < 14; i++){
      const f = document.createElement('div'); f.className = 'flake';
      f.style.left = (fr.left - dr.left + rng()*w) + 'px'; f.style.top = (fr.top - dr.top + rng()*fr.height) + 'px'; descEl.appendChild(f);
      f.animate([{transform:'translate(0,0) rotate(0)', opacity:1}, {transform:`translate(${(rng() - .5)*40}px, ${60 + rng()*90}px) rotate(${(rng() - .5)*400}deg)`, opacity:0}],
        {duration:700 + rng()*500, easing:'cubic-bezier(.4,0,.9,.6)', delay:rng()*120, fill:'forwards'}).finished.then(() => f.remove(), () => f.remove());
    }
  });
  if (!skip()) Sound.crack(1);
  await seqWait(480); if (!alive()) return;
  race.querySelectorAll('.lane.lost').forEach(el => el.classList.add('gone'));
  await seqWait(360); if (!alive()) return;
  const before = target[R.winner], final = p.chanceFactors[R.winner];
  race.outerHTML = soloHTML(card, R.winner, before, 'in');
  if (p.die){
    await seqWait(300); if (!alive()) return;
    await rollDieChip(p.die, 420 + card.rank*60, alive); if (!alive()) return;
    const solo = descEl.querySelector('.solo'), t1 = performance.now();
    while (!skip() && alive()){
      const q = Math.min(1, (performance.now() - t1)/450), cur = before + (final - before)*q;
      solo.querySelector('.val').textContent = cur.toFixed(1); solo.querySelector('.mk').style.left = g.pct(cur) + '%';
      if (q >= 1) break; await frame();
    }
    if (!alive()) return;
    descEl.querySelector('.solo').outerHTML = soloHTML(card, R.winner, final);
  }
  if (final > g.hi && !skip()){ Sound.hit(1); vibrate([20, 30, 20]); }
  setTimeout(() => raceUnlift(), 500);
}
function raceUnlift(){ const d = descEl; if (!d) return; d.classList.remove('racing'); setTimeout(() => d.classList.remove('race-fade'), 400); }
function raceSettle(card, p){                                   // the end state, with no animation
  const race = $('race'), solo = descEl.querySelector('.solo');
  const html = soloHTML(card, p.race.winner, p.chanceFactors[p.race.winner]);
  if (race) race.outerHTML = html; else if (solo) solo.outerHTML = html;
  descEl.querySelectorAll('.flake').forEach(f => f.remove());
  if (p.die){ const el = $('vDie'); el.hidden = false; el.className = 'die-chip landed r' + p.die.rank; el.innerHTML = dieChipHTML(p.die, p.die.total); }
  setTimeout(() => raceUnlift(), 300);
}

/* ================= Resolve ================= */
function forceOpts(){ return {holo:$('fHolo').value, print:$('fPrint').value, grade:$('fGrade').value, cf:$('fCF').value, token:$('fToken').value}; }

function resolve(st){
  state.revealed = true; state.drawing = false; Sound.stop();
  state.revealT = performance.now();
  const cells = Array.from(state.cells);
  const computed = gradeFor(st.sigmaW, settings);
  const force = forceOpts();
  const grade = force.grade === 'auto' ? computed : force.grade;
  const die = state.ctx.die ? rollDie(state.ctx.die) : null;
  const p = rollPayload(state.card, grade, force, settings.holoRate, die ? die.total : 0);
  p.die = die;
  if (state.raceMode){ const r = raceRoll(state.card, die ? die.total : 0); p.chanceFactors = r.cf; p.broke = r.broke; p.race = r.race; }
  state.payload = p;
  scratchEl.style.pointerEvents = 'none';
  const pristine = grade === 'Pristine';
  detachCurl(state.lastSpeed || .3);
  state.tension = 0; applyTension(0); if (cardEl) cardEl.style.translate = '';
  const durMs = Math.round(state.revealT - state.firstT);
  const speed = state.drawMs > 0 ? Math.round(state.pathLen/(state.drawMs/1000)) : 0;
  const row = {
    run: (log.length ? log[log.length-1].run : 0) + 1, at: new Date().toISOString(), card: state.card.id, rank: state.card.rank,
    threshold: settings.threshold, weighting: settings.weight + (settings.weight === 'gaussian' ? '@' + settings.spread : ''), brush: settings.brush, strength: settings.coat === 'peel' ? settings.peelStrength : settings.strength,
    coverage: +st.meanU.toFixed(4), sigmaW: +st.sigmaW.toFixed(4), sigmaU: +st.sigmaU.toFixed(4), computedGrade: computed, grade,
    holo: p.isHolo, print: p.printNumber, ...p.chanceFactors,
    broke: STATS.filter(k => p.broke[k]).map(k => k + ':' + p.broke[k]).join(' '), token: p.microGameToken,
    durationMs: durMs, strokes: state.strokes, speedPxS: speed, pointer: state.pointerType, forced: Object.entries(force).filter(([,v]) => v !== 'auto').map(([k,v]) => k+'='+v).join(' '),
    haze: settings.haze, peeks: 0, fx: [settings.coat].concat(['Shavings','Audio','Tension','Staged'].filter(k => settings['fx' + k]).map(k => k === 'Shavings' ? 'Debris' : k)).join(' '),
    dieRank: die ? die.rank : '', dieRoll: die ? die.total : '',
    raceWinner: p.race ? p.race.winner : '', racePhoto: p.race ? p.race.photo : '',
    cells: cells.map(c => +c.toFixed(3))
  };
  state.row = row;
  log.push(row); if (log.length > 100) log = log.slice(-100);   // each row carries 64 grid values; keep storage small
  store.set('log', log);
  renderLog();
  if (window.Pilot) window.Pilot.onReveal({row, payload:p, card:state.card, ctx:state.ctx, pristine});
  if (settings.fxStaged && !reduceMotion()) stagedReveal(state.card, p, pristine, row);
  else {
    fillDescriptor(state.card, p);
    if (pristine) wipeClean(); else freezeResidue();   // the real erase pattern stays on this copy
    if (p.isHolo) cardEl.classList.add('holo');
    celebrate(state.card.rank, p.isHolo, pristine);
    finishReveal(row, p, pristine);
  }
}
function finishReveal(row, p, pristine){
  descEl.classList.remove('unknown');
  renderSlab(row, p);
  drawHeat();
  $('hint').textContent = pristine ? 'Pristine. The panel wiped clean.' : residueHint();
  if (window.Pilot) window.Pilot.onFinish({row, payload:p, pristine});
}

/* ---------- Staged reveal: same payload, presented in sequence ---------- */
const frame = () => new Promise(r => requestAnimationFrame(r));
function setVal(id, text){ const el = $(id); el.textContent = text; el.classList.remove('land'); void el.offsetWidth; el.classList.add('land'); }
function cfGeom(card, k){
  const [lo, hi, fz] = card.cf[k], min = lo - fz*1.6, max = hi + fz*1.6;
  return {lo, hi, pct: x => clamp((x - min)/(max - min)*100, 0, 100)};
}
async function stagedReveal(card, p, pristine, row){
  const token = ++seq.id; seq.running = true; seq.skip = false;
  const alive = () => token === seq.id;
  const wait = seqWait;
  const R = card.rank, gap = 130 + R*30;
  Sound.crack(R); vibrate(20);
  if (!reduceMotion()) cardEl.animate([{transform:'scale(1)'}, {transform:'scale(1.018)'}, {transform:'scale(1)'}], {duration:240, easing:'ease-out'});
  if (pristine) wipeClean(); else freezeResidue();
  if (p.race){ await raceFinish(card, p, alive); if (!alive()) return; if (seq.skip) raceSettle(card, p); }
  await wait(170 + R*40); if (!alive()) return;
  setVal('vHolo', p.isHolo ? 'Holo' : 'Normal'); Sound.land(0);
  if (p.isHolo){ cardEl.classList.add('holo'); if (pristine) celebrate(R, true, true); else Sound.hit(.6); }
  await wait(gap); if (!alive()) return;
  if (p.printNumber > 0){
    await rollPrint(card.run.size, p.printNumber, 360 + R*110, alive); if (!alive()) return;
    const low = p.printNumber <= Math.max(3, Math.ceil(card.run.size*.02));
    if (low && !seq.skip){ Sound.hit(1); vibrate([15, 30, 15]); $('vPrint').animate([{transform:'scale(1)'}, {transform:'scale(1.25)'}, {transform:'scale(1)'}], {duration:320}); }
    else Sound.land(1);
  } else { setVal('vPrint', 'Evergr.'); Sound.land(1); }
  await wait(gap); if (!alive()) return;
  setVal('vToken', p.microGameToken); Sound.land(2);
  await wait(gap); if (!alive()) return;
  if (p.die && !p.race){ await rollDieChip(p.die, 420 + R*60, alive); if (!alive()) return; await wait(gap*.7); if (!alive()) return; }
  if (!p.race) await Promise.all(STATS.map((k, i) => countCF(card, p, k, i*90, 380 + R*60, alive)));
  if (!alive()) return;
  await wait(gap*.8); if (!alive()) return;
  showGrade(p.grade, !seq.skip);   // the verdict on how you scratched is stamped on last
  if (!(p.isHolo && pristine)) Sound.reveal(R, false);
  seq.running = false;
  finishReveal(row, p, pristine);
}
async function rollPrint(size, final, dur, alive){
  const el = $('vPrint'); el.classList.add('land');
  const t0 = performance.now(); let lastT = 0;
  while (!seq.skip && alive()){
    const now = performance.now(), k = (now - t0)/dur; if (k >= 1) break;
    if (now - lastT > 40 + 170*k*k){ lastT = now; el.textContent = `${1 + Math.floor(rng()*size)}/${size}`; Sound.tick(1); }
    await frame();
  }
  if (alive()) setVal('vPrint', `${final}/${size}`);
}
// The die tumbles through random faces, then lands on its total; the stats then count up with the bonus included.
function dieChipHTML(die, total){ return `<span class="die-face">${dieName(die.rank)}</span><b>+${total}</b>`; }
async function rollDieChip(die, dur, alive){
  const el = $('vDie'); if (!el) return;
  el.hidden = false; el.className = 'die-chip rolling r' + die.rank;
  const [n, d] = DICE[die.rank], t0 = performance.now(); let lastT = 0;
  while (!seq.skip && alive()){
    const now = performance.now(), k = (now - t0)/dur; if (k >= 1) break;
    if (now - lastT > 45 + 160*k*k){ lastT = now; let t = 0; for (let i = 0; i < n; i++) t += 1 + Math.floor(rng()*d); el.innerHTML = dieChipHTML(die, t); Sound.tick(.8); }
    await frame();
  }
  if (!alive()) return;
  el.innerHTML = dieChipHTML(die, die.total); el.className = 'die-chip landed r' + die.rank;
  if (!seq.skip){ Sound.hit(.7); vibrate(16); }
}
async function countCF(card, p, k, delay, dur, alive){
  await seqWait(delay);
  if (!alive()) return;
  const g = cfGeom(card, k), v = p.chanceFactors[k], el = $('c-' + k), tr = $('t-' + k);
  tr.innerHTML = `<div class="band" style="left:${g.pct(g.lo)}%; width:${g.pct(g.hi) - g.pct(g.lo)}%"></div><div class="mark" style="left:${g.pct(g.lo)}%"></div>`;
  const mk = tr.querySelector('.mark'); el.classList.add('land');
  const t0 = performance.now(); let lastT = 0;
  while (!seq.skip && alive()){
    const now = performance.now(), q = Math.min(1, (now - t0)/dur), e = 1 - Math.pow(1 - q, 3), cur = g.lo + (v - g.lo)*e;
    el.textContent = cur.toFixed(1); mk.style.left = g.pct(cur) + '%';
    if (now - lastT > 60){ lastT = now; Sound.tick(.45); }
    if (q >= 1) break;
    await frame();
  }
  if (!alive()) return;
  el.textContent = v.toFixed(1); mk.style.left = g.pct(v) + '%';
  if (p.broke[k]){
    mk.classList.add('broke'); el.classList.add('broke');
    if (!seq.skip){ Sound.hit(1); vibrate([20, 30, 20]); if (!reduceMotion()) cardEl.animate([{translate:'0 0'}, {translate:'-3px 0'}, {translate:'3px 0'}, {translate:'-2px 0'}, {translate:'0 0'}], {duration:260}); }
  }
}
function residueHint(){
  return store.get('peekSeen', false) ? 'Your scratch pattern is frozen on this copy as residue. Hold the panel to read through it.'
    : 'Hold the panel to read through the residue.';
}
function freezeResidue(){
  state.frozen = true; state.maskDirty = true; renderScratch();   // redraw without the "scratch here" label
  scratchEl.style.opacity = settings.haze/100;
  descEl.classList.add('residue');
}
function bindPeek(){
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; descEl.classList.remove('peeking'); };
  descEl.addEventListener('pointerdown', e => {
    if (!state.frozen || seq.running) return;
    e.preventDefault();
    clearTimeout(timer);
    timer = setTimeout(() => {
      descEl.classList.add('peeking'); vibrate(12);
      if (state.row){ state.row.peeks++; store.set('log', log); }
      if (window.Pilot) window.Pilot.event('peek', {where:'scratch', card:state.card.id});
      if (!store.get('peekSeen', false)){ store.set('peekSeen', true); $('hint').textContent = residueHint(); }
    }, 250);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(t => descEl.addEventListener(t, stop));
  cardEl.addEventListener('contextmenu', e => e.preventDefault());
}

function fillDescriptor(card, p){
  descEl.classList.remove('unknown'); descEl.classList.add('resolving');
  $('vHolo').textContent = p.isHolo ? 'Holo' : 'Normal';
  $('vPrint').textContent = p.printNumber > 0 ? `${p.printNumber}/${card.run.size}` : 'Evergr.';
  if (p.die){ const el = $('vDie'); el.hidden = false; el.className = 'die-chip landed r' + p.die.rank; el.innerHTML = dieChipHTML(p.die, p.die.total); }
  showGrade(p.grade, false);
  $('vToken').textContent = p.microGameToken;
  if (p.race){ raceSettle(card, p); return; }
  for (const k of STATS){
    const [lo, hi, fz] = card.cf[k], v = p.chanceFactors[k];
    const min = lo - fz*1.6, max = hi + fz*1.6, pct = x => Math.max(0, Math.min(100, (x - min)/(max - min)*100));
    $('t-' + k).innerHTML = `<div class="band" style="left:${pct(lo)}%; width:${pct(hi) - pct(lo)}%"></div><div class="mark${p.broke[k] ? ' broke' : ''}" style="left:${pct(v)}%"></div>`;
    const el = $('c-' + k); el.textContent = v.toFixed(1); el.classList.toggle('broke', !!p.broke[k]);
  }
}

function wipeClean(){
  const W = scratchEl.width, H = scratchEl.height, t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 520;
  state.wiping = true;
  const step = now => {
    const k = Math.min(1, (now - t0)/dur);
    ctx.globalCompositeOperation = 'destination-out';
    const x = -H + (W + 2*H)*k;
    const g = ctx.createLinearGradient(x - H, 0, x, 0);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, Math.max(0, x - H), H);
    if (k < 1) requestAnimationFrame(step); else { ctx.clearRect(0, 0, W, H); state.wiping = false; }
  };
  requestAnimationFrame(step);
}

/* ================= Celebration ================= */
function celebrate(rank, holo, pristine){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  Sound.reveal(rank, holo && pristine);
  vibrate(holo && pristine ? [30, 40, 30, 40, 60] : [25]);
  if (!(holo && pristine) || reduce) return;
  const fl = $('flash'), peak = 0.35 + 0.13*rank;
  fl.animate([{opacity:0}, {opacity:peak, offset:.15}, {opacity:0}], {duration:700 + rank*120, easing:'ease-out'});
  const cv = $('burst'), r = cv.getBoundingClientRect(), dpr = state.dpr;
  cv.width = r.width*dpr; cv.height = r.height*dpr;
  const bc = cv.getContext('2d'), N = 14 + rank*14, cx = cv.width/2, cy = cv.height*0.66;
  const parts = Array.from({length:N}, () => { const a = rng()*Math.PI*2, v = (2 + rng()*5 + rank)*dpr; return {x:cx, y:cy, vx:Math.cos(a)*v, vy:Math.sin(a)*v - 2*dpr, life:1, hue:Math.floor(rng()*360), s:(1.5 + rng()*2.5)*dpr}; });
  const go = () => {
    bc.clearRect(0, 0, cv.width, cv.height);
    let alive = false;
    for (const p of parts){
      if (p.life <= 0) continue; alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.12*dpr; p.vx *= .985; p.life -= 0.016;
      bc.globalAlpha = Math.max(0, p.life); bc.fillStyle = `hsl(${p.hue} 95% 70%)`;
      bc.beginPath(); bc.arc(p.x, p.y, p.s, 0, Math.PI*2); bc.fill();
    }
    if (alive) requestAnimationFrame(go); else bc.clearRect(0, 0, cv.width, cv.height);
  };
  requestAnimationFrame(go);
}
function vibrate(p){ try{ if (navigator.vibrate) navigator.vibrate(p); }catch{} }

/* ================= Sound ================= */
const Sound = (() => {
  let ac = null, nbuf = null, hiss = null, hissGain = null, hissFilt = null, riser = null, riserGain = null, lastGrain = 0;
  function ctxOk(){
    if (!settings.sound) return null;
    try{ if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); }catch{ return null; }
    return ac;
  }
  function buf(){
    if (!nbuf){ const len = ac.sampleRate*2; nbuf = ac.createBuffer(1, len, ac.sampleRate); const ch = nbuf.getChannelData(0); for (let i = 0; i < len; i++) ch[i] = Math.random()*2 - 1; }
    return nbuf;
  }
  function ensureHiss(){
    if (hiss || !ac) return;
    hiss = ac.createBufferSource(); hiss.buffer = buf(); hiss.loop = true;
    hissFilt = ac.createBiquadFilter(); hissFilt.type = 'bandpass'; hissFilt.frequency.value = 2400; hissFilt.Q.value = .8;
    hissGain = ac.createGain(); hissGain.gain.value = 0;
    hiss.connect(hissFilt).connect(hissGain).connect(ac.destination); hiss.start();
  }
  function ensureRiser(){
    if (riser || !ac) return;
    riser = ac.createOscillator(); riser.type = 'sawtooth'; riser.frequency.value = 80;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    riserGain = ac.createGain(); riserGain.gain.value = 0;
    riser.connect(lp).connect(riserGain).connect(ac.destination); riser.start();
  }
  function noiseHit(t, dur, f, q, vol, type){
    const src = ac.createBufferSource(); src.buffer = buf();
    const fl = ac.createBiquadFilter(); fl.type = type || 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(fl).connect(g).connect(ac.destination); src.start(t, Math.random()*1.8, dur + .03);
  }
  function tone(f, t, dur, type, vol, f2){
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + .05);
  }
  return {
    start(){ if (!ctxOk()) return; ensureHiss(); if (settings.fxTension) ensureRiser(); },
    move(v, tension){
      if (!ac || !hissGain || !settings.sound) return;
      const now = ac.currentTime;
      if (settings.fxAudio){
        hissGain.gain.setTargetAtTime(Math.min(.03, v*.018), now, .03);
        hissFilt.frequency.setTargetAtTime(3000*(1 + tension*.4), now, .05);
        const peel = settings.coat === 'peel';
        const interval = peel ? Math.max(.016, .07 - v*.024) : Math.max(.011, .06 - v*.022);
        if (v > .05 && now - lastGrain > interval){
          lastGrain = now;
          if (peel) noiseHit(now, .015 + Math.random()*.03, (850 + Math.random()*1700)*(1 + tension*.45), .9 + Math.random()*1.4, Math.min(.26, .06 + v*.08));
          else noiseHit(now, .008 + Math.random()*.02, (2000 + Math.random()*2800)*(1 + tension*.45), 1.4 + Math.random()*2.5, Math.min(.24, .06 + v*.08));
        }
      } else {
        hissGain.gain.setTargetAtTime(Math.min(.12, v*.06), now, .03);
        hissFilt.frequency.setTargetAtTime(1800 + Math.min(3000, v*900), now, .05);
      }
      if (riserGain){ riserGain.gain.setTargetAtTime(settings.fxTension ? tension*.03 : 0, now, .08); riser.frequency.setTargetAtTime(75 + tension*95, now, .12); }
    },
    stop(){ if (!ac) return; const now = ac.currentTime; if (hissGain) hissGain.gain.setTargetAtTime(0, now, .05); if (riserGain) riserGain.gain.setTargetAtTime(0, now, .06); },
    stamp(){ if (!ctxOk()) return; const t = ac.currentTime + .005; tone(110, t, .22, 'sine', .3, 42); noiseHit(t, .06, 900, .8, .22, 'lowpass'); noiseHit(t + .01, .03, 3200, 2, .06); },
    crack(rank){ if (!ctxOk()) return; const t = ac.currentTime + .005; noiseHit(t, .11, 1700, .7, .3 + rank*.03); tone(150, t, .28, 'sine', .22, 45); },
    crinkle(size){
      if (!ctxOk()) return;
      const t = ac.currentTime, n = 3 + Math.round((size || .5)*3);
      for (let i = 0; i < n; i++) noiseHit(t + i*.014 + Math.random()*.008, .01 + Math.random()*.012, 2500 + Math.random()*3500, 3, .09);
      tone(220, t, .08, 'sine', .05*(size || .5), 140);
    },
    tick(vol){ if (!ctxOk()) return; noiseHit(ac.currentTime, .012, 5200, 5, .1*(vol || 1)); },
    land(i){ if (!ctxOk()) return; const t = ac.currentTime; tone(330*Math.pow(1.19, i), t, .14, 'sine', .09); noiseHit(t, .02, 3000, 2, .05); },
    hit(strength){ if (!ctxOk()) return; const t = ac.currentTime, s = strength || 1; tone(1760, t, .55, 'triangle', .08*s); tone(2637, t + .04, .55, 'sine', .05*s); tone(110, t, .25, 'sine', .16*s, 70); },
    reveal(rank, big){
      if (!ctxOk()) return;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98], t = ac.currentTime + .02;
      for (let i = 0; i <= rank; i++) tone(notes[i], t + i*.075, .5, 'triangle', .11);
      if (big) for (let i = 0; i < 6 + rank*2; i++) tone(2093 + rng()*1800, t + .25 + i*.045, .25, 'sine', .035);
    }
  };
})();

/* ================= Slab and log ================= */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function renderSlab(row, p){
  const card = state.card;
  // Race copies keep one Chance Factor: show the winner on the card's shared range, and the three it beat on one line.
  const cfLines = p.race ? (() => { const w = p.race.winner, [lo, hi] = raceRange(card), b = p.broke[w];
      const rest = STATS.filter(k => k !== w).sort((a, c) => p.chanceFactors[c] - p.chanceFactors[a]).map(k => `${STAT_LABEL[k]} ${p.chanceFactors[k].toFixed(1)}`).join(', ');
      return `<dt>${RNAME[w]}</dt><dd>${p.chanceFactors[w].toFixed(1)} <span style="color:var(--muted)">(${lo}–${hi})</span>${b ? ` <span class="flag">broke the ${b}</span>` : ''}</dd>
        <dt>Race</dt><dd><span style="color:var(--muted)">Won over ${rest}${p.race.photo ? ', photo finish' : ''}</span></dd>${p.die ? `<dt>Die</dt><dd>${RANKS[p.die.rank - 1]} ${dieName(p.die.rank)}, +${p.die.total}</dd>` : ''}`; })()
    : STATS.map(k => {
    const [lo, hi] = card.cf[k], b = p.broke[k];
    return `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${p.chanceFactors[k].toFixed(1)} <span style="color:var(--muted)">(${lo}–${hi})</span>${b ? ` <span class="flag">broke the ${b}</span>` : ''}</dd>`;
  }).join('');
  const lab = settings.tester ? '' : `
      <dt>σ weighted</dt><dd>${row.sigmaW.toFixed(3)}</dd>
      <dt>σ raw</dt><dd>${row.sigmaU.toFixed(3)}</dd>
      <dt>Computed grade</dt><dd>${row.computedGrade}${row.grade !== row.computedGrade ? ' (forced to ' + row.grade + ')' : ''}</dd>
      <dt>Coverage at reveal</dt><dd>${(row.coverage*100).toFixed(1)}%</dd>
      <dt>Scratch time</dt><dd>${(row.durationMs/1000).toFixed(1)} s · ${row.strokes} strokes</dd>
      <dt>Avg stroke speed</dt><dd>${row.speedPxS} px/s</dd>`;
  $('slabWrap').innerHTML = `
  <div class="slab">
    <div class="slab-head">
      <div><div class="t">${esc(card.name)}</div><div class="s">Harbor Lights · Launch · ${RANKS[card.rank-1]}${card.run ? ' · Run ' + card.run.label : ''}</div></div>
      <div class="slab-grade"><div class="g g-${p.grade}">${p.grade}</div><div class="cert">Cert #${String(row.run).padStart(6, '0')}</div></div>
    </div>
    <dl class="kv">
      <dt>Finish</dt><dd>${p.isHolo ? 'Holo' : 'Normal'}</dd>
      <dt>Print</dt><dd>${p.printNumber > 0 ? p.printNumber + ' / ' + card.run.size : 'Evergreen, no print number'}</dd>
      <dt>Token</dt><dd>${p.microGameToken}</dd>
      ${cfLines}
      ${lab}
    </dl>
  </div>`;
}
function renderLog(){
  $('logBody').innerHTML = log.slice(-25).reverse().map(r => `<tr><td>${r.run}</td><td>${esc(r.card)}</td><td class="g-${r.grade}">${r.grade}</td><td>${r.sigmaW.toFixed(3)}</td><td>${r.holo ? 'Holo' : '–'}</td><td>${r.print > 0 ? r.print : '–'}</td><td>${(r.durationMs/1000).toFixed(1)}s</td><td>${r.speedPxS}</td></tr>`).join('') || `<tr><td colspan="8" style="color:var(--muted)">No cards scratched yet.</td></tr>`;
}
function toCSV(){
  const cols = ['run','at','card','rank','threshold','weighting','brush','strength','coverage','sigmaW','sigmaU','computedGrade','grade','holo','print',...STATS,'broke','token','durationMs','strokes','speedPxS','pointer','forced','haze','peeks','fx'];
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = cols.concat(Array.from({length:64}, (_, i) => 'c' + i)).join(',');
  return [head, ...log.map(r => cols.map(c => q(r[c])).concat((r.cells || []).map(q)).join(','))].join('\n');
}

/* ================= Controls ================= */
function newCard(card, ctx){
  if (!card){ const id = $('cardPick').value; card = id === 'random' ? pick(CARDS) : CARDS.find(c => c.id === id); }
  state.card = card; state.ctx = ctx || {};
  state.raceMode = !!settings.fxRace;
  Object.assign(state, {payload:null, revealed:false, drawing:false, last:null, strokes:0, pathLen:0, drawMs:0, firstT:0, revealT:0, dirty:true});
  state.cells = new Float64Array(64); state.mask = null; state.frozen = false; state.row = null;
  $('slabWrap').innerHTML = '<div class="panel empty">The grading slab appears here once the card resolves. It always shows the true values, however messy the scratch.</div>';
  Curl.active = null; Curl.falling = [];
  seqSkip(); seq.id++; seq.running = false; seq.skip = false; state.tension = 0; state.lastClient = null; state.hapDist = 0; Sound.stop();
  renderCard(state.card, state.ctx.provenance);
  updateMeters({meanU:0, sigmaW:0, sigmaU:0});
  $('hint').textContent = 'Scratch the lower panel. Everything under it rolls the moment you pass the reveal line.';
}

function bindRange(id, key, fmt, after){
  const el = $(id), out = $('o' + id.slice(1));
  el.value = settings[key];
  const show = () => { if (out) out.textContent = fmt(+el.value); };
  show();
  el.addEventListener('input', () => { settings[key] = +el.value; show(); store.set('settings', settings); after && after(); });
}
function initControls(){
  $('cardPick').innerHTML = `<option value="random">Draw by rank odds</option>` + CARDS.map(c => `<option value="${c.id}">${c.name} · ${RANKS[c.rank-1]}</option>`).join('');
  $('cardPick').value = settings.card;
  $('cardPick').addEventListener('change', () => { settings.card = $('cardPick').value; store.set('settings', settings); });

  const regrade = () => { state.weights = makeWeights(settings.weight, settings.spread); state.dirty = true; if (!state.revealed) { const st = gridStats(state.cells, state.weights); updateMeters(st); } drawHeat(); };
  bindRange('sThreshold', 'threshold', v => v + '%', placeTick);
  bindRange('sBrush', 'brush', v => v + '%', updateBrush);
  const strKey = () => settings.coat === 'peel' ? 'peelStrength' : 'strength';
  const sEl = $('sStrength'), sOut = $('oStrength');
  const strShow = () => { sEl.value = settings[strKey()]; sOut.textContent = settings[strKey()] + '%'; };
  strShow();
  sEl.addEventListener('input', () => { settings[strKey()] = +sEl.value; sOut.textContent = sEl.value + '%'; store.set('settings', settings); updateBrush(); });
  bindRange('sSpread', 'spread', v => (v/100).toFixed(2), regrade);
  bindRange('sPristine', 'pristine', v => (v/100).toFixed(3), regrade);
  bindRange('sGood', 'good', v => (v/100).toFixed(3), regrade);
  bindRange('sFair', 'fair', v => (v/100).toFixed(3), regrade);
  bindRange('sHoloRate', 'holoRate', v => v + '%');
  const coat = $('sCoat'); coat.value = settings.coat;
  coat.addEventListener('change', () => {
    settings.coat = coat.value; store.set('settings', settings); updateBrush(); strShow();
    if (!state.revealed || state.frozen){ state.maskDirty = true; renderScratch(); }
  });
  for (const k of ['Shavings','Audio','Tension','Staged','Race']){
    const el = $('fx' + k); el.checked = !!settings['fx' + k];
    el.addEventListener('change', () => {
      settings['fx' + k] = el.checked; store.set('settings', settings);
      if (k === 'Tension' && !el.checked){ state.tension = 0; applyTension(0); }
    });
  }
  stage.addEventListener('pointerdown', () => { if (seq.running) seqSkip(); });
  bindRange('sHaze', 'haze', v => v + '%', () => { if (state.frozen) scratchEl.style.opacity = settings.haze/100; });
  const w = $('sWeight'); w.value = settings.weight;
  const spreadVis = () => { $('rowSpread').hidden = settings.weight !== 'gaussian'; };
  spreadVis();
  w.addEventListener('change', () => { settings.weight = w.value; store.set('settings', settings); spreadVis(); regrade(); });
  const h = $('sHeat'); h.value = settings.heat;
  h.addEventListener('change', () => { settings.heat = h.value; store.set('settings', settings); drawHeat(); });

  const sb = $('soundBtn');
  const sShow = () => { sb.setAttribute('aria-pressed', settings.sound); sb.textContent = settings.sound ? 'Sound on' : 'Sound off'; };
  sShow(); sb.addEventListener('click', () => { settings.sound = !settings.sound; store.set('settings', settings); sShow(); if (!settings.sound) Sound.stop(); });

  const tb = $('testerBtn');
  const tShow = () => { tb.setAttribute('aria-pressed', settings.tester); app.classList.toggle('tester', settings.tester); drawHeat(); };
  tShow(); tb.addEventListener('click', () => { settings.tester = !settings.tester; store.set('settings', settings); tShow(); if (state.revealed && log.length) renderSlab(log[log.length-1], state.payload); });

  $('copyCsv').addEventListener('click', () => {
    const csv = toCSV(), ta = $('csvOut');
    const fallback = () => { ta.hidden = false; ta.value = csv; ta.focus(); ta.select(); $('logNote').textContent = 'Clipboard unavailable here. The CSV is selected below; copy it manually.'; };
    try{
      navigator.clipboard.writeText(csv).then(() => { $('logNote').textContent = `Copied ${log.length} rows.`; ta.hidden = true; }, fallback);
    }catch{ fallback(); }
  });
  let armed = false;
  $('clearLog').addEventListener('click', () => {
    if (!armed){ armed = true; $('clearLog').textContent = 'Tap again to clear'; setTimeout(() => { armed = false; $('clearLog').textContent = 'Clear log'; }, 3000); return; }
    log = []; store.set('log', log); renderLog(); armed = false; $('clearLog').textContent = 'Clear log'; $('logNote').textContent = 'Log cleared.';
  });
}

/* ================= Boot ================= */
state.weights = makeWeights(settings.weight, settings.spread);
initControls(); placeTick(); renderLog();
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (scratchEl && !state.revealed) sizeCanvases(false); if (Shav.cv) shavInit(); }, 120); });
requestAnimationFrame(tick);

// Test hook
window.__lab = {state, settings, seq, makeWeights, gridStats, gradeFor, rollPayload, CARDS, get log(){ return log; }};
window.Engine = {newCard, CARDS, RANKS, STATS, STAT_LABEL, artSVG, pipRow, paintSurface, cfGeom, settings, state, store, esc, rng, Sound,
  ballToken, BALL_COL, DICE, dieName, rollDie, dieChipHTML, soloHTML, RNAME,
  get revealed(){ return state.revealed; }, get started(){ return state.strokes > 0; }, get sequenceRunning(){ return seq.running; }};
})();
