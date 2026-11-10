# Pecan Pie pilot

A location-based scratch card prototype for the validation pilot. Walk to nodes on the map, scratch a card, and build the Harbor Lights set.

It's a static web app with no build step and no backend. Host the folder anywhere that serves HTTPS (GitHub Pages works), then open it on a phone.

## What's here

- `index.html`: app shell with Map, Scratch, Collection, and Debug views.
- `js/engine.js`: the scratch, grading, and reveal engine from the Scratch Lab.
- `js/pilot.js`: map, nodes, proximity, daily card, collection, inspect, and event logging.
- `js/config.js`: the log endpoint.
- `apps-script/`: the Google Sheets log receiver and summary.
- `guide.html`: the tester guide, linked from the Collection screen.
- `survey.html`, `report.html`: the in-app end-of-week survey and problem report. Both send to the same Sheet (Survey and Problems tabs), fill in the tester code, and keep a draft on the phone until sent.
- `js/forms.js`, `css/forms.css`: shared code and styles for those two pages.
- `tester-kit/survey.md`: the survey questions with what each one answers, plus a message to send testers.
- `css/engine.css`, `css/pilot.css`: styles.
- `vendor/leaflet/`: Leaflet 1.9.4 (BSD-2-Clause, license included).
- `vendor/maplibre/`: MapLibre GL JS 4.7.1 (BSD-3-Clause) and maplibre-gl-leaflet 0.1.4 (ISC), licenses included.
- `js/mapstyle.js`: the dark map style.

## How it works

- **Map:** an always-dark vector map (see Map below). The first good GPS fix places 15 nodes within about 650 m of the player, at least three within 200 m when the area allows. Walking 500 m from where nodes were last placed loads a new batch.
- **Node placement:** one OpenStreetMap (Overpass) request per area. Nodes are kept at least 45 m apart.
  - **Public places come first:** public art, viewpoints, landmarks, historic sites, parks, gardens, fountains, libraries, museums, cafes, piers, lighthouses and similar. Anything private, plus memorials, graves, shrines, playgrounds, schools and places of worship, is skipped. Places within 6 m of a road centerline, such as art in a median, are skipped too.
  - **Walkable spots fill the gaps:** points along footpaths, trails, plazas and bike paths, never sidewalks, crosswalks, tunnels, or indoor or private paths. Each must be at least 15 m from roads and rail lines, at least 8 m from rivers and canals, and outside mapped lakes and ponds, with at most three per path.
  - **Random spots** are used only if OpenStreetMap can't be reached or nothing walkable is mapped nearby, and the map says so.
- **Proximity:** a node shows on the map within 400 m. It can be scratched within 75 m, and only when the phone's reported GPS error is ±100 m or better.
- **Nodes:** each node gives one card, then recharges for 4 hours.
- **Daily card:** one every 24 hours, no location needed.
- **Card draws:** weighted by rank: Common 45%, Uncommon 28%, Rare 17%, Legendary 8%, Mythic 2%.
- **Saving:** everything is saved in the phone's browser storage, including each card's frozen residue.

## Home-screen install

- **Install files:** `manifest.webmanifest`, the iPhone meta tags, and `icons/` make the app installable. From the home screen it opens full screen with no browser bar.
- **Offline shell:** `sw.js` caches the app's own files, so it opens instantly and on a weak signal.
  - The page and `js/config.js` are fetched from the network first, so updates and endpoint changes arrive right away.
  - Map tiles, OpenStreetMap lookups and logging are never cached.
- **Install tip:** after a tester's first card, a one-time tip explains how to install: the Share steps on iPhone, an Install button on Android. Install events are logged.
- **iPhone storage:** an installed iPhone web app keeps its own storage, separate from Safari's, so testers should install before they start collecting.
- **Version bumps:** when changing the `?v=` file versions in `index.html`, also bump `CACHE` in `sw.js` so old files are cleared.

## Debug

Tap the "Pecan Pie" title on the map five times within three seconds, or open the app with `#debug` at the end of the address. The Debug tab adds:

- Mock location, where tapping the map walks you there.
- Sliders for the radii, the GPS error limit, and node cooldown.
- Buttons to reseed nodes, reset cooldowns, and reset the daily card.
- A test-card button and every Scratch Lab control, plus CSV and event-log export.

Tap the title five times again to hide it.

## Logging

- **On the phone:** every event is stored locally (Debug, then Copy event log).
- **To a Google Sheet:** with an endpoint set, events also go to a Google Sheet. Set it in `js/config.js` for every tester, or in Debug for one phone.
  - Events queue on the phone and send in batches. They wait out offline stretches, and a final send runs when the app is closed.
  - Each event has an ID so repeats are dropped.
  - `apps-script/` holds the receiver script and its setup steps.
- **What's sent:** a random tester code (shown in Collection), the local date, and gameplay details. Never coordinates.

## Map

The base map is our own always-dark vector style (`js/mapstyle.js`), drawn with MapLibre GL (bundled in `vendor/maplibre/`, BSD-3-Clause) under Leaflet through the official `maplibre-gl-leaflet` bridge.

- **Tiles:** free, keyless vector tiles from [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema). The public service is provided as-is, with no uptime guarantee.
- **The look:** muted ground and roads, slightly brighter dashed footpaths, trails and plazas, small low-contrast labels, and no business icons.
- **Labels can't blank the map:** labels read the tiles through a second source, so if fonts fail to load only the labels disappear.
- **Fallback:** if the phone has no WebGL, or the style can't load within ten seconds, the map switches to OpenStreetMap's raster tiles, darkened with CSS, and logs a `map_fallback` event with the reason. Raster use follows the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/); a larger rollout needs a commercial or self-hosted tile source.
