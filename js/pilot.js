/* Pecan Pie pilot: map, nodes, collection, and logging around the scratch engine. */
(() => {
'use strict';
const E = window.Engine;
const $ = id => document.getElementById(id);
const app = $('app');

/* ================= Storage ================= */
const store = {
  get(k, d){ try{ const v = localStorage.getItem('pecan.' + k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem('pecan.' + k, JSON.stringify(v)); return true; }catch{ return false; } }
};

/* ================= Config ================= */
const DEFAULT_CENTER = {lat:33.7701, lng:-118.1937};          // Long Beach, used only for mock location with no fix yet
const RANK_WEIGHTS = [45, 28, 17, 8, 2];                        // Common to Mythic, percent
const NODE_NAMES = ['Tidewater Post', 'Gull Rock', 'Lantern Steps', 'Rope Yard', 'Salt Gate', 'Breakwater Bench', 'Kelp Corner',
  'Pilot House', 'Harbor Clock', 'Net Loft', 'Bell Tower', 'Ferry Slip', 'Driftwood Arch', 'Signal Hill', 'Shell Walk', 'Mooring Post',
  'Old Customs', 'Fog Bell', 'Cannery Row', 'Pier Gate'];
const P = Object.assign({vis:400, reach:75, acc:100, cool:4, mock:'off', walk:'1.4', tester:'', hook:'', debug:false, nodeSource:'osm'}, store.get('pilot', {}));
const saveP = () => store.set('pilot', P);

const NODES_V = 3;                                              // bump to reseed everyone after a node-format change
let nodes = store.get('nodesV', 0) === NODES_V ? store.get('nodes', null) : null;
let seedCenters = store.get('seedCenters', []);
let collection = store.get('collection', []);
let events = store.get('events', []);
let daily = store.get('daily', {last:0});
let testerId = store.get('tid', null);
if (!testerId){ testerId = 'T-' + Math.floor(E.rng()*1e6).toString(36).toUpperCase(); store.set('tid', testerId); }
const session = Date.now().toString(36) + '-' + Math.floor(E.rng()*1e6).toString(36);

/* ================= Event log ================= */
function event(type, data){
  const e = Object.assign({at:new Date().toISOString(), type, session, tester:P.tester || testerId}, data || {});
  events.push(e); if (events.length > 3000) events = events.slice(-3000);
  store.set('events', events);
  if (P.hook){
    try{ fetch(P.hook, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(e), keepalive:true}).catch(() => {}); }catch{}
  }
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
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
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
  nodes = nodes.concat(added); seedCenters.push({lat:c.lat, lng:c.lng});
  if (nodes.length > 150) nodes = nodes.slice(-150);
  store.set('nodes', nodes); store.set('nodesV', NODES_V); store.set('seedCenters', seedCenters);
  event('nodes_seeded', {count:added.length, osm:added.filter(n => n.src === 'osm').length, walk:added.filter(n => n.src === 'walk').length, fresh});
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
    const key = info.st + '|' + label;
    if (!m){
      m = L.marker([n.lat, n.lng], {keyboard:true, title:n.name});
      m.on('click', () => openSheet(n));
      m.addTo(map); markers.set(n.id, m);
    }
    if (m._key !== key){
      m._key = key;
      m.setIcon(L.divIcon({className:'', iconSize:[34, 44], iconAnchor:[17, 40],
        html:`<div class="node ${info.st}"><div class="tok">HL</div><div class="t">${label}</div></div>`}));
    }
    if (info.st === 'inrange' && !wasInRange.has(n.id)){ wasInRange.add(n.id); event('node_in_range', {node:n.id, d:Math.round(info.d), acc:Math.round(meAcc)}); }
    if (info.st !== 'inrange') wasInRange.delete(n.id);
  }
  if (sheetNode) updateSheet();
}

/* Node sheet */
let sheetNode = null;
function openSheet(n){ sheetNode = n; $('nodeSheet').hidden = false; updateSheet(); event('node_tap', {node:n.id}); }
function closeSheet(){ sheetNode = null; $('nodeSheet').hidden = true; }
function updateSheet(){
  const n = sheetNode, info = nodeInfo(n), btn = $('nsScratch');
  $('nsName').textContent = n.name;
  let sub = (n.kind && n.kind !== n.name ? n.kind + ' · ' : '');
  if (info.st === 'cooling') sub += `Recharging. Ready in ${fmtLeft(info.left)}.`;
  else if (info.st === 'inrange') sub += 'You’re here. Scratch to pull a card.';
  else if (me && dist(me, n) <= P.reach && meAcc > P.acc) sub += `You’re close, but GPS is rough right now (±${Math.round(meAcc)} m). Step into the open or wait a moment.`;
  else sub += `${fmtDist(info.d)} away. Walk within ${P.reach} m to scratch.`;
  $('nsDist').textContent = sub;
  btn.disabled = info.st !== 'inrange';
}
$('nsClose').addEventListener('click', closeSheet);
$('nsScratch').addEventListener('click', () => {
  const n = sheetNode; if (!n || nodeInfo(n).st !== 'inrange') return;
  closeSheet();
  openScratch(drawCard(), {source:'node', node:n.id, label:n.name, provenance:n.prov || `First pulled at ${n.name}`});
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
let current = null;
function openScratch(card, ctx){
  current = ctx;
  showView('vScratch'); app.classList.add('scratching');
  $('scratchWhere').textContent = ctx.label;
  $('scratchDone').hidden = true; $('scratchBack').hidden = false;
  $('vScratch').scrollTop = 0;
  E.newCard(card, ctx);
  event('scratch_open', {source:ctx.source, node:ctx.node || null, card:card.id, rank:card.rank});
}
function closeScratch(){
  app.classList.remove('scratching'); current = null;
  showView('vMap');
}
$('scratchBack').addEventListener('click', () => {
  if (E.revealed) return closeScratch();
  if (E.started){ $('hint').textContent = 'Finish scratching this card first. It’s already yours.'; return; }
  event('scratch_abandon', {source:current && current.source});
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

window.Pilot = {
  event,
  onReveal({row, payload:p, card, ctx, pristine}){
    const inst = {
      id:'c' + Date.now().toString(36) + Math.floor(E.rng()*1e4).toString(36), cardId:card.id, at:new Date().toISOString(),
      source:ctx.source || 'debug', node:ctx.node || null, provenance:ctx.provenance || '',
      grade:p.grade, sigmaW:row.sigmaW, isHolo:p.isHolo, printNumber:p.printNumber, cf:p.chanceFactors, broke:p.broke, token:p.microGameToken,
      mask:pristine ? null : encodeMask()
    };
    collection.push(inst);
    if (!store.set('collection', collection)){ inst.mask = null; store.set('collection', collection); }
    if (ctx.source === 'node' && nodes){ const n = nodes.find(n => n.id === ctx.node); if (n){ n.coolUntil = Date.now() + P.cool*3600e3; store.set('nodes', nodes); } }
    if (ctx.source === 'daily'){ daily.last = Date.now(); store.set('daily', daily); }
    event('scratch_reveal', {source:inst.source, node:inst.node, card:card.id, rank:card.rank, grade:p.grade, computedGrade:row.computedGrade,
      sigmaW:row.sigmaW, holo:p.isHolo, print:p.printNumber, broke:row.broke, token:p.microGameToken, durationMs:row.durationMs,
      strokes:row.strokes, speedPxS:row.speedPxS, coverage:row.coverage, fx:row.fx, newSlot:collection.filter(c => c.cardId === card.id).length === 1});
    updateChips();
  },
  onFinish(){ $('scratchDone').hidden = false; $('scratchBack').hidden = true; }
};

/* ================= Daily card ================= */
const DAY = 24*3600e3;
const dailyReady = () => Date.now() - daily.last >= DAY;
$('dailyBtn').addEventListener('click', () => {
  if (!dailyReady()) return;
  event('daily_open');
  openScratch(drawCard(), {source:'daily', label:'Daily card', provenance:'Daily card'});
});
function updateChips(){
  const d = $('dailyBtn');
  if (dailyReady()){ d.textContent = 'Daily card ready'; d.classList.add('ready'); }
  else { d.textContent = `Next daily in ${fmtLeft(daily.last + DAY - Date.now())}`; d.classList.remove('ready'); }
  const owned = new Set(collection.map(c => c.cardId)).size;
  $('setChip').textContent = `Harbor Lights ${owned}/${E.CARDS.length}`;
}
$('setChip').addEventListener('click', () => showView('vCollection'));

/* ================= Static cards (collection and inspect) ================= */
const GRADE_ORDER = {Pristine:0, Good:1, Fair:2, Poor:3};
function cardMarkup(card, inst, idx){
  const esc = E.esc;
  const ed = card.run ? `Launch Ed. · Run ${card.run.label} of ${card.run.size}` : 'Launch Ed. · Evergreen';
  const v = inst ? {holo:inst.isHolo ? 'Holo' : 'Normal', print:inst.printNumber > 0 ? `${inst.printNumber}/${card.run.size}` : 'Evergr.', grade:inst.grade, token:inst.token}
                 : {holo:'?', print:'?', grade:'?', token:'?'};
  const cf = E.STATS.map(k => {
    let track = '', val = '?', broke = false;
    if (inst){
      const g = E.cfGeom(card, k), x = inst.cf[k]; broke = !!(inst.broke && inst.broke[k]);
      track = `<div class="band" style="left:${g.pct(g.lo)}%; width:${g.pct(g.hi) - g.pct(g.lo)}%"></div><div class="mark${broke ? ' broke' : ''}" style="left:${g.pct(x)}%"></div>`;
      val = x.toFixed(1);
    }
    return `<div class="cfrow"><span class="lbl">${E.STAT_LABEL[k]}</span><div class="track">${track}</div><span class="cfv${broke ? ' broke' : ''}">${val}</span></div>`;
  }).join('');
  const prov = inst ? esc(inst.provenance || 'Harbor Lights') : 'Harbor Lights';
  const date = inst ? new Date(inst.at).toLocaleDateString('en-US') : `No. ${card.no}`;
  const resid = inst && inst.mask ? `<canvas class="resid" data-i="${idx}"></canvas>` : '';
  return `<div class="card${inst && inst.isHolo ? ' holo' : ''}">
    <div class="topline"><span class="sig"><b>${card.sig[0]}·${card.sig[1]}</b><b>${card.ttt}</b></span><span class="settag">Harbor Lights</span></div>
    <div class="banner"><span class="name">${esc(card.name)}</span><span class="ed">${ed}</span></div>
    <div class="art">${E.artSVG(card)}</div>
    ${E.pipRow(card.rank)}
    <div class="desc${inst ? '' : ' unknown'}${resid ? ' has-resid' : ''}">
      <div class="desc-grid">
        <div class="slot"><span class="lbl">Finish</span><span class="val">${v.holo}</span></div>
        <div class="slot"><span class="lbl">Print</span><span class="val">${v.print}</span></div>
        <div class="slot"><span class="lbl">Condition</span><span class="val">${v.grade}</span></div>
        <div class="slot"><span class="lbl">Token</span><span class="val">${v.token}</span></div>
      </div>
      <div class="cf">${cf}</div>
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
  return list.slice().sort((a, b) => (GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]) || (b.isHolo - a.isHolo) || ((a.printNumber > 0 ? a.printNumber : 1e9) - (b.printNumber > 0 ? b.printNumber : 1e9)))[0];
}
function renderCollection(){
  const grid = $('colGrid'), cards = E.CARDS.slice().sort((a, b) => a.no - b.no);
  const owned = new Set(collection.map(c => c.cardId)).size;
  $('setProgress').textContent = `${owned} of ${cards.length} collected`;
  shown = [];
  let html = '';
  if (colMode === 'cat'){
    for (const card of cards){
      const mine = collection.filter(c => c.cardId === card.id);
      if (mine.length){
        const inst = bestCopy(mine), i = shown.push(inst) - 1;
        html += `<button class="tile" type="button" data-i="${i}" aria-label="${E.esc(card.name)}, ${mine.length} owned">${cardMarkup(card, inst, i)}<div class="tile-cap"><b>${E.esc(card.name)}</b><span>×${mine.length}</span></div></button>`;
      } else {
        html += `<div class="tile slot-empty" aria-label="Empty slot ${card.no}">${cardMarkup(card, null, -1)}<div class="tile-cap"><b>No. ${card.no}</b><span>${E.RANKS[card.rank - 1]}</span></div></div>`;
      }
    }
  } else {
    const list = collection.slice().reverse();
    if (!list.length) html = '<p class="empty-note">No cards yet. Walk to a node on the map, or claim your daily card.</p>';
    for (const inst of list){
      const card = E.CARDS.find(c => c.id === inst.cardId); if (!card) continue;
      const i = shown.push(inst) - 1;
      html += `<button class="tile" type="button" data-i="${i}" aria-label="${E.esc(card.name)}, ${inst.grade}">${cardMarkup(card, inst, i)}<div class="tile-cap"><b>${E.esc(card.name)}</b><span class="g-${inst.grade}">${inst.grade}</span></div></button>`;
    }
  }
  grid.innerHTML = html;
  grid.querySelectorAll('canvas.resid').forEach(cv => { const inst = shown[+cv.dataset.i]; if (inst && inst.mask) paintResidue(cv, inst.mask); });
  event('view', {view:colMode === 'cat' ? 'catalogue' : 'all_cards', owned});
}
$('colGrid').addEventListener('click', e => { const t = e.target.closest('button.tile'); if (t) openInspect(shown[+t.dataset.i]); });
function setSeg(mode){ colMode = mode; $('segCat').setAttribute('aria-selected', mode === 'cat'); $('segAll').setAttribute('aria-selected', mode === 'all'); renderCollection(); }
$('segCat').addEventListener('click', () => setSeg('cat'));
$('segAll').addEventListener('click', () => setSeg('all'));
$('setFilter').addEventListener('change', renderCollection);

/* ================= Inspect ================= */
function openInspect(inst){
  if (!inst) return;
  const card = E.CARDS.find(c => c.id === inst.cardId);
  $('inspect').hidden = false;
  $('inspCard').innerHTML = cardMarkup(card, inst, 0);
  const cv = $('inspCard').querySelector('canvas.resid');
  if (cv) paintResidue(cv, inst.mask);
  $('inspHint').textContent = inst.mask ? 'Hold the panel to read through the residue.' : inst.grade === 'Pristine' ? 'A Pristine copy. The panel came off clean.' : '';
  const cfRows = E.STATS.map(k => { const [lo, hi] = card.cf[k]; const b = inst.broke && inst.broke[k];
    return `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${inst.cf[k].toFixed(1)} <span style="color:var(--muted)">(${lo}–${hi})</span>${b ? ' <span class="flag">broke the ceiling</span>' : ''}</dd>`; }).join('');
  $('inspSlab').innerHTML = `<div class="slab"><div class="slab-head"><div><div class="t">${E.esc(card.name)}</div><div class="s">Harbor Lights · Launch · ${E.RANKS[card.rank - 1]}</div></div>
    <div class="slab-grade"><div class="g g-${inst.grade}">${inst.grade}</div></div></div>
    <dl class="kv"><dt>Finish</dt><dd>${inst.isHolo ? 'Holo' : 'Normal'}</dd><dt>Print</dt><dd>${inst.printNumber > 0 ? inst.printNumber + ' / ' + card.run.size : 'Evergreen'}</dd>
    <dt>Token</dt><dd>${inst.token}</dd>${cfRows}<dt>Pulled</dt><dd>${E.esc(inst.provenance || '')}, ${new Date(inst.at).toLocaleDateString('en-US')}</dd></dl></div>`;
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

function bindPRange(id, key, fmt, after){
  const el = $(id), out = $('o' + id.slice(1));
  el.value = P[key]; out.textContent = fmt(+el.value);
  el.addEventListener('input', () => { P[key] = +el.value; out.textContent = fmt(P[key]); saveP(); after && after(); });
}
bindPRange('dVis', 'vis', v => v + ' m', refreshNodes);
bindPRange('dReach', 'reach', v => v + ' m', () => { reachCircle.setRadius(P.reach); refreshNodes(); });
bindPRange('dAcc', 'acc', v => '±' + v + ' m', () => { updateGps(); refreshNodes(); });
bindPRange('dCool', 'cool', v => v ? v + ' h' : 'None', null);
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
$('dReady').addEventListener('click', () => { if (nodes){ nodes.forEach(n => { n.coolUntil = 0; }); store.set('nodes', nodes); refreshNodes(); $('dNote').textContent = 'All nodes ready.'; } });
$('dDaily').addEventListener('click', () => { daily.last = 0; store.set('daily', daily); updateChips(); $('dNote').textContent = 'Daily card is ready.'; });
$('dTester').value = P.tester;
$('dTester').placeholder = testerId;
$('dTester').addEventListener('change', () => { P.tester = $('dTester').value.trim(); saveP(); });
$('dHook').value = P.hook;
$('dHook').addEventListener('change', () => { P.hook = $('dHook').value.trim(); saveP(); if (P.hook) event('endpoint_set'); });
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
$('newCard').addEventListener('click', () => openScratch(drawCard(), {source:'debug', label:'Test card', provenance:'Test card'}));

/* ================= Boot ================= */
applyDebug();
updateChips(); updateGps();
event('app_open', {cards:collection.length});
initLocation();
setInterval(() => { refreshNodes(); updateChips(); }, 1000);
window.__pilot = {get nodes(){ return nodes; }, get collection(){ return collection; }, get events(){ return events; }, P, setPosition, seedArea, showView};
})();
