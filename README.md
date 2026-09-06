# Ironwood

Ironwood is a multiplayer factory-building and exploration game built with Three.js, TypeScript, and Cloudflare Workers. Everyone joins the same persistent world, with their own home plot and supplies.

Play at [ironwood.sparkles.dev](https://ironwood.sparkles.dev).

All 19 materials and weapons use individual 3D-rendered portraits in the inventory,
crafting recipes, building costs, discoveries, atlas, and equipped-weapon display.
The matching GLBs, source credits, and offline regeneration instructions are in
[the item artwork guide](art/item-sources/README.md). With Vite running, use
`npx tsx tools/item-icons-browser-test.ts` to verify the artwork and responsive UI
against a disposable simulation.

X login and character nameplates are documented in [X_AUTH.md](X_AUTH.md), including app setup, callback URLs, and account-linked progress.

**Leaderboard** in the top navigation ranks X-linked engineers by total materials currently in their account inventory, counting each item equally. Gathering and collecting add to the total; spending supplies lowers it. It includes offline accounts and zero scores, shows X profiles and your own rank, and refreshes every 15 seconds while open. Clan members use their shared inventory total; equal totals share a rank. Guests can browse and log in with X to join. Rankings use saved server inventories, with 50 engineers per page. Run `node tools/leaderboard-browser-test.mjs` after `npm run build` to check the UI against an isolated local Worker.

Trees, rocks, mineral outcrops, and ruins have collision and can be harvested. Press **E** for the nearest material, or click a particular object while standing nearby. Timber, stone, and ores go directly into your inventory; crystals still require the steel pickaxe. Depleted objects disappear, stop blocking movement, and stay cleared after reloading. Clear scenery before building over it. Extractors replace their deposit's scenery and draw from the same finite reserves.

Each chunk also has a nearby copse, iron outcrop, coal bed, and copper outcrop, with extra trees and rocks between sites. Raised ridges and rocky slopes surround level workshop clearings and deposit pads. Saved seams and factories retain their coordinates. Characters, scenery, construction previews, and foundations follow the terrain.

Successful gathering plays an axe or pickaxe swing with impact chips, visible to other engineers. Click a deposit's marker to keep hand-mining after its surface pieces are cleared. Place a lumber camp on timber, an iron mine on iron, or a mineral drill on coal, copper, or crystal without clearing the outcrop first. Dismantling returns access to the remaining seam; hand-mining is unavailable while a machine occupies it.

The minimap and atlas cover unexplored terrain with fog. Walking reveals the surrounding five tiles and identifies nearby deposits. Your surveyed terrain persists with your engineer; other players' exploration does not reveal your map. Unseen deposits and workshops are hidden until discovered.

Nearby engineers (within 92 m) appear as colored person markers on both maps, even
in fog, without revealing terrain or deposits. The minimap shows a nearby count;
select it or press **M** for names and live distances, nearest first. Select an
engineer in the atlas list or click their marker to set a waypoint to their
position at that moment. Departed players disappear automatically. More distant
engineers remain visible on surveyed terrain. With Vite running, use
`PLAY_URL=http://localhost:5173 npx tsx tools/map-players-browser-test.ts` to check
presence, movement, waypoints, disconnection, and responsive layouts with disposable players.

Run `npx tsx tools/world-interaction-browser-test.mjs` against the local game server (or set `PLAY_URL`) to verify collision, harvesting, inventory, persistent clearing, and map fog in the browser.

Terrain generates in chunks as you explore; no room code is needed.

See [the shared-world guide](OPEN_WORLD.md) for map controls, protected bases, identity/persistence behavior, runtime limits, and deployment details. Older solo saves and room data are retained, but the current client uses the public world.

## Explore and play

- **Combat**: engineers have 100 health. Craft weapons with **C**; your strongest owned weapon always equips automatically: steel spear, iron sword, timber club, then fists. Clan equipment counts too. Press **K** or use **Attack** to swing at any time during play, including while moving or with no enemy nearby. Nearby enemies are targeted automatically; click an enemy in inspect mode to choose a target. Damage still respects reach and cooldowns. Clan members cannot hurt each other. The compact health meter stays in the HUD; overhead bars appear when hurt or protected.
- **Mountains**: every terrain slope is climbable, with no height limit. Your engineer follows the ground on the way up and down; trees, rocks, and machines still block movement.
- **Respawning**: death returns you to your own base after 3 seconds, with full health and 5 seconds of protection (ending when you attack). Supplies, equipment, and factory progress are retained. Your own home plot heals 5 health per second after 6 seconds out of combat.
- **Creatures**: Ironwood wolves and aether slimes roam outside home plots. They chase nearby engineers, attack, and drop crafting materials when defeated. Creatures return after 30 seconds once their spawn is clear. All damage, range checks, cooldowns, kills, and loot are decided by the server.

Combat checks: `npx tsx tools/combat-worker-test.ts` runs against a disposable local Worker and verifies SQLite restart recovery. With Vite running, `PLAY_URL=http://localhost:5173 npx tsx tools/combat-browser-test.ts` checks two players, crafting, combat, death, respawning, mobs, and responsive controls without changing the running world.

- **M** opens the pannable, zoomable atlas. Your home clearing is surveyed on arrival. Explore to reveal the wider world and its deposits. Resource filters, distances, home markers, and waypoints help you navigate.
- **E** gathers nearby timber, stone, iron, coal, copper, or crystals. Reserves and cleared scenery are shared; discoveries are personal and inventory is shared within your clan.
- **C** opens discovered crafting recipes. Coal and iron make steel; steel and copper lead to the pickaxe needed for aether crystals.
- Build powered extractors, machines, conveyors, and storage. Coal power plants mine and burn their own coal deposit; aether engines consume crystals. Other engineers see machinery and goods move live.
- **World** shows engineers online, lets guests name their engineer, and sets waypoints to workshops. Home plots protect their buildings and resources. Owners and their clan can alter or collect from their factories.
- **Clans**: walk within 3 tiles of another engineer and choose **Team up**. They can accept or decline. Accepting creates a clan (up to 8 engineers), combines both inventories, and shares tools, factory progress, and access to each member’s home plot. Everyone spends the same supplies, including while building, crafting, upgrading, or feeding machines. Conveyors connect across clan members’ machines. The clan panel shows online/offline members and waypoints to their bases.
- Invitations expire after 60 seconds or when either engineer disconnects or walks away. Clan membership and supplies persist across reloads and server restarts. Any member can invite a solo engineer; two established clans cannot merge. This version does not support leaving or dissolving clans.
- Press **/** and start typing directly above your engineer. Players who can see your character see the text live, including edits and deletions. **Esc**, clicking away, or switching tabs finishes the message and adds one entry to chat history. **World chat** shows completed messages only; its drafts stay private until you press **Enter** or select **Send message**.
- Small contextual hints introduce movement, chat, gathering, construction, power, storage, maps, crafting, clans, progression, and settings. They appear one at a time above **Production / Logistics / Power**, hide while that dock is expanded, pause during chat and dialogs, and remember dismissed or learned controls. Use **Hide hints** on a tip or **Settings → Player hints** to disable or replay them. **H → All controls & player hints** keeps the full reference available.

## Develop locally

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev:multiplayer
```

Open http://localhost:8787 in two isolated browser profiles. Each receives a different engineer and base. For frontend hot reload, also run `npm run dev` and open http://localhost:5173; Vite proxies the game API to the Worker. A static-only preview cannot run the shared simulation.

## Deploy and verify

```sh
npm test
npm run build
node tools/shared-world-test.mjs
node tools/shared-world-browser-test.mjs
node tools/clans-browser-test.mjs
node tools/world-chat-test.mjs
npx tsx tools/chat-browser-test.ts
npm run deploy:check
npm run deploy
```

The Worker serves assets and WebSockets together on `ironwood.sparkles.dev`. A SQLite-backed `SharedWorldObject` owns the public world's inventories, production, power, construction, exploration, and recent chat history. The new namespace is added through migration v2; it does not delete legacy room objects.

Actions persist immediately, ongoing production is checkpointed every five seconds, and disconnects are saved. The world runs while someone is connected and rests when empty. Guest identity persists in browser storage; account setup is described in [X_AUTH.md](X_AUTH.md).

The shared-world integration test allocates an available local port and a disposable storage directory, then verifies restoration after restarting the Worker. Browser tests use port 8787 by default. Setting `GAME_URL` runs the browser check against another origin; doing so on production creates two guest home plots.

## Controls

### Phones and tablets

Touch devices and windows up to 800px wide use a compact HUD in portrait and landscape. Drag the thumb stick to walk and move it to the edge to run. Gather and Attack work while another finger holds the stick. Releasing or cancelling a touch, switching apps, rotating the phone, or opening a panel stops movement.

Use the bottom bar for Build, Craft, Map, Chat, and Menu. Choose a blueprint and tap the ground to place it; drag to draw conveyors. Rotate changes the output direction, and Done returns to inspection. Menu includes camera zoom and rotation, Journey, World, Clans, Character, sound, and settings. Incoming clan invitations appear as a badge on Menu. Supplies and blueprints scroll horizontally. Panels scroll within the screen, and chat follows the phone keyboard’s available space.

Run `npx tsx tools/mobile-browser-test.ts` with Vite running to check touch interactions and panels at 320px, 390px, landscape, and tablet sizes using a disposable world.

### Character customization

Press **V** or select the shirt button beside Settings to open your engineer’s wardrobe. Choose from six skin tones, six jacket colors, four apron colors, four hair colors, a field hat, work cap, or no hat, and optional brass goggles. Rotate the live 3D preview to inspect your outfit. **Surprise me** creates a random combination; **Reset look** restores the original palette.

**Save look** saves to your engineer’s server profile and updates other players immediately. **Cancel**, the close button, and Escape discard unsaved choices. Appearance survives reloads and server restarts; linking a guest to X keeps their outfit along with their workshop. Clan members each keep their own appearance. Cosmetics are free and do not change tools, stats, or supplies.

Run `npx tsx tools/character-browser-test.ts` after `npm run build` for an isolated two-player browser check. Appearance validation and rendering checks run with `npm test`; `node tools/shared-world-test.mjs` also verifies outfits survive restarting the world server.

### Welcome and sound

New engineers receive an illustrated welcome from the Mechanist’s Guild. **Begin building** selects the lumber camp and marks the forest for the first tutorial objective; **Look around first** leaves the tutorial available. Dismissing the introduction is remembered for that engineer in this browser. Return to it from **Field guide (H) → Revisit the introduction**.

Sound effects start after your first interaction. Timber chopping, mining, crystal strikes, construction, dismantling, crafting, collecting, loading, footsteps, discoveries, and chapter milestones each have their own cue. Gathering impacts follow the tool swing; successful action sounds follow the server’s response. Use the speaker button to mute, or **Settings → Audio** to adjust the volume and test a sound. Mute and volume persist in this browser, and background tabs are silent.

`npx tsx tools/intro-audio-browser-test.ts` checks the introduction, saved preferences, keyboard and narrow-screen behavior, action feedback, and all generated audio signals against a disposable shared-world fixture.

### Graphics and frame rate

Open Settings → Graphics and choose **Performance** for smoother play on high-resolution displays. Touch devices default to **Performance**, desktop to **Balanced**; a saved preference always takes priority. **Quality** prioritizes sharpness. The optional FPS counter and quality preference persist in this browser, separately from your workshop save. The controls support keyboard selection.

Settings apply immediately. Save and export feedback appears inside Settings; account details include a Back button. Dialogs keep their close button reachable while scrolling and return keyboard focus to their opener. The build toolbar supports arrow-key category selection and pinning blueprints open. Chapter details can be collapsed, and start collapsed on phones.

With `npm run dev` running, `npx tsx tools/ui-controls-browser-test.ts` checks all eight dialogs and desktop controls at 1440 and 1024px, along with settings persistence, sound preview, save/export feedback, keyboard navigation, and focus restoration. The mobile checks above cover smaller screens. Both use disposable world fixtures.

Performance caps rendering at 1× pixel density and uses 1024px shadows; Balanced caps density at 1.25× and uses 2048px shadows; Quality allows up to 2× with 2048px shadows. Performance also disables the HUD's background blur. Static scenery and repeated building bodies are instanced, shadow refreshes are budgeted, and unchanged HUD content is retained. Background tabs do not render.

Rendering is synchronized to the display: these settings reduce work per frame, but do not force a 60Hz display above 60 FPS.

### Keyboard and mouse

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move relative to the camera |
| Shift | Run |
| E | Mine nearby timber, iron, coal, copper, or crystal |
| K / Attack button | Swing your best weapon; hit the nearest enemy within reach |
| / | Type an overhead world-chat message |
| M | Open the expedition atlas and set a waypoint |
| J | Open the Journey book: chapters, upgrades, badges and the final commission |
| L | Open the leaderboard |
| B / number keys | Select a construction tool |
| Click | Gather a resource, place a building, or inspect a machine |
| Drag with conveyor selected | Preview a continuous route with automatic corners and its timber cost; release to build |
| Retrace a conveyor drag | Shorten the preview without spending materials |
| R | Rotate the selected building's output, the end of a conveyor preview, or an existing conveyor under the pointer |
| Escape / right click | Cancel construction, including an unbuilt conveyor preview |
| X | Toggle dismantling, with material and inventory refunds |
| C | Handcraft starter materials |
| Space | Pause/resume solo play; the shared world keeps running |
| Q | Rotate the camera |
| F | Recenter and reset zoom |
| Mouse wheel | Zoom |
| H | Open the field guide |

Machines and storage can be inspected with a click. Collect moves their output into your construction inventory; Load inputs supplies several batches from your inventory. Keep belt outputs pointed toward the next machine's input side. Machines accept inputs from the three sides other than their output.

Windmills cost 14 timber and 4 planks and provide 12 power without fuel, enough for one lumber camp, sawmill, iron mine, and furnace. Place windmills at least 4 tiles apart: expanding with wind takes more space and wiring. Discover coal and copper to reveal the coal power plant, which costs 12 planks, 8 ingots, and 6 copper and must be built directly on an unoccupied, nonempty coal deposit. Its integrated mine burns 1 coal every 20 seconds for 72 power, with no outside power needed to start. When the seam runs out, it stops unless supplied with coal by conveyor or manually. Mineral drills remain available when you want coal as a crafting ingredient instead. Existing off-deposit steam engines retain their delivered-fuel operation.

Posts automatically wire to generators and other posts within 5 tiles; connected nodes supply machines within 4.6 tiles. Solid, hanging wires remain visible during normal play and fuel outages. Highlight the power network to trace the connections. Overloaded networks slow their machines proportionally.

Power checks: `npx tsx --test tests/power.test.ts` verifies starter capacity, coal placement, finite fuel, shared-world actions, save compatibility, and cables over terrain. With Vite running, `PLAY_URL=http://localhost:5173 npx tsx tools/power-browser-test.ts` checks the power controls and rendering against a disposable world.

## Progression

The campaign has eight chapters. Open **Journey (J)** to see current objectives, upcoming rewards, and earned badges. Production objectives count factory output, not handcrafting.

1. **A spark of possibility:** follow the tutorial and produce 10 iron ingots.
2. **The wheels of progress:** produce 8 gears to unlock assembly and dispatch.
3. **Your first commission:** dispatch 20 mechanisms to unlock the steel foundry and machine upgrades.
4. **Built to last:** produce 20 steel and upgrade a chest to 400 items.
5. **Light in the mountains:** craft a steel pickaxe, produce 20 crystal glass in a kiln and 12 circuits in an etcher.
6. **An age of alloys:** produce 24 auric alloy in an alloy forge and own a 1,200-item steel vault.
7. **The heart of Ironwood:** produce 6 aether cores, upgrade two production machines, and own a 4,000-item aether vault.
8. **A light for everyone:** dispatch 100 mechanisms, earn throughput mastery, and contribute 12 cores, 30 alloy, and 30 glass in Journey to light the guild beacon.

Inspect a chest to upgrade its capacity from **100 → 400 → 1,200 → 4,000**. Contents and connected belts stay in place. Production machines have precision (1.5×) and aether (2×) drives at unchanged power demand. Upgrades cost materials and unlock by chapter; dismantling refunds every upgrade and any reserved ingredients. Higher-tier chests are visibly taller, and upgrades add metal bands.

Throughput mastery requires at least 8 deliveries/minute at 80% of installed assembly capacity for three consecutive minutes. Idle benches count against utilization, including the extra capacity of upgraded benches. Construction, dismantling, rotation, and upgrades restart the measurement; earned mastery remains permanent.

Completing the final commission awards **Master of Ironwood**, a permanent badge, a dedicated ending, and a downloadable SVG certificate. The workshop stays playable, and the ending can be revisited from Journey. Completion and upgrades save with personal or clan progress. Old three-chapter wins keep their guild badge and mastery and resume at chapter four.

The simulation has finite input/output buffers and deposit reserves, reserved ingredient space, belt backpressure, fair splitters and mergers, disconnected power handling, and deterministic save/load. Draw conveyors over mountains as usual: slats, rails, previews, and goods follow the slopes automatically and ramp onto level machine platforms. Slopes cost the same one timber per tile and keep the usual transport rate; crossing belts still requires rerouting. Player construction inventory has no carrying limit and wind output is fixed. Machinery and character animation use articulated Blender object pivots driven by the game. Solo production pauses while a dialog is open, the game is paused, or the tab is hidden. Shared rooms continue while a crew member remains connected.

## Verification

```sh
npm test
npx playwright install chromium
node tools/browser-test.mjs
node tools/graphics-test.mjs
npx tsx tools/benchmark.ts
```

The browser test expects the development server on port 5173 and uses a separate disposable browser session. It does not modify your normal browser save. Screenshots are written under `.context/`.

`PLAY_URL=http://localhost:5173 npx tsx tools/progression-browser-test.ts` checks the Journey book, all chest tiers, advanced blueprints, commission validation, certificate download, reload persistence and responsive layouts. It uses the real shared-world simulation behind an isolated WebSocket fixture, without changing the running world's data. `tests/progression.test.ts` covers progression, accounting, ownership, production, mastery and save migration.

To profile a stable production build, run `npm run build` and `npm run preview`, then `PLAY_URL=http://localhost:4173 npx tsx tools/profile-rendering.ts production`. The 5.5-second samples cover a starter workshop at 1× and Retina density plus a fixed dense-factory layout. Reports include frame times, draw calls, script time, and HUD mutations under `.context/`. Browser checks also accept `PLAY_URL`. Do not compare CPU timing across development and production builds as an isolated optimization result.

Verified on 2026-09-06, Apple M5 / macOS 26.6.2 / Chromium 153 with the Metal renderer:

- 21 simulation tests pass, including the empty start, tutorial progression and save/reload, the complete factory progression using earned materials, earned-resource crafting to the aether engine, finite mining, fuel exhaustion, legacy saves, and multiplayer command validation.
- Browser checks pass for loading, placement costs, overlap rejection, inspection, dismantling refunds, continuous conveyor routes/corners, movement, crafting, save/reload, and the field guide. No application errors or missing icon warnings.
- Layout inspected at 1440×1000 and 1024×768.
- Starter workshop measured approximately 60 fps at 1440×1000; this is not a guarantee for larger factories or other hardware. Software-rendered headless Chromium was substantially slower; the browser test selects Metal on this Mac.
- Synthetic simulation benchmark: 100 source/sink pairs and 1,000 belt tiles, 600 updates in approximately 187 ms (0.31 ms/update). This exercises simulation scaling beyond the island's playable area; it is not a rendering benchmark of a factory that large.
- Type checking and production build pass. Vite reports its standard size advisory for the Three.js vendor bundle (approximately 135 KB gzip).

## Project layout

```text
art/ironwood.blend          Editable Blender scenes and asset gallery
public/assets/models/      18 original GLB assets
src/data.ts                Building definitions, costs, recipes, resource sites
src/simulation.ts          Inventories, routing, power, progression, persistence
src/world.ts               Three.js scene, animation, camera, character, picking
src/ui.ts                  Construction dock, objectives, inspection, dialogs
src/style.css              Interface layout and styling
tests/simulation.test.ts   Simulation and progression regression tests
tools/blender/             Reproducible Blender asset generation
tools/browser-test.mjs     Browser interaction verification
```

To regenerate models through Blender MCP, execute the generator with its `__file__` set, then call `make_assets('machines')`, `make_assets('details')`, and `make_assets('save')`. Each call may reload the script; MCP code execution namespaces do not persist. The generator replaces only its own `IW_` asset collections and `Gallery ` objects, preserves the original Blender scene, and exports only the active asset scene.

## References

Visual inspiration: [Besiege](https://store.steampowered.com/app/346010/Besiege/). Factory-building inspiration: [Satisfactory](https://www.satisfactorygame.com/). Ironwood uses original artwork and code; no assets from either game are included.

Three.js and Lucide are MIT-licensed dependencies. Cormorant Garamond and DM Sans are distributed through Google Fonts under the SIL Open Font License.
