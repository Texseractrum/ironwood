import type {Item} from './data';

/** Static portraits of the matching GLBs in /assets/models/items. */
export const itemIconUrl = (item:Item) => `/assets/icons/items/${item}.png`;

/** Item names belong to the surrounding label; the portrait is decorative. */
export function itemIcon(item:Item) {
  return `<img class="item-icon" src="${itemIconUrl(item)}" width="192" height="192" alt="" aria-hidden="true" draggable="false" decoding="async"/>`;
}
