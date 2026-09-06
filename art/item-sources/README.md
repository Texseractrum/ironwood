# Item artwork

All 19 inventory items have a reusable GLB in `public/assets/models/items/` and a
192 × 192 transparent PNG portrait in `public/assets/icons/items/`. Portraits are
rendered from those models with the same orthographic studio lighting. Only the
small PNGs load in the UI; no extra WebGL contexts or per-frame icon renders.

## Sources

Downloaded 2026-09-06. Original downloaded models are kept here so regeneration
works offline. All third-party models below are CC0 1.0 (public domain).

| Source | Files | Used for |
| --- | --- | --- |
| [Kenney Survival Kit](https://kenney.nl/assets/survival-kit), Kenney | `kenney/tree-log.glb`, `resource-planks.glb`, `resource-stone.glb`, `tool-pickaxe-upgraded.glb`, `Textures/colormap.png` | Timber, planks, stone, recolored iron ore/coal/copper, steel pickaxe |
| [Collectible Gear](https://poly.pizza/m/1tgrqxAQia), Quaternius | `quaternius/gear.glb` | Brass gear and mechanism assembly |
| [Sword](https://poly.pizza/m/9lLmH8Et4K), Quaternius | `quaternius/sword.glb` | Iron sword |
| [Spear](https://poly.pizza/m/fH1zmvjPNx), Quaternius | `quaternius/spear.glb` | Steel spear |

Kenney's license is included in `kenney/License.txt`. Quaternius's source pages
identify each model as CC0: https://creativecommons.org/publicdomain/zero/1.0/.

Ironwood's cast ingots, banded steel, stacked auric alloy, crystal glass, club,
aether crystals, circuits, and cores are original procedural models. Mechanisms
combine the sourced gear with an original frame. See the generator for edits.
Sword and spear materials are harmonized to the Ironwood metal/wood palette;
the spear's shaft and head are widened for readability in small inventory slots.

## Regenerate

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/create_item_assets.py
```

Append `-- gear sword` to render selected items. The script creates its own scene
and does not open or overwrite `art/ironwood.blend`. Exported GLBs retain natural
orientation; long items are posed diagonally only for the portrait.
