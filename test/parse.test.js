// -----------------------------------------------------------------------------
// From the recorded Cookidoo answers to the integration's model, and finding
// an item by the name a scene gives.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  durationSeconds,
  ingredientDescription,
  parseCustomRecipe,
  parseShoppingList,
  parseSubscription,
  parseWeek,
  recipeImageUrl,
} from '../src/cookidoo/parse.js';
import { findItem, normalizeName } from '../src/match.js';
import { json } from './helpers/fakeCookidoo.js';

test('the shopping list: ingredients of the recipes and free items', () => {
  const { recipes, items } = parseShoppingList(json('shopping-list.json'));
  assert.deepEqual(
    recipes.map((r) => [r.name, r.custom, r.ingredientIds.length]),
    [
      ['Mini-Pavlova mit Orangen', false, 7],
      ['Vollwert-Brötchen/Baguettes', false, 7],
      ['Vongole alla marinara', true, 10],
    ],
  );
  const sugar = items[0];
  assert.deepEqual(sugar, {
    id: '01JBQFM44769BTC1P25CNDWJK9',
    kind: 'ingredient',
    name: 'Zucker',
    description: '200 g',
    checked: false,
    recipe: 'Mini-Pavlova mit Orangen',
  });
  const free = items.filter((item) => item.kind === 'additional');
  assert.deepEqual(
    free.map((item) => [item.name, item.checked]),
    [
      ['Fleisch', false],
      ['Vogel', true],
    ],
  );
});

test('a shopping list answer that is not an object is an API change', () => {
  assert.throws(
    () => parseShoppingList([]),
    (err) => err.kind === 'api',
  );
  assert.deepEqual(parseShoppingList({}), { recipes: [], items: [] });
});

test('quantities: a value, a range, a unit', () => {
  assert.equal(ingredientDescription({ quantity: { value: 200 }, unitNotation: 'g' }), '200 g');
  assert.equal(
    ingredientDescription({ quantity: { from: 1, to: 2 }, unitNotation: 'TL' }),
    '1 - 2 TL',
  );
  assert.equal(ingredientDescription({ quantity: { value: 4 }, unitNotation: '' }), '4');
  assert.equal(ingredientDescription({ quantity: null }), '');
});

test('the week plan, its times and pictures', () => {
  const days = parseWeek(json('calendar-week.json'));
  assert.deepEqual(
    days.map((d) => [d.day, d.recipes.map((r) => [r.name, r.totalSeconds])]),
    [
      ['2025-03-04', [['Waffles', 1500]]],
      ['2025-03-05', [['Moroccan Mint Tea', 1500]]],
    ],
  );
  assert.match(
    days[0].recipes[0].image,
    /^https:\/\/assets\.tmecosys\.com\/image\/upload\/t_web_shared_recipe_221x240\//,
  );
  const custom = parseWeek(json('calendar-week-custom.json'));
  assert.deepEqual(custom[1].customRecipeIds, [
    '01K2CVHD1DXG1PVETNVV3JPKWW',
    '01DELETEDRECIPE00000000000',
  ]);
  // An inline custom recipe is not asked again by id.
  assert.deepEqual(custom[2].customRecipeIds, []);
  assert.equal(custom[2].recipes[0].custom, true);
});

test('durations: seconds as text or number, ISO 8601', () => {
  assert.equal(durationSeconds('1500.0'), 1500);
  assert.equal(durationSeconds(600), 600);
  assert.equal(durationSeconds('PT30M'), 1800);
  assert.equal(durationSeconds('PT1H5M30S'), 3930);
  assert.equal(durationSeconds(''), 0);
  assert.equal(durationSeconds('soon'), 0);
});

test('a custom recipe, and a picture only from https', () => {
  const recipe = parseCustomRecipe(json('custom-recipe.json'));
  assert.equal(recipe.name, 'Vongole alla marinara');
  assert.equal(recipe.totalSeconds, 1800);
  assert.equal(recipe.custom, true);
  assert.equal(recipeImageUrl({ images: { square: 'http://insecure/x' } }), undefined);
  assert.equal(recipeImageUrl(null), undefined);
});

test('the subscription: the active one, or none', () => {
  assert.deepEqual(parseSubscription(json('subscriptions-regular-active.json')), {
    type: 'REGULAR',
    status: 'ACTIVE',
    expires: '2025-12-16T23:59:00Z',
  });
  assert.equal(parseSubscription(json('subscriptions-trial-active.json')).type, 'TRIAL');
  assert.equal(parseSubscription(json('subscriptions-ended.json')), null);
  assert.equal(parseSubscription([]), null);
  assert.throws(
    () => parseSubscription({}),
    (err) => err.kind === 'api',
  );
});

test('names are compared without case, accents nor article', () => {
  assert.equal(normalizeName('  Du  Lait '), 'lait');
  assert.equal(normalizeName("de l'Huile"), 'huile');
  assert.equal(normalizeName('Œufs'), 'oeufs');
  assert.equal(normalizeName('Crème fraîche'), 'creme fraiche');
  assert.equal(normalizeName('die Milch'), 'milch');
  assert.equal(normalizeName('las Fresas'), 'fresas');
  // A word that only starts like an article stays whole.
  assert.equal(normalizeName('Lait'), 'lait');
  assert.equal(normalizeName('Ail'), 'ail');
});

test('an item is found by its exact name first, then by a single partial match', () => {
  const items = [
    { name: 'Lait demi-écrémé', checked: false },
    { name: 'Sel', checked: false },
    { name: 'Sel', checked: true },
    { name: 'Farine de blé', checked: false },
    { name: 'Farine de riz', checked: false },
  ];
  assert.equal(findItem(items, 'du lait'), items[0]);
  assert.equal(findItem(items, 'sel', { checked: true }), items[2]);
  assert.equal(findItem(items, 'sel', { checked: false }), items[1]);
  // Two flours: ambiguous, not found rather than the wrong one.
  assert.equal(findItem(items, 'farine'), null);
  assert.equal(findItem(items, 'beurre'), null);
  assert.equal(findItem(items, ''), null);
});
