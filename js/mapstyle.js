/* Pecan Pie night map style for MapLibre, drawn from OpenFreeMap vector tiles (OpenMapTiles schema).
   Design goal: a quiet, always-dark backdrop for someone on foot. Ground and roads stay muted so nodes
   read first; footpaths, trails and plazas are a little brighter and dashed, since walkable nodes sit on them.
   Business icons are left out on purpose. */
(() => {
const C = {
  ground:'#171b20', residential:'#1a1f25', industrial:'#1c1e23', green:'#18251f', wood:'#16231c', sand:'#23231d',
  water:'#0f2234', waterLine:'#13304a', building:'#222830', buildingEdge:'#2b323b',
  minor:'#2c333b', service:'#272d34', major:'#3a424c', motorway:'#46505b', casing:'#111418',
  path:'#8fa58a', track:'#6c7a5e', cycle:'#7f9fb2', plaza:'#20262a', plazaEdge:'#3b4a3e', rail:'#4a4e59',
  label:'#8e98a3', labelMinor:'#6f7a85', halo:'#171b20', waterLabel:'#4f6f8c'
};
const FONT = ['Noto Sans Regular'], FONT_IT = ['Noto Sans Italic'];
const z = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
const cls = (...v) => ['match', ['get', 'class'], v, true, false];
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
const isLine = ['==', ['geometry-type'], 'LineString'];

window.PECAN_MAPSTYLE = {
  version: 8,
  name: 'Pecan Pie Night',
  // Labels read the same tiles through a second source. If fonts fail to load, MapLibre drops every tile
  // from a source that has labels, so keeping labels separate means a font failure only costs the labels.
  sources: {
    omt: {type:'vector', url:'https://tiles.openfreemap.org/planet', attribution:'<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'},
    omtLabels: {type:'vector', url:'https://tiles.openfreemap.org/planet'}
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {id:'ground', type:'background', paint:{'background-color':C.ground}},

    // Land
    {id:'landuse-residential', type:'fill', source:'omt', 'source-layer':'landuse', filter:cls('residential', 'suburb', 'neighbourhood'), paint:{'fill-color':C.residential}},
    {id:'landuse-industrial', type:'fill', source:'omt', 'source-layer':'landuse', filter:cls('industrial', 'commercial', 'retail', 'railway'), paint:{'fill-color':C.industrial}},
    {id:'landcover-wood', type:'fill', source:'omt', 'source-layer':'landcover', filter:cls('wood', 'forest'), paint:{'fill-color':C.wood}},
    {id:'landcover-green', type:'fill', source:'omt', 'source-layer':'landcover', filter:cls('grass', 'wetland'), paint:{'fill-color':C.green}},
    {id:'landcover-sand', type:'fill', source:'omt', 'source-layer':'landcover', filter:cls('sand', 'beach'), paint:{'fill-color':C.sand}},
    {id:'landuse-green', type:'fill', source:'omt', 'source-layer':'landuse', filter:cls('cemetery', 'park', 'garden', 'grass', 'recreation_ground'), paint:{'fill-color':C.green}},
    {id:'park', type:'fill', source:'omt', 'source-layer':'park', paint:{'fill-color':C.green, 'fill-opacity':.85}},

    // Water
    {id:'water', type:'fill', source:'omt', 'source-layer':'water', filter:notTunnel, paint:{'fill-color':C.water}},
    {id:'waterway', type:'line', source:'omt', 'source-layer':'waterway', filter:notTunnel,
      paint:{'line-color':C.waterLine, 'line-width':z([10, .5, 18, 6])}},

    // Buildings fade in as you zoom
    {id:'building', type:'fill', source:'omt', 'source-layer':'building', minzoom:14,
      paint:{'fill-color':C.building, 'fill-outline-color':C.buildingEdge, 'fill-opacity':['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1]}},

    // Plazas and pedestrian areas
    {id:'plaza', type:'fill', source:'omt', 'source-layer':'transportation', minzoom:14,
      filter:['all', ['==', ['geometry-type'], 'Polygon'], ['match', ['get', 'subclass'], ['pedestrian', 'platform'], true, false]],
      paint:{'fill-color':C.plaza, 'fill-outline-color':C.plazaEdge}},

    // Roads, quiet: service, minor, major, motorway. Tunnels drawn faint.
    {id:'road-tunnel', type:'line', source:'omt', 'source-layer':'transportation', filter:['all', isLine, ['==', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor')],
      layout:{'line-cap':'butt'}, paint:{'line-color':C.minor, 'line-opacity':.45, 'line-dasharray':[1.5, 1], 'line-width':z([12, .5, 18, 8])}},
    {id:'road-major-casing', type:'line', source:'omt', 'source-layer':'transportation', filter:['all', isLine, notTunnel, cls('motorway', 'trunk', 'primary', 'secondary')],
      layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':C.casing, 'line-width':z([8, 1.2, 18, 22])}},
    {id:'road-service', type:'line', source:'omt', 'source-layer':'transportation', minzoom:14, filter:['all', isLine, notTunnel, cls('service', 'busway')],
      layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':C.service, 'line-width':z([14, .5, 18, 5])}},
    {id:'road-minor', type:'line', source:'omt', 'source-layer':'transportation', minzoom:12, filter:['all', isLine, notTunnel, cls('minor', 'tertiary')],
      layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':C.minor, 'line-width':z([12, .5, 18, 11])}},
    {id:'road-major', type:'line', source:'omt', 'source-layer':'transportation', filter:['all', isLine, notTunnel, cls('primary', 'secondary', 'trunk')],
      layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':C.major, 'line-width':z([8, .8, 18, 18])}},
    {id:'road-motorway', type:'line', source:'omt', 'source-layer':'transportation', filter:['all', isLine, notTunnel, cls('motorway')],
      layout:{'line-cap':'round', 'line-join':'round'}, paint:{'line-color':C.motorway, 'line-width':z([6, .8, 18, 20])}},

    // Rail: a thin dashed line
    {id:'rail', type:'line', source:'omt', 'source-layer':'transportation', minzoom:11, filter:['all', isLine, notTunnel, cls('rail', 'transit')],
      paint:{'line-color':C.rail, 'line-width':z([11, .6, 18, 2.5]), 'line-dasharray':[3, 2]}},

    // Walkable ways: brighter, dashed, drawn above roads so they read clearly
    {id:'track', type:'line', source:'omt', 'source-layer':'transportation', minzoom:13, filter:['all', isLine, notTunnel, cls('track')],
      paint:{'line-color':C.track, 'line-width':z([13, .6, 18, 2.4]), 'line-dasharray':[3, 2]}},
    {id:'path', type:'line', source:'omt', 'source-layer':'transportation', minzoom:14,
      filter:['all', isLine, notTunnel, cls('path'), ['!=', ['get', 'subclass'], 'cycleway']],
      paint:{'line-color':C.path, 'line-opacity':.9, 'line-width':z([14, .7, 18, 2.6]), 'line-dasharray':[2, 1.3]}},
    {id:'cycleway', type:'line', source:'omt', 'source-layer':'transportation', minzoom:14,
      filter:['all', isLine, notTunnel, cls('path'), ['==', ['get', 'subclass'], 'cycleway']],
      paint:{'line-color':C.cycle, 'line-opacity':.8, 'line-width':z([14, .7, 18, 2.4]), 'line-dasharray':[2, 1.3]}},

    // Labels: small and low-contrast
    {id:'water-name-line', type:'symbol', source:'omtLabels', 'source-layer':'water_name', minzoom:13, filter:isLine,
      layout:{'text-field':['get', 'name'], 'text-font':FONT_IT, 'text-size':11, 'symbol-placement':'line'},
      paint:{'text-color':C.waterLabel, 'text-halo-color':C.halo, 'text-halo-width':1.2}},
    {id:'water-name-point', type:'symbol', source:'omtLabels', 'source-layer':'water_name', minzoom:13, filter:['==', ['geometry-type'], 'Point'],
      layout:{'text-field':['get', 'name'], 'text-font':FONT_IT, 'text-size':11},
      paint:{'text-color':C.waterLabel, 'text-halo-color':C.halo, 'text-halo-width':1.2}},
    {id:'road-name', type:'symbol', source:'omtLabels', 'source-layer':'transportation_name', minzoom:14,
      filter:['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'path', 'pedestrian'], true, false],
      layout:{'text-field':['get', 'name'], 'text-font':FONT, 'symbol-placement':'line', 'text-size':['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 13], 'text-max-angle':30},
      paint:{'text-color':C.label, 'text-halo-color':C.halo, 'text-halo-width':1.4}},
    {id:'place-local', type:'symbol', source:'omtLabels', 'source-layer':'place', minzoom:12, maxzoom:17, filter:cls('suburb', 'neighbourhood', 'quarter'),
      layout:{'text-field':['upcase', ['get', 'name']], 'text-font':FONT, 'text-size':10.5, 'text-letter-spacing':.15, 'text-max-width':8},
      paint:{'text-color':C.labelMinor, 'text-halo-color':C.halo, 'text-halo-width':1.2}},
    {id:'place-town', type:'symbol', source:'omtLabels', 'source-layer':'place', maxzoom:15, filter:cls('city', 'town', 'village'),
      layout:{'text-field':['get', 'name'], 'text-font':FONT, 'text-size':['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15]},
      paint:{'text-color':C.label, 'text-halo-color':C.halo, 'text-halo-width':1.4}},
    {id:'housenumber', type:'symbol', source:'omtLabels', 'source-layer':'housenumber', minzoom:18,
      layout:{'text-field':['get', 'housenumber'], 'text-font':FONT, 'text-size':9},
      paint:{'text-color':'#4b535c', 'text-halo-color':C.halo, 'text-halo-width':1}}
  ]
};
})();
