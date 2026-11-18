/* Pecan Pie fog of war (release 1: the fog only, no explored percentage yet).

   The map is veiled wherever the player hasn't walked. Walking clears it, and what is cleared stays clear. A "lantern"
   always clears the ground around the player. Spots, the reach ring and the player's dot sit above the fog.

   History is stored on the phone only, as cells of about 10 m (coordinates rounded to 4 decimal places), never as a
   raw GPS trail, and it is never logged. The caller decides what counts as a walked step (the same filters as
   Distance: walking pace, decent accuracy).

   Styles:
   - 'plain' (default): a dark veil painted straight onto a canvas. A canvas repaint lands in one frame, so nothing
     flickers when the fog redraws on each GPS fix.
   - 'blur' (experimental): unexplored ground blurred and washed out, using a CSS backdrop filter cut by a mask image.
     Safari decodes a new mask image a moment after it is set, which flickered in 3.8, so the next mask is decoded
     first and swapped in on a second, double-buffered layer.
   - 'off'.

   Zooming: like Leaflet's image overlays, the fog is anchored to map coordinates. It stretches with pinch zooms and
   rides the zoom animation, then repaints sharp when the zoom ends. */
(() => {
'use strict';
// PAD: the fog reaches a full screen past each edge, so a one-level zoom out (half size) still covers the screen.
const STEP = 8, TRAIL_R = 40, LANTERN_R = 100, MAX_CELLS = 20000, RES = 0.5, PAD = 1;
// The veil is a light violet mist rather than more darkness, so it reads as haze over the dark map. An optional mint glow
// marks the edge between explored and unexplored ground.
const VEIL = 'rgba(132,120,178,.42)', RIM = '61,255,160';
const keyOf = (lat, lng) => Math.round(lat*1e4) + ',' + Math.round(lng*1e4);
const cellLL = k => { const [a, b] = k.split(','); return [a/1e4, b/1e4]; };
// Cells are kept parsed (key -> [lat, lng]) so a redraw, which runs on every GPS fix, never re-parses strings.
// Anything unexpected in storage is ignored rather than allowed to stop the app from starting.
const CELL_KEY = /^-?\d+,-?\d+$/;
const toMap = keys => new Map((Array.isArray(keys) ? keys : []).filter(k => typeof k === 'string' && CELL_KEY.test(k)).map(k => [k, cellLL(k)]));

function create(map, opts){
  const load = opts.load || (() => []), save = opts.save || (() => {}), onPerf = opts.onPerf || (() => {});
  let style = opts.style || 'plain', edge = opts.edge !== false, me = null, cells = toMap(load()), saveTimer = null;
  const pane = map.createPane('fog'); pane.style.zIndex = 390; pane.style.pointerEvents = 'none';
  const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls + ' leaflet-zoom-animated'; e.hidden = true; pane.appendChild(e); return e; };
  const sheet = el('canvas', 'fog-sheet');                         // plain style: the visible canvas itself
  const veils = [el('div', 'fog-veil'), el('div', 'fog-veil')];    // blur style: two layers, one showing, one loading
  let front = 0, maskJob = 0, maskUrl = [null, null];
  const work = document.createElement('canvas'), wg = work.getContext('2d');
  const perf = [];

  function persist(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      let list = [...cells.keys()];
      if (list.length > MAX_CELLS){ list = list.slice(-MAX_CELLS); cells = toMap(list); }   // oldest first out
      save(list);
    }, 1500);
  }
  // Place an element over the map area it was painted for (by its stored corners), at the current zoom.
  function place(e){
    if (!e._nw) return;
    const tl = map.latLngToLayerPoint(e._nw), br = map.latLngToLayerPoint(e._se);
    L.DomUtil.setPosition(e, tl);
    e.style.width = (br.x - tl.x) + 'px'; e.style.height = (br.y - tl.y) + 'px';
  }
  // Paint the fog for the current view (plus half a screen each side) onto a canvas: fill, then cut the holes.
  function paint(canvas, fill){
    const size = map.getSize(), px = Math.round(size.x*PAD), py = Math.round(size.y*PAD), w = size.x + 2*px, h = size.y + 2*py;
    canvas.width = Math.max(1, Math.round(w*RES)); canvas.height = Math.max(1, Math.round(h*RES));
    const g = canvas.getContext('2d');
    g.setTransform(RES, 0, 0, RES, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = fill; g.fillRect(0, 0, w, h);
    const mpp = map.distance(map.containerPointToLatLng([0, size.y/2]), map.containerPointToLatLng([100, size.y/2]))/100 || 1;
    const hole = (lat, lng, meters) => {
      const c = map.latLngToContainerPoint([lat, lng]), x = c.x + px, y = c.y + py, r = meters/mpp;
      if (x < -r || y < -r || x > w + r || y > h + r) return;
      const rg = g.createRadialGradient(x, y, r*.45, x, y, r);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
    };
    const b = map.getBounds().pad(PAD + .2), s = b.getSouth(), n = b.getNorth(), we = b.getWest(), e = b.getEast();
    if (edge && fill !== '#000'){
      // A faint glow just outside each cleared edge; the holes cut away the inside, so only the frontier keeps it.
      g.globalCompositeOperation = 'source-over';
      const ring = (lat, lng, meters) => { const c = map.latLngToContainerPoint([lat, lng]), x = c.x + px, y = c.y + py, r = meters/mpp;
        if (x < -2*r || y < -2*r || x > w + 2*r || y > h + 2*r) return;
        const rg = g.createRadialGradient(x, y, r*.8, x, y, r*1.35);
        rg.addColorStop(0, `rgba(${RIM},0)`); rg.addColorStop(.35, `rgba(${RIM},.28)`); rg.addColorStop(1, `rgba(${RIM},0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r*1.35, 0, Math.PI*2); g.fill(); };
      for (const [lat, lng] of cells.values()) if (lat >= s && lat <= n && lng >= we && lng <= e) ring(lat, lng, TRAIL_R);
      if (me) ring(me.lat, me.lng, LANTERN_R);
    }
    g.globalCompositeOperation = 'destination-out';
    for (const [lat, lng] of cells.values()) if (lat >= s && lat <= n && lng >= we && lng <= e) hole(lat, lng, TRAIL_R);
    if (me) hole(me.lat, me.lng, LANTERN_R);
    return {nw:map.containerPointToLatLng([-px, -py]), se:map.containerPointToLatLng([size.x + px, size.y + py])};
  }
  function draw(){
    const t0 = performance.now();
    if (style !== 'blur') maskJob++;                            // a blur mask still loading must not appear after a switch
    if (style === 'off'){ sheet.hidden = true; veils.forEach(v => { v.hidden = true; }); return; }
    if (style === 'plain'){
      veils.forEach(v => { v.hidden = true; });
      const box = paint(sheet, VEIL);
      sheet._nw = box.nw; sheet._se = box.se; sheet._z = map.getZoom(); place(sheet); sheet.hidden = false;
    } else {
      // The canvas veil stays up until the first blurred layer is actually showing, so switching never leaves a gap.
      const box = paint(work, '#000'), job = ++maskJob, back = 1 - front;
      work.toBlob(blob => {
        if (!blob || job !== maskJob) return;
        const url = URL.createObjectURL(blob), img = new Image();
        img.src = url;
        img.decode().catch(() => {}).then(() => {
          if (job !== maskJob){ URL.revokeObjectURL(url); return; }
          const v = veils[back], m = `url(${url})`;
          v.style.webkitMaskImage = m; v.style.maskImage = m; v.style.webkitMaskSize = '100% 100%'; v.style.maskSize = '100% 100%';
          v._nw = box.nw; v._se = box.se; place(v);
          v.hidden = false;
          // Swap on the next frame, once the new layer has painted with its mask.
          requestAnimationFrame(() => {
            if (job !== maskJob) return;
            veils[front].hidden = true; sheet.hidden = true;
            if (maskUrl[front]) URL.revokeObjectURL(maskUrl[front]);
            maskUrl[back] = url; front = back;
          });
        });
      });
    }
    if (perf.length < 5 && me){ perf.push(performance.now() - t0); if (perf.length === 5){ const sorted = perf.slice().sort((a, z) => a - z); onPerf({style, medianMs:Math.round(sorted[2]), maxMs:Math.round(sorted[4]), cells:cells.size}); } }
  }
  let raf = 0, zooming = false, animating = false;
  const redraw = () => { if (!zooming && !raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const shown = () => [sheet].concat(veils).filter(e => !e.hidden);
  map.on('moveend resize', redraw);
  // Pinch zoom: stretch with the map each frame. Once the zoom has moved half a level from the last paint, repaint instead:
  // a layer stretched to several times the screen grows past what iPhones will draw, and the fog would drop out.
  map.on('zoom viewreset', () => {
    shown().forEach(place);
    if (!animating && style === 'plain' && sheet._z != null && Math.abs(map.getZoom() - sheet._z) >= .5 && !raf)
      raf = requestAnimationFrame(() => { raf = 0; draw(); });
  });
  map.on('zoomanim', e => {                                       // animated zoom: ride the same transform as the map
    zooming = true; animating = true;
    for (const v of shown()) if (v._nw) L.DomUtil.setTransform(v, map._latLngToNewLayerPoint(v._nw, e.zoom, e.center), map.getZoomScale(e.zoom));
  });
  map.on('zoomstart', () => { zooming = true; });
  map.on('zoomend', () => { zooming = false; animating = false; shown().forEach(place); redraw(); });
  draw();

  return {
    // A walked step from a to b ({lat, lng}): clear the cells along it.
    walk(a, b){
      const d = map.distance([a.lat, a.lng], [b.lat, b.lng]), n = Math.max(1, Math.ceil(d/STEP)), before = cells.size;
      for (let i = 0; i <= n; i++){ const k = keyOf(a.lat + (b.lat - a.lat)*i/n, a.lng + (b.lng - a.lng)*i/n); cells.delete(k); cells.set(k, cellLL(k)); }
      if (cells.size !== before) persist();
      redraw();
    },
    setMe(p){ me = p ? {lat:p.lat, lng:p.lng} : null; redraw(); },
    setStyle(s){ style = s; redraw(); },
    setEdge(on){ edge = !!on; redraw(); },
    clear(){ cells = new Map(); save([]); redraw(); },
    get size(){ return cells.size; },
    get style(){ return style; },
    // Is this point in clear ground (walked, or inside the lantern)? Spots under the fog are drawn dimmed.
    isClear(lat, lng){
      if (style === 'off') return true;
      if (me && map.distance([lat, lng], [me.lat, me.lng]) <= LANTERN_R*.85) return true;
      const r = TRAIL_R*.7, la = Math.round(lat*1e4), lo = Math.round(lng*1e4);
      for (let i = -4; i <= 4; i++) for (let j = -5; j <= 5; j++){
        const c = cells.get((la + i) + ',' + (lo + j));
        if (c && map.distance([lat, lng], c) <= r) return true;
      }
      return false;
    }
  };
}
window.PecanFog = {create};
})();
