/* Pecan Pie shared world: every phone builds the same spots from the same map data.

   The world is cut into sectors 0.01 degrees square (about 1 km), named by grid position (s_<x>_<y>), the same
   convention as the Apple Pie project. A sector's spots come only from:
     1. a pinned snapshot of OpenFreeMap vector tiles (identical bytes for every phone), and
     2. seeded randomness keyed to the sector id (never Math.random or crypto).
   So two players in the same place see the same spots, with the same ids, without a server. In production a server
   would run this same generator once per sector and store the result (Apple Pie decision 010); this file is shaped
   so it can move there.

   Determinism notes. Spot ids, picks and order depend only on integers, hashes and correctly rounded arithmetic.
   Coordinates pass through Math.cos/atan/sinh, which engines may round differently in the last bit, so positions are
   quantized (0.1 m locally, 6 decimal places on output) before anything compares them. A choice could still differ
   only for a point within a hair of a threshold, which is rare and costs at most one spot.

   Privacy: node ids are opaque hashes, so logging an id never reveals a place. */
(() => {
'use strict';

const SNAPSHOT = '20261101_080013_pt';                       // pinned for the pilot: a new snapshot would move spots
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const tileUrl = (snap, x, y) => `https://tiles.openfreemap.org/planet/${snap}/14/${x}/${y}.pbf`;
const Z = 14, N = 2 ** Z, SECTOR = 0.01;
const CARD_MAX = 12, WALK_UNTIL = 8, CARD_MIN = 6, DICE = 2, SPACING = 45, MARGIN = 60, CELL = 50;
const WALK_CLEAR = {road:15, rail:15, waterway:8, water:true};
const POI_CLEAR = {road:6, rail:10, waterway:0, water:true};
const POI_DRY = {road:6, rail:10, waterway:0, water:false};

/* ---------- Seeded randomness (same functions as Apple Pie's shared/rng.js) ---------- */
function hash32(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed){
  let a = (typeof seed === 'string' ? hash32(seed) : seed) >>> 0;
  return function next(){
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unit = key => hash32(key) / 4294967296;
const nodeId = key => 'n' + hash32(key).toString(36) + hash32('#' + key).toString(36);
function shuffled(list, r){ const a = list.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r()*(i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const q1 = v => Math.round(v*10)/10;                         // 0.1 m
const q6 = v => Math.round(v*1e6)/1e6;                       // about 0.1 m in degrees
const rad = d => d*Math.PI/180;

/* ---------- Sector grid ---------- */
const sectorId = (x, y) => `s_${x}_${y}`;
function parseSector(id){ const m = /^s_(-?\d+)_(-?\d+)$/.exec(id); return m ? [+m[1], +m[2]] : null; }
function sectorOf(lat, lng){ return sectorId(Math.floor(lng/SECTOR), Math.floor(lat/SECTOR)); }
/* Sectors touching a circle of r meters around a point (not part of generation, only of what to load). */
function sectorsNear(lat, lng, r){
  const dLat = r/110540, dLng = r/(111320*Math.cos(rad(lat))), out = [];
  for (let x = Math.floor((lng - dLng)/SECTOR); x <= Math.floor((lng + dLng)/SECTOR); x++)
    for (let y = Math.floor((lat - dLat)/SECTOR); y <= Math.floor((lat + dLat)/SECTOR); y++) out.push(sectorId(x, y));
  return out;
}

/* ---------- Minimal Mapbox Vector Tile decoder (protobuf), only what placement needs ---------- */
const utf8 = new TextDecoder();
function varint(b, s){ let v = 0, mul = 1, c; do { c = b[s.p++]; v += (c & 0x7f)*mul; mul *= 128; } while (c & 0x80); return v; }
function skip(b, s, wire){
  if (wire === 0) varint(b, s);
  else if (wire === 1) s.p += 8;
  else if (wire === 2){ const n = varint(b, s); s.p += n; }
  else if (wire === 5) s.p += 4;
  else throw new Error('bad wire type ' + wire);
}
function readValue(b, start, end){
  const s = {p:start}; let v = null;
  while (s.p < end){
    const key = varint(b, s), f = Math.floor(key/8), w = key & 7;
    if (f === 1 && w === 2){ const n = varint(b, s); v = utf8.decode(b.subarray(s.p, s.p + n)); s.p += n; }
    else if (f === 2 && w === 5){ v = new DataView(b.buffer, b.byteOffset + s.p, 4).getFloat32(0, true); s.p += 4; }
    else if (f === 3 && w === 1){ v = new DataView(b.buffer, b.byteOffset + s.p, 8).getFloat64(0, true); s.p += 8; }
    else if ((f === 4 || f === 5) && w === 0) v = varint(b, s);
    else if (f === 6 && w === 0){ const n = varint(b, s); v = n % 2 ? -(n + 1)/2 : n/2; }
    else if (f === 7 && w === 0) v = !!varint(b, s);
    else skip(b, s, w);
  }
  return v;
}
function packed(b, s){ const n = varint(b, s), end = s.p + n, out = []; while (s.p < end) out.push(varint(b, s)); return out; }
function geometry(cmds){
  const parts = []; let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;){
    const c = cmds[i++], id = c & 7, count = c >>> 3;
    if (id === 7){ if (cur && cur.length) cur.push(cur[0]); continue; }
    for (let k = 0; k < count; k++){
      const dx = cmds[i++], dy = cmds[i++];
      x += dx % 2 ? -(dx + 1)/2 : dx/2; y += dy % 2 ? -(dy + 1)/2 : dy/2;
      if (id === 1){ cur = [[x, y]]; parts.push(cur); } else cur.push([x, y]);
    }
  }
  return parts;
}
function decodeTile(buf, want){
  const b = buf, s = {p:0}, layers = {};
  while (s.p < b.length){
    const key = varint(b, s);
    if ((key >>> 3) !== 3 || (key & 7) !== 2){ skip(b, s, key & 7); continue; }
    const len = varint(b, s), end = s.p + len;
    let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    const ls = {p:s.p};
    while (ls.p < end){
      const k = varint(b, ls), f = k >>> 3, w = k & 7;
      if (f === 1 && w === 2){ const n = varint(b, ls); name = utf8.decode(b.subarray(ls.p, ls.p + n)); ls.p += n; }
      else if (f === 2 && w === 2){ const n = varint(b, ls); feats.push([ls.p, ls.p + n]); ls.p += n; }
      else if (f === 3 && w === 2){ const n = varint(b, ls); keys.push(utf8.decode(b.subarray(ls.p, ls.p + n))); ls.p += n; }
      else if (f === 4 && w === 2){ const n = varint(b, ls); vals.push([ls.p, ls.p + n]); ls.p += n; }
      else if (f === 5 && w === 0) extent = varint(b, ls);
      else skip(b, ls, w);
    }
    s.p = end;
    if (!want.includes(name)) continue;
    const values = vals.map(([a, z]) => readValue(b, a, z)), out = [];
    for (const [a, z] of feats){
      const fs = {p:a}; let id = null, type = 0, tags = [], cmds = [];
      while (fs.p < z){
        const k = varint(b, fs), f = k >>> 3, w = k & 7;
        if (f === 1 && w === 0) id = varint(b, fs);
        else if (f === 2 && w === 2) tags = packed(b, fs);
        else if (f === 3 && w === 0) type = varint(b, fs);
        else if (f === 4 && w === 2) cmds = packed(b, fs);
        else skip(b, fs, w);
      }
      const props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      out.push({id, type, props, parts:geometry(cmds)});
    }
    layers[name] = {extent, features:out};
  }
  return layers;
}

/* ---------- Tile fetching ---------- */
let snapUsed = SNAPSHOT, snapNote = 'pinned', latestP = null;
const tileCache = new Map(), TILE_TIMEOUT = 15000;
// A stalled request must fail, not hang: the caller holds a lock while it builds.
async function fetchWithTimeout(url){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TILE_TIMEOUT);
  try{ return await fetch(url, {signal:ctl.signal}); } finally { clearTimeout(t); }
}
async function bytes(res){
  let buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b){
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    buf = new Uint8Array(await ds.arrayBuffer());
  }
  return buf;
}
async function latestSnapshot(){
  const tj = await (await fetchWithTimeout(TILEJSON)).json(), m = /planet\/([^/]+)\/\{z\}/.exec(tj.tiles[0]);
  if (!m) throw new Error('no snapshot in TileJSON');
  return m[1];
}
const LAYERS = ['poi', 'transportation', 'water', 'waterway', 'landuse', 'aeroway'];
const gone = r => r.status === 404 || r.status === 410;
function fetchTile(snap, x, y){
  const key = snap + '/' + x + '/' + y;
  if (!tileCache.has(key)){
    const p = (async () => {
      const res = await fetchWithTimeout(tileUrl(snap, x, y));
      if (res.ok) return decodeTile(await bytes(res), LAYERS);
      if (!gone(res)) throw new Error('tile ' + res.status);
      // A missing tile is not proof the pinned snapshot was retired. Only if the newest snapshot differs AND has this
      // tile do we switch (every phone reaches the same conclusion, so the world stays shared; spots move once and the
      // log records it). Missing from both means there is simply no data there.
      if (snap !== SNAPSHOT) return {};
      const latest = await (latestP = latestP || latestSnapshot().catch(err => { latestP = null; throw err; }));
      if (latest === SNAPSHOT) return {};
      const r2 = await fetchWithTimeout(tileUrl(latest, x, y));
      if (gone(r2)) return {};
      if (!r2.ok) throw new Error('tile ' + r2.status);
      snapUsed = latest; snapNote = 'latest';
      return decodeTile(await bytes(r2), LAYERS);
    })();
    p.catch(() => tileCache.delete(key));
    tileCache.set(key, p);
  }
  return tileCache.get(key);
}

/* ---------- Placement rules ---------- */
// The place types that become card spots, by OpenMapTiles poi subclass (class as a fallback), with a base score.
// Schools, worship, clinics, playgrounds, memorials and private places are simply not on the list.
const KIND = {artwork:['Public art', 9], viewpoint:['Viewpoint', 9], museum:['Museum', 7],
  attraction:['Landmark', 6], monument:['Historic site', 8], castle:['Historic site', 8], ruins:['Historic site', 8],
  park:['Park', 7], garden:['Garden', 6], library:['Library', 7], fountain:['Fountain', 8], clock:['Public clock', 6],
  arts_centre:['Arts center', 6], theatre:['Theater', 6], cinema:['Cinema', 5], community_centre:['Community center', 5],
  townhall:['Town hall', 6], marketplace:['Market', 6], cafe:['Cafe', 5], ice_cream:['Ice cream shop', 5], post_office:['Post office', 4]};
function kindOf(p){
  if (p.class === 'library' && p.subclass !== 'library') return null;             // bookshops share the library class
  // Tiles carry no access tags for places, so the name is the best signal left: unnamed gardens are usually private.
  if (p.subclass === 'garden' && !(p.name || '').trim()) return null;
  return KIND[p.subclass] || null;
}
// Ground no spot may sit on, whatever its kind: restricted, secured or sensitive land. Lighthouses and other places on
// military bases, airfields and school grounds fall out here.
const NO_GO_LANDUSE = new Set(['military', 'school', 'kindergarten', 'playground', 'hospital', 'cemetery', 'railway', 'quarry']);
const NO_GO_AEROWAY = new Set(['aerodrome', 'runway', 'taxiway', 'apron', 'helipad']);
const WATERSIDE = new Set(['Viewpoint']);                      // allowed over water if a public path or pier is in reach
const REACH = 60;
const WALK_KIND = {footway:['Footpath', 1], path:['Trail', 1], pedestrian:['Plaza', 2], cycleway:['Bike path', 0], bridleway:['Bridleway', 0]};
const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway', 'raceway']);
const article = w => /^[aeiou]/i.test(w) ? 'an' : 'a';

function segDist(p, a, b){
  const dx = b.x - a.x, dy = b.y - a.y, L = dx*dx + dy*dy;
  let k = L ? ((p.x - a.x)*dx + (p.y - a.y)*dy)/L : 0; k = k < 0 ? 0 : k > 1 ? 1 : k;
  return Math.hypot(p.x - a.x - k*dx, p.y - a.y - k*dy);
}
function inZones(p, zones){
  for (const rings of zones){ let c = false; for (const r of rings) if (inRing(p, r)) c = !c; if (c) return true; }
  return false;
}
function inRing(p, ring){
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x)*(p.y - a.y)/(b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/* Build one sector. mode: 'osm' (places, then walkable spots), 'walk' (walkable spots only), 'random' (debug).
   names: the pool of made-up spot names. Returns {ok, nodes, stats}. */
async function buildSector(sid, opts = {}){
  const mode = opts.mode || 'osm', names0 = opts.names || [], xy = parseSector(sid);
  if (!xy) throw new Error('bad sector ' + sid);
  const w = xy[0]*SECTOR, s = xy[1]*SECTOR, e = w + SECTOR, n = s + SECTOR;
  const kx = 111320*Math.cos(rad(s + SECTOR/2)), ky = 110540;
  const W = q1(SECTOR*kx), H = q1(SECTOR*ky);
  const toXY = (lat, lng) => ({x:q1((lng - w)*kx), y:q1((lat - s)*ky)});
  const toLL = p => ({lat:q6(s + p.y/ky), lng:q6(w + p.x/kx)});
  const inside = p => p.x >= 0 && p.x < W && p.y >= 0 && p.y < H;
  // Which sector owns a point is decided by integer math on rounded coordinates, so two neighboring sectors can never
  // both claim (or both miss) a place on their shared edge.
  const owns = ll => Math.floor(Math.round(ll.lng*1e6)/10000) === xy[0] && Math.floor(Math.round(ll.lat*1e6)/10000) === xy[1];
  const names = shuffled(names0, rng(sid + ':names'));
  const t0 = Date.now(), stats = {ok:false, tiles:0, fetchMs:0, places:0, walk:0, random:0, dice:0, snapshot:'none'};

  // Map data: the tiles covering the sector plus a margin, so hazards just over the edge still count.
  const segs = new Map(), waters = [], walks = [], pois = new Map(), noGo = [];
  let ok = false;
  if (mode !== 'random' && !opts.offline){                   // offline: the network just failed; go straight to fallback
    try{
      const mLat = MARGIN/ky, mLng = MARGIN/kx;
      const lon2tx = lng => Math.floor((lng + 180)/360*N);
      const lat2ty = lat => Math.floor((1 - Math.asinh(Math.tan(rad(lat)))/Math.PI)/2*N);
      const jobs = [];
      for (let tx = lon2tx(w - mLng); tx <= lon2tx(e + mLng); tx++)
        for (let ty = lat2ty(n + mLat); ty <= lat2ty(s - mLat); ty++) jobs.push([tx, ty]);
      const snap0 = snapUsed;
      const tiles = await Promise.all(jobs.map(([tx, ty]) => fetchTile(snap0, tx, ty).then(L => ({tx, ty, L}))));
      // If the snapshot switched mid-build, rebuild entirely from the new one rather than mixing the two.
      if (snapUsed !== snap0) return buildSector(sid, opts);
      stats.tiles = tiles.length; stats.snapshot = snapNote; stats.snap = snap0;
      // Test extents, not vertices: a long straight road or a coastline can cross the sector with every vertex far away.
      const lo = -MARGIN, hiX = W + MARGIN, hiY = H + MARGIN;
      const boxNear = pts => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
        for (const q of pts){ if (q.x < a) a = q.x; if (q.x > b) b = q.x; if (q.y < c) c = q.y; if (q.y > d) d = q.y; }
        return b >= lo && a <= hiX && d >= lo && c <= hiY; };
      const gMin = Math.floor(lo/CELL) - 1, gMaxX = Math.floor(hiX/CELL) + 1, gMaxY = Math.floor(hiY/CELL) + 1;
      const addSeg = (a, b, t) => {
        if (!boxNear([a, b])) return;
        const x0 = Math.max(gMin, Math.floor(Math.min(a.x, b.x)/CELL) - 1), x1 = Math.min(gMaxX, Math.floor(Math.max(a.x, b.x)/CELL) + 1);
        const y0 = Math.max(gMin, Math.floor(Math.min(a.y, b.y)/CELL) - 1), y1 = Math.min(gMaxY, Math.floor(Math.max(a.y, b.y)/CELL) + 1);
        const sg = {a, b, t};
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++){ const k = gx + ',' + gy; let l = segs.get(k); if (!l) segs.set(k, l = []); l.push(sg); }
      };
      for (const {tx, ty, L} of tiles){
        const pt = (ext, px, py) => toXY(Math.atan(Math.sinh(Math.PI*(1 - 2*(ty + py/ext)/N)))*180/Math.PI, (tx + px/ext)/N*360 - 180);
        const T = L.transportation;
        if (T) for (const f of T.features){
          const p = f.props;
          if (p.brunnel === 'tunnel' || f.type !== 2) continue;
          const open = p.access !== 'no' && p.foot !== 'no';    // private or no-entry ways never host a spot
          const isWalk = open && ((p.class === 'path' && WALK_KIND[p.subclass]) || p.class === 'track' || p.class === 'pier');
          const hz = ROADS.has(p.class) ? 'road' : (p.class === 'rail' || p.class === 'transit') ? 'rail' : null;
          if (!isWalk && !hz) continue;
          for (const part of f.parts){
            const pts = part.map(([px, py]) => pt(T.extent, px, py));
            if (!boxNear(pts)) continue;
            if (hz) for (let i = 1; i < pts.length; i++) addSeg(pts[i - 1], pts[i], hz);
            else walks.push({pts, kind:p.class === 'track' ? ['Track', -1] : p.class === 'pier' ? ['Pier', 2] : WALK_KIND[p.subclass]});
          }
        }
        const WW = L.waterway;
        if (WW) for (const f of WW.features){
          if (f.props.brunnel === 'tunnel' || f.type !== 2) continue;
          for (const part of f.parts){ const pts = part.map(([px, py]) => pt(WW.extent, px, py)); if (boxNear(pts)) for (let i = 1; i < pts.length; i++) addSeg(pts[i - 1], pts[i], 'waterway'); }
        }
        const WA = L.water;
        if (WA) for (const f of WA.features){
          if (f.type !== 3 || f.props.brunnel === 'tunnel') continue;
          const rings = f.parts.map(part => part.map(([px, py]) => pt(WA.extent, px, py)));
          // Keep it if any ring's extent reaches the sector area; rings of one feature are tested together (holes are islands).
          if (rings.some(boxNear)) waters.push(rings);
        }
        const LU = L.landuse, AE = L.aeroway;
        for (const [Ly, set] of [[LU, NO_GO_LANDUSE], [AE, NO_GO_AEROWAY]]) if (Ly) for (const f of Ly.features){
          if (f.type !== 3 || !set.has(f.props.class)) continue;
          const rings = f.parts.map(part => part.map(([px, py]) => pt(Ly.extent, px, py)));
          if (rings.some(boxNear)) noGo.push(rings);
        }
        const PO = L.poi;
        if (PO) for (const f of PO.features){
          if (f.type !== 1 || f.id == null || pois.has(f.id)) continue;
          const k = kindOf(f.props); if (!k) continue;
          const [px, py] = f.parts[0] && f.parts[0][0] || [];
          if (px == null) continue;
          const p = pt(PO.extent, px, py);
          if (owns(toLL(p))) pois.set(f.id, {key:'p' + f.id, p, kind:k[0], base:k[1], name:(f.props.name || '').trim()});
        }
      }
      ok = true;
    }catch(err){ stats.error = String(err && err.message || err).slice(0, 80); }
  }
  stats.fetchMs = Date.now() - t0; stats.ok = ok || mode === 'random';

  const clear = (p, lim) => {
    if (!ok) return true;
    const gx = Math.floor(p.x/CELL), gy = Math.floor(p.y/CELL);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++){
      const l = segs.get(ix + ',' + iy); if (!l) continue;
      for (const sg of l){ const m = lim[sg.t]; if (m && segDist(p, sg.a, sg.b) < m) return false; }
    }
    if (inZones(p, noGo)) return false;
    if (lim.water && inZones(p, waters)) return false;
    return true;
  };
  // Over water is fine for a viewpoint on a pier or breakwater, but only when a public path or pier is within reach.
  const reachable = p => walks.some(wk => wk.pts.some((q, i) => i > 0 && segDist(p, wk.pts[i - 1], q) <= REACH));
  const nearestRoad = p => {
    let best = 60; const gx = Math.floor(p.x/CELL), gy = Math.floor(p.y/CELL);
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++){
      const l = segs.get(ix + ',' + iy); if (!l) continue;
      for (const sg of l) if (sg.t === 'road') best = Math.min(best, segDist(p, sg.a, sg.b));
    }
    return best;
  };
  const taken = [];
  const spaced = p => taken.every(o => Math.hypot(o.p.x - p.x, o.p.y - p.y) > SPACING);
  const byScore = (a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const out = [];
  let nameIx = 0;
  const nextName = () => names[nameIx++ % Math.max(1, names.length)] || 'Scratch Spot';
  const push = (o, node) => { taken.push(o); out.push(Object.assign({id:nodeId(sid + ':' + o.key), sector:sid, coolUntil:0}, toLL(o.p), node)); };

  // 1. Public places: the best-scoring named places first, a little seeded variety, never two within 45 m.
  if (ok && mode === 'osm'){
    const seen = [], cands = [];
    for (const c of pois.values()){
      if (!clear(c.p, POI_CLEAR) && !(WATERSIDE.has(c.kind) && clear(c.p, POI_DRY) && reachable(c.p))) continue;   // e.g. art in a road median
      c.score = c.base + (c.name ? 3 : 0) + unit(sid + ':' + c.key)*1.5;
      cands.push(c);
    }
    cands.sort(byScore);
    for (const c of cands){
      if (out.length >= CARD_MAX) break;
      if (c.name && seen.some(o => o.name === c.name && o.kind === c.kind && Math.hypot(o.p.x - c.p.x, o.p.y - c.p.y) < 150)) continue;   // one spot per park, not one per label
      if (!spaced(c.p)) continue;
      seen.push(c);
      push(c, {src:'osm', name:c.name || c.kind, kind:c.kind,
        prov:c.name ? `First pulled at ${c.name}` : `First pulled at ${article(c.kind)} ${c.kind.toLowerCase()}`});
    }
    stats.places = out.length;
  }

  // 2. Walkable spots on footpaths and trails, clear of roads, rail and water, at most three per path piece.
  const walkCands = [];
  if (ok && mode !== 'random'){
    const keys = new Set();
    walks.forEach((wk, wi) => {
      let carry = 15;                                           // first sample 15 m in, then every 30 m
      for (let i = 1; i < wk.pts.length; i++){
        const a = wk.pts[i - 1], b = wk.pts[i], L = Math.hypot(b.x - a.x, b.y - a.y);
        let d = carry;
        for (; d < L; d += 30){
          const p = {x:q1(a.x + (b.x - a.x)*d/L), y:q1(a.y + (b.y - a.y)*d/L)};
          if (!inside(p) || !owns(toLL(p)) || !clear(p, WALK_CLEAR)) continue;
          const key = 'w' + Math.round(p.x) + '_' + Math.round(p.y);
          if (keys.has(key)) continue;
          keys.add(key);
          walkCands.push({key, p, wi, kind:wk.kind[0], score:wk.kind[1] + Math.min(2, nearestRoad(p)/30) + unit(sid + ':' + key)*2});
        }
        carry = d - L;
      }
    });
    walkCands.sort(byScore);
    const perWay = new Map(), want = WALK_UNTIL - out.length;
    let added = 0;
    for (const pass of [3, Infinity]){
      for (const c of walkCands){
        if (added >= want) break;
        const k = perWay.get(c.wi) || 0;
        if (k >= pass || c.used || !spaced(c.p)) continue;
        c.used = true; perWay.set(c.wi, k + 1); added++;
        const name = nextName();
        push(c, {src:'walk', name, kind:c.kind, prov:`First pulled at ${name}`});
      }
    }
    stats.walk = added;
  }

  // 3. Fill-ins where the map has too little: seeded points that pass the same clearances. Without map data they
  //    can't be checked, but they still land in the same places on every phone.
  const fill = (count, seed, extra) => {
    const r = rng(sid + ':' + seed); let made = 0;
    for (let i = 0; i < count; i++){
      for (let tries = 0; tries < 80; tries++){
        const p = {x:q1(r()*W), y:q1(r()*H)};
        if (!owns(toLL(p)) || !spaced(p) || !clear(p, WALK_CLEAR)) continue;
        const name = nextName();
        push({key:seed + i, p}, Object.assign({src:'random', name, kind:'Scratch spot', prov:`First pulled at ${name}`}, extra || {}));
        made++; break;
      }
    }
    return made;
  };
  const cards = out.length;
  if (cards < CARD_MIN) stats.random = fill(CARD_MIN - cards, 'f');

  // 4. Dice caches: the best remaining walkable spots under their own seed, else fill-ins.
  const dice = walkCands.filter(c => !c.used).map(c => Object.assign({}, c, {key:'d' + c.key, score:unit(sid + ':d' + c.key)})).sort(byScore);
  let dz = 0;
  for (const c of dice){ if (dz >= DICE) break; if (!spaced(c.p)) continue; push(c, {src:'walk', type:'die', name:nextName(), kind:'Dice cache', prov:''}); dz++; }
  if (dz < DICE) dz += fill(DICE - dz, 'dz', {type:'die', kind:'Dice cache'});
  stats.dice = dz;
  out.forEach(o => { if (o.type === 'die') o.prov = `First pulled at ${o.name}`; });
  return {ok:stats.ok, snap:stats.snap || snapUsed, nodes:out, stats};
}

window.PecanWorld = {SNAPSHOT, SECTOR, hash32, rng, sectorOf, sectorsNear, parseSector, buildSector, decodeTile, get snapshot(){ return snapUsed; }};
})();
