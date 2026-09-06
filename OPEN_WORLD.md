# Ironwood shared world

Open https://ironwood.sparkles.dev. The client connects automatically to `/api/world`; no room code is needed. All visitors enter the same persistent world. Each engineer receives a separate clearing, starter supplies, and personal production progress. Nothing is prebuilt.

## Explore and build

- Open **Map** or press **M**. Your arrival survey reveals the home clearing and its timber and iron deposits. Walk beyond it to reveal more terrain; discoveries are personal and survive reconnects.
- Drag the atlas to pan, scroll or use +/− to zoom, and choose **Locate me** or **My base** to orient yourself. Click a destination to set a waypoint. The resource list provides the same action without clicking the canvas. With the map focused, arrows pan and Enter marks its center.
- The legend identifies timber, iron, coal, copper, and rare aether crystals. Filter the discovered resource list to find what you need. Unexplored deposits remain hidden. The HUD compass gives distance and world direction; **Q** rotates the camera and **Shift** runs.
- New engineers start in neighboring chunks, normally 32 tiles (74 metres, about a 10-second sprint) apart. A 12-tile-radius boundary protects each home’s construction and resources, leaving eight tiles between neighboring plots. Claimed or built-up plots are skipped; saved homes and returning engineers keep their existing locations. Nearby workshop buttons show their owners and online status; choose one to visit.
- Buildings, buffers, conveyors, fuel, mining depletion, and engineers’ movement update live. Owners and their clan can modify or collect from their buildings. Conveyors can connect machines belonging to the same clan; unrelated factories cannot siphon goods. Inventories, tools, chapter unlocks, and guild commissions are shared within a clan; unclaimed terrain and deposits are shared by everyone.
- Meet within 3 tiles and choose **Team up**. The other engineer must select **Accept & share** before inventories and workshops are united. Clans support 8 engineers, including offline members. Invitations last 60 seconds and require both players to remain nearby and online. Open **Clans** for the roster and base waypoints. Membership persists, with no leaving/dissolving or merging established clans in this version.
- The tutorial follows your own factory and nearby deposits, not a fixed island location. Mine with **E**, craft with **C**, and build powered production lines. Resource reserves are finite, so explore new regions when deposits run dry.

## Identity and persistence

Guest identity is remembered in browser storage. Reloading or returning in that browser restores the same engineer and base, without granting extra starting supplies. A second active tab takes over the same engineer. Clearing site data or using another browser creates a new guest. Account-login work is separate from the guest/session mechanism described here.

Joining or reconnecting places your engineer at the center of your own base and immediately centers the camera there. If machines occupy the center, arrival uses nearby clear ground inside your claim. Movement follows the textured terrain surface; mountain faces steeper than 45 degrees block walking on both the client and server.

The server saves completed actions immediately, checkpoints ongoing production every five seconds, and saves disconnects. An abrupt process failure can roll back ongoing production/movement to the last checkpoint. The world simulates while at least one engineer is connected; when everyone leaves it rests. There is no offline catch-up. Opening a menu does not pause other engineers.

Old solo saves remain untouched in browser storage. Legacy room Durable Objects remain available at their old API route and are not deleted by the open-world migration, but the current client enters the public world instead.

## Runtime

`SharedWorldObject` is a SQLite-backed Cloudflare Durable Object. The `WORLD` namespace resolves the fixed name `ironwood-public-v1`, so all users share one authoritative simulation. Migration `v2` adds this class alongside the retained `GameRoom` namespace. Static assets and the WebSocket API are served by the existing `ironwood-expeditions` Worker on the custom domain.

Terrain is generated from a stable seed in 32×32-tile chunks. A 5×5 neighborhood streams around the player and decorative meshes are batched. Server snapshots contain nearby buildings plus all of your own buildings, nearby deposit changes, personal survey data, and public engineer/base positions. SQLite stores changed building/profile/deposit rows; immutable terrain need not be stored.

This is an expandable prototype, not an unlimited-scale MMO: coordinates are bounded to ±1,000,000 tiles for validation, with a current cap of 128 connections, 300 buildings per engineer, and 10,000 buildings per world. Active simulation timers incur Durable Object duration usage. Further scale requires regional simulation/replication and load testing; a larger map does not remove a single object's capacity limits.

## Develop and verify

```sh
npm install
npm run dev:multiplayer
```

Open http://localhost:8787. Two isolated browser profiles create separate engineers automatically. For frontend hot reload, also run `npm run dev`; Vite on port 5173 proxies `/api` and WebSockets to the Worker on 8787. A static-only preview cannot run the authoritative world.

```sh
npm test
npm run build
node tools/shared-world-test.mjs
node tools/shared-world-browser-test.mjs
node tools/clans-browser-test.mjs
npx wrangler deploy --dry-run
```

The first integration check starts its own local Worker on an available port, uses a disposable `.context/world-storage-*` directory, and verifies SQLite restoration after restarting the process. The browser check uses port 8787 by default and verifies automatic multiplayer, persistent guest identity, live presence/name changes, atlas controls, and responsive layouts. `GAME_URL` can point the browser check at production; it creates two guest home plots, so do not repeatedly run it against production unnecessarily. Screenshots are stored under `.context/`.

Deploy with `npm run deploy`, then verify `/api/health` returns `world: "ironwood"` and `procedural: true`, confirm the `WORLD` binding through Cloudflare, and check two browsers on the production domain.
