/* Pecan Pie fog of war (release 1: the fog only, no explored percentage yet).

   The map is veiled wherever the player hasn't walked. Walking clears it, and what is cleared stays clear. A "lantern"
   always clears the ground around the player. Spots, the reach ring and the player's dot sit above the fog.

   History is stored on the phone only, as cells of about 10 m (coordinates rounded to 4 decimal places), never as a
   raw GPS trail, and it is never logged. The caller decides what counts as a walked step (the same filters as
   Distance: walking pace, decent accuracy).

   Styles: 'blur' (unexplored ground blurred, washed out and tinted), 'plain' (a dark veil, for phones where the blur
   stutters), 'off'. */
(() => {
'use strict';
const STEP = 8, TRAIL_R = 40, LANTERN_R = 100, MAX_CELLS = 20000, RES = 0.5, PAD = 0.5;
const keyOf = (lat, lng) => Math.round(lat*1e4) + ',' + Math.round(lng*1e4);
const cellLL = k => { const [a, b] = k.split(','); return [a/1e4, b/1e4]; };

function create(map, opts){
  const load = opts.load || (() => []), save = opts.save || (() => {}), onPerf = opts.onPerf || (() => {});
  let style = opts.style || 'blur', me = null, cells = new Set(load()), saveTimer = null;
  const pane = map.createPane('fog'); pane.style.zIndex = 390; pane.style.pointerEvents = 'none';
  const veil = document.createElement('div'); veil.className = 'fog-veil'; pane.appendChild(veil);
  const cv = document.createElement('canvas'), g = cv.getContext('2d');
  const perf = [];

  function persist(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      let list = [...cells];
      if (list.length > MAX_CELLS){ list = list.slice(-MAX_CELLS); cells = new Set(list); }   // oldest first out
      save(list);
    }, 1500);
  }
  function draw(){
    if (style === 'off'){ veil.hidden = true; return; }
    veil.hidden = false;
    veil.className = 'fog-veil' + (style === 'plain' ? ' plain' : '');
    const t0 = performance.now(), size = map.getSize();
    // The veil reaches half a screen past each edge, so panning never shows a clear strip before the redraw.
    const px = Math.round(size.x*PAD), py = Math.round(size.y*PAD), w = size.x + 2*px, h = size.y + 2*py;
    const origin = map.containerPointToLayerPoint([-px, -py]);
    L.DomUtil.setPosition(veil, origin);
    veil.style.width = w + 'px'; veil.style.height = h + 'px';
    cv.width = Math.max(1, Math.round(w*RES)); cv.height = Math.max(1, Math.round(h*RES));
    g.setTransform(RES, 0, 0, RES, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const mpp = map.distance(map.containerPointToLatLng([0, size.y/2]), map.containerPointToLatLng([100, size.y/2]))/100 || 1;
    const hole = (lat, lng, meters) => {
      const c = map.latLngToContainerPoint([lat, lng]), x = c.x + px, y = c.y + py, r = meters/mpp;
      if (x < -r || y < -r || x > w + r || y > h + r) return;
      const rg = g.createRadialGradient(x, y, r*.45, x, y, r);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
    };
    g.globalCompositeOperation = 'destination-out';
    const b = map.getBounds().pad(PAD + .2), s = b.getSouth(), n = b.getNorth(), we = b.getWest(), e = b.getEast();
    for (const k of cells){ const [lat, lng] = cellLL(k); if (lat >= s && lat <= n && lng >= we && lng <= e) hole(lat, lng, TRAIL_R); }
    if (me) hole(me.lat, me.lng, LANTERN_R);
    const url = 'url(' + cv.toDataURL() + ')';
    veil.style.webkitMaskImage = url; veil.style.maskImage = url;
    veil.style.webkitMaskSize = '100% 100%'; veil.style.maskSize = '100% 100%';
    if (perf.length < 5 && me){ perf.push(performance.now() - t0); if (perf.length === 5){ const sorted = perf.slice().sort((a, z) => a - z); onPerf({style, medianMs:Math.round(sorted[2]), maxMs:Math.round(sorted[4]), cells:cells.size}); } }
  }
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  map.on('moveend resize viewreset', redraw);
  map.on('zoomstart', () => { veil.style.visibility = 'hidden'; });
  map.on('zoomend', () => { veil.style.visibility = ''; redraw(); });
  draw();

  return {
    // A walked step from a to b ({lat, lng}): clear the cells along it.
    walk(a, b){
      const d = map.distance([a.lat, a.lng], [b.lat, b.lng]), n = Math.max(1, Math.ceil(d/STEP)), before = cells.size;
      for (let i = 0; i <= n; i++){ const k = keyOf(a.lat + (b.lat - a.lat)*i/n, a.lng + (b.lng - a.lng)*i/n); cells.delete(k); cells.add(k); }
      if (cells.size !== before) persist();
      redraw();
    },
    setMe(p){ me = p ? {lat:p.lat, lng:p.lng} : null; redraw(); },
    setStyle(s){ style = s; redraw(); },
    clear(){ cells = new Set(); save([]); redraw(); },
    get size(){ return cells.size; }
  };
}
window.PecanFog = {create};
})();
