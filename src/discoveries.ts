import { BUILDABLE, CRAFTS, DEFS, ITEMS, entries, type Craft, type Item, type Stock } from './data';
import {ownsBuilding,type State} from './simulation';

/** Inventory keys survive spending the last item, so discoveries survive saves too. */
export function discoveries(state: State) {
  const materials = new Set<Item>();
  const remember = (stock: Stock) => {
    for (const [item] of entries(stock)) if (Object.hasOwn(ITEMS, item)) materials.add(item);
  };
  remember(state.inventory);
  remember(state.produced);
  for (const building of state.buildings) {
    if (!ownsBuilding(state,building)) continue;
    // Recover discoveries from older factories, including goods already in transit.
    remember(DEFS[building.kind].cost);
    remember(building.input);
    remember(building.output);
    if (building.item) materials.add(building.item);
  }
  const knows = (stock: Stock) => entries(stock).every(([item]) => materials.has(item));
  return {
    materials: [...materials],
    blueprints: BUILDABLE.filter(kind => {
      const def = DEFS[kind];
      return def.unlock <= state.unlock && knows(def.cost) && knows(def.input || {});
    }),
    recipes: (Object.keys(CRAFTS) as Craft[]).filter(kind => knows(CRAFTS[kind].cost)),
  };
}

export type Discoveries = ReturnType<typeof discoveries>;
export type Discovery = { type: 'material'; item: Item } | { type: 'blueprint'; kind: Discoveries['blueprints'][number] } | { type: 'recipe'; recipe: Craft };
