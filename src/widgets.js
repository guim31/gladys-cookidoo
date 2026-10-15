// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+, forms behind buttons: 5.2.0+).
//
//   - shopping_list     : what is left to buy, what is checked, and four
//                         buttons: add an item, check one, uncheck one, clear
//                         the checked ones. The core has no list nor checkbox
//                         component (by choice): a tap opens a short form
//                         (#3168, Gladys 5.2.0) whose select lists the items.
//   - recipe_of_the_day : the recipes planned today in Cookidoo, with their
//                         picture, time and a link to the recipe; when none
//                         is, the next ones of the week.
//
// The builders are pure (snapshot in, content out); src/app.js reads the data
// and nudges the widgets when it changes. Content budget of the core: 8
// components, 1 focal, 2 texts, 4 buttons — checked by the tests with the
// SDK's validateWidgetContent.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MESSAGES, TEXT } from './i18n.js';
import { localDay } from './account.js';
import { recipesOn } from './device.js';

export const WIDGET = {
  SHOPPING_LIST: 'shopping_list',
  RECIPE_OF_THE_DAY: 'recipe_of_the_day',
};

/** Widget action keys (stable: they travel in the dashboards' contents). */
export const WIDGET_ACTION = {
  ADD: 'add_item',
  CHECK: 'check_item',
  UNCHECK: 'uncheck_item',
  CLEAR: 'clear_checked',
};

const TTL_SECONDS = 300;
const LIST_ROWS = 8; // card-list `list`: 8 items at most
const GRID_ITEMS = 12; // card-list `grid`: 12 items at most
const MAX_OPTIONS = 50;

const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The value of a select option: kind and id of an item. */
export const optionValue = (item) => `${item.kind === 'ingredient' ? 'i' : 'a'}:${item.id}`;

/** @returns {{ kind: 'ingredient' | 'additional', id: string } | null} */
export function parseOptionValue(value) {
  const match = /^([ia]):(.+)$/.exec(String(value ?? ''));
  if (!match) {
    return null;
  }
  return { kind: match[1] === 'i' ? 'ingredient' : 'additional', id: match[2] };
}

/** "Sel (1 Prise)", "Lait": an item as a select option or a row. */
const itemLabel = (item) =>
  cut(item.description ? `${item.name} (${item.description})` : item.name, 40);

/** The content saying why there is nothing to show. */
export function messageContent(text) {
  return { ttl_seconds: 60, components: [{ type: 'text', variant: 'body', text }] };
}

/**
 * @param {{ items: Array<object> }} shopping Account.snapshot.shopping
 */
export function buildShoppingListContent(shopping) {
  const toBuy = shopping.items.filter((item) => !item.checked);
  const checked = shopping.items.filter((item) => item.checked);
  const rows = [...toBuy, ...checked].slice(0, LIST_ROWS);
  const hidden = shopping.items.length - rows.length;

  const components = [
    { type: 'value', label: TEXT.toBuy, value: toBuy.length, icon: 'shopping-cart' },
    { type: 'value', label: TEXT.checked, value: checked.length, icon: 'check-circle' },
  ];
  if (rows.length === 0) {
    components.push({ type: 'text', variant: 'body', text: TEXT.listEmpty });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: rows.map((item) => ({
        title: cut(item.name, 60),
        ...(item.description || item.recipe
          ? { subtitle: cut([item.description, item.recipe].filter(Boolean).join(' · '), 60) }
          : {}),
        ...(item.checked
          ? { badge: { text: TEXT.badgeChecked, color: WIDGET_COLORS.SUCCESS } }
          : {}),
      })),
    });
    if (hidden > 0) {
      components.push({ type: 'text', variant: 'caption', text: MESSAGES.more(hidden) });
    }
  }

  components.push({
    type: 'button',
    label: TEXT.add,
    icon: 'plus',
    style: 'primary',
    action: {
      key: WIDGET_ACTION.ADD,
      fields: [{ key: 'name', type: 'string', required: true, label: TEXT.itemName }],
    },
  });
  for (const [key, label, icon, pool] of [
    [WIDGET_ACTION.CHECK, TEXT.check, 'check-circle', toBuy],
    [WIDGET_ACTION.UNCHECK, TEXT.uncheck, 'rotate-ccw', checked],
  ]) {
    if (pool.length === 0) {
      continue;
    }
    // Two items may share a label (salt in two recipes): the option values
    // stay distinct, the core requires unique values only. A label must be a
    // multi-language object: an item name is not translated, `en` alone is
    // the fallback of every language.
    const options = pool
      .slice(0, MAX_OPTIONS)
      .map((item) => ({ value: optionValue(item), label: { en: itemLabel(item) } }));
    components.push({
      type: 'button',
      label,
      icon,
      action: {
        key,
        fields: [
          {
            key: 'item',
            type: 'select',
            required: true,
            label: TEXT.itemName,
            options,
            default: options[0].value,
          },
        ],
      },
    });
  }
  if (checked.length > 0) {
    components.push({
      type: 'button',
      label: TEXT.clearChecked,
      icon: 'trash-2',
      style: 'danger',
      action: { key: WIDGET_ACTION.CLEAR, confirm: true },
    });
  }
  return { ttl_seconds: TTL_SECONDS, components };
}

/**
 * The image key of a recipe picture (`^[a-z0-9][a-z0-9-]{0,63}$`): one per
 * recipe, its picture does not change.
 * @param {{ id: string }} recipe
 */
export const recipeImageKey = (recipe) =>
  `recipe-${recipe.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64);

/**
 * The page of a recipe on the country site.
 * @param {{ host: string, language: string }} market
 * @param {{ id: string, custom: boolean }} recipe
 */
export const recipeUrl = (market, recipe) =>
  `https://${market.host}/${recipe.custom ? 'created-recipes' : 'recipes/recipe'}/${market.language}/${encodeURIComponent(recipe.id)}`;

/** Noon of a day, local time, as an ISO date (a day must not shift with the zone). */
const dayDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

/**
 * @param {object} snapshot Account.snapshot
 * @param {{ host: string, language: string }} market
 * @param {number} now
 * @param {(key: string, url: string) => void} registerImage
 */
export function buildRecipeContent(snapshot, market, now, registerImage) {
  const today = localDay(now);
  const card = (recipe, withDate) => {
    const item = { title: cut(recipe.name, 60) };
    if (withDate) {
      item.date = withDate;
    } else if (recipe.totalSeconds > 0) {
      item.subtitle = MESSAGES.minutes(Math.round(recipe.totalSeconds / 60));
    }
    if (recipe.image) {
      const key = recipeImageKey(recipe);
      registerImage(key, recipe.image);
      item.image = key;
    }
    if (recipe.custom) {
      item.badge = { text: TEXT.customRecipe, color: WIDGET_COLORS.INFO };
    }
    item.links = [{ url: recipeUrl(market, recipe), label: TEXT.openRecipe }];
    return item;
  };

  const planned = recipesOn(snapshot.week, today);
  if (planned.length > 0) {
    return {
      ttl_seconds: TTL_SECONDS,
      components: [
        { type: 'text', variant: 'heading', text: TEXT.today },
        {
          type: 'card-list',
          display: 'grid',
          items: planned.slice(0, GRID_ITEMS).map((recipe) => card(recipe)),
        },
      ],
    };
  }
  const upcoming = snapshot.week
    .filter((entry) => entry.day > today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .flatMap((entry) => entry.recipes.map((recipe) => card(recipe, dayDate(entry.day))))
    .slice(0, GRID_ITEMS);
  if (upcoming.length === 0) {
    return {
      ttl_seconds: TTL_SECONDS,
      components: [
        { type: 'text', variant: 'heading', text: TEXT.nothingToday },
        { type: 'text', variant: 'body', text: TEXT.nothingThisWeek },
      ],
    };
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      { type: 'text', variant: 'heading', text: TEXT.nothingToday },
      { type: 'text', variant: 'caption', text: TEXT.comingUp },
      { type: 'card-list', display: 'grid', items: upcoming },
    ],
  };
}
