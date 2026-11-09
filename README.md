# Pecan Pie pilot

A location-based scratch card prototype for the validation pilot. Walk to nodes on the map, scratch a card, and build the Harbor Lights set.

It's a static web app with no build step and no backend. Host the folder anywhere that serves HTTPS (GitHub Pages works), then open it on a phone.

## What's here

- `index.html`: app shell with Map, Scratch, Collection, and Debug views.
- `js/engine.js`: the scratch, grading, and reveal engine from the Scratch Lab.
- `js/pilot.js`: map, nodes, proximity, daily card, collection, inspect, and event logging.
- `js/config.js`: the log endpoint.
- `apps-script/`: the Google Sheets log receiver and summary.
- `css/engine.css`, `css/pilot.css`: styles.
- `vendor/leaflet/`: Leaflet 1.9.4 (BSD-2-Clause, license included).

## How it works

- **Map:** OpenStreetMap tiles. The first good GPS fix places 15 nodes within about 650 m of the player, at least three within 200 m when the area allows. Walking 500 m from where nodes were last placed loads a new batch.
- **Node placement:** one OpenStreetMap (Overpass) request per area. Nodes are kept at least 45 m apart.
  - **Public places come first:** public art, viewpoints, landmarks, historic sites, parks, gardens, fountains, libraries, museums, cafes, piers, lighthouses and similar. Anything private, plus memorials, graves, shrines, playgrounds, schools and places of worship, is skipped. Places within 6 m of a road centerline, such as art in a median, are skipped too.
  - **Walkable spots fill the gaps:** points along footpaths, trails, plazas and bike paths, never sidewalks, crosswalks, tunnels, or indoor or private paths. Each must be at least 15 m from roads and rail lines, at least 8 m from rivers and canals, and outside mapped lakes and ponds, with at most three per path.
  - **Random spots** are used only if OpenStreetMap can't be reached or nothing walkable is mapped nearby, and the map says so.
- **Proximity:** a node shows on the map within 400 m. It can be scratched within 75 m, and only when the phone's reported GPS error is ±100 m or better.
- **Nodes:** each node gives one card, then recharges for 4 hours.
- **Daily card:** one every 24 hours, no location needed.
- **Card draws:** weighted by rank: Common 45%, Uncommon 28%, Rare 17%, Legendary 8%, Mythic 2%.
- **Saving:** everything is saved in the phone's browser storage, including each card's frozen residue.

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

## Tile usage

Map tiles come from tile.openstreetmap.org under the OpenStreetMap tile usage policy, which allows light use like a small pilot as long as the attribution stays visible. A larger rollout needs a commercial or self-hosted tile source.
