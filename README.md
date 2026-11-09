# Pecan Pie pilot

A location-based scratch card prototype for the validation pilot. Walk to nodes on the map, scratch a card, and build the Harbor Lights set.

It's a static web app with no build step and no backend. Host the folder anywhere that serves HTTPS (GitHub Pages works), then open it on a phone.

## What's here

- `index.html`: app shell with Map, Scratch, Collection, and Debug views.
- `js/engine.js`: the scratch, grading, and reveal engine from the Scratch Lab.
- `js/pilot.js`: map, nodes, proximity, daily card, collection, inspect, and event logging.
- `css/engine.css`, `css/pilot.css`: styles.
- `vendor/leaflet/`: Leaflet 1.9.4 (BSD-2-Clause, license included).

## How it works

- **Map:** OpenStreetMap tiles. The first good GPS fix seeds 15 nodes around the player: three within about 140 m, the rest out to about 600 m.
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

Every event is stored on the phone (Debug, then Copy event log). Set a log endpoint in Debug to also send each event as a JSON POST, for example to a Google Apps Script web app that appends rows to a Sheet. Events carry a tester ID, not location coordinates.

## Tile usage

Map tiles come from tile.openstreetmap.org under the OpenStreetMap tile usage policy, which allows light use like a small pilot as long as the attribution stays visible. A larger rollout needs a commercial or self-hosted tile source.
