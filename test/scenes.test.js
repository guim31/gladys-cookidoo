// -----------------------------------------------------------------------------
// The scene actions, end to end: the fake Gladys runs them as a scene would,
// the fake Cookidoo's shopping list changes, the states follow at once.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDevice, createWorld } from './helpers/world.js';
import { PROFILE_ID } from './helpers/fakeCookidoo.js';
import { LANGS, TEXT } from '../src/i18n.js';

const free = (world) =>
  world.cookidoo.shopping.additionalItems.map((item) => [item.name, item.isOwned]);
const remaining = (world) =>
  world.gladys.fake.lastState(
    world.gladys.externalIds('account', PROFILE_ID).feature('remaining_items'),
  );

test('add_item adds a free item, once', async () => {
  const world = await createWorld();
  await addDevice(world);
  let ack = await world.gladys.fake.sceneAction('add_item', { name: '  Lait ' });
  assert.deepEqual(ack, { success: true, data: { outputs: { added: true, remaining_items: 25 } } });
  assert.deepEqual(free(world).at(-1), ['Lait', false]);
  assert.equal(remaining(world), 25, 'the state follows at once');

  // "Ajoute du lait" again: already there to buy, not doubled.
  ack = await world.gladys.fake.sceneAction('add_item', { name: 'du lait' });
  assert.deepEqual(ack.data.outputs, { added: false, remaining_items: 25 });
  assert.equal(free(world).filter(([name]) => name === 'Lait').length, 1);

  // An ingredient of a recipe counts too: "Zucker" is already to buy.
  ack = await world.gladys.fake.sceneAction('add_item', { name: 'zucker' });
  assert.equal(ack.data.outputs.added, false);
  world.app.stop();
});

test('add_item puts a bought free item back on the list instead of doubling it', async () => {
  const world = await createWorld();
  // "Vogel" is a checked free item of the recorded list.
  const ack = await world.gladys.fake.sceneAction('add_item', { name: 'Vogel' });
  assert.equal(ack.data.outputs.added, true);
  assert.deepEqual(
    free(world).filter(([name]) => name === 'Vogel'),
    [['Vogel', false]],
  );
  world.app.stop();
});

test('check_item and uncheck_item find the item by its name', async () => {
  const world = await createWorld();
  await addDevice(world);
  let ack = await world.gladys.fake.sceneAction('check_item', { name: 'FLEISCH' });
  assert.deepEqual(ack.data.outputs, { found: true, remaining_items: 23 });
  assert.deepEqual(free(world)[0], ['Fleisch', true]);
  assert.equal(remaining(world), 23);

  // An ingredient of a recipe ("Crème fraîche", accents ignored).
  ack = await world.gladys.fake.sceneAction('check_item', { name: 'creme fraiche' });
  assert.equal(ack.data.outputs.found, true);
  const cream = world.cookidoo.shopping.recipes[0].recipeIngredientGroups.find(
    (item) => item.ingredientNotation === 'Crème fraîche',
  );
  assert.equal(cream.isOwned, true);

  ack = await world.gladys.fake.sceneAction('uncheck_item', { name: 'fleisch' });
  assert.deepEqual(ack.data.outputs, { found: true, remaining_items: 23 });
  assert.deepEqual(free(world)[0], ['Fleisch', false]);

  ack = await world.gladys.fake.sceneAction('check_item', { name: 'Caviar' });
  assert.deepEqual(ack.data.outputs, { found: false, remaining_items: 23 });
  world.app.stop();
});

test('check_item with a name two items share picks one still to buy', async () => {
  const world = await createWorld();
  // "Salz" is in two recipes, both to buy; "Zucker" too.
  const ack = await world.gladys.fake.sceneAction('check_item', { name: 'Salz' });
  assert.equal(ack.data.outputs.found, true);
  const salts = [...world.cookidoo.shopping.recipes]
    .flatMap((recipe) => recipe.recipeIngredientGroups)
    .filter((item) => item.ingredientNotation === 'Salz');
  assert.deepEqual(
    salts.map((item) => item.isOwned),
    [true, false],
  );
  world.app.stop();
});

test('clear_checked_items removes the checked free items and the fully bought recipes', async () => {
  const world = await createWorld();
  // Buy every ingredient of the pavlova.
  const pavlova = world.cookidoo.shopping.recipes[0];
  for (const item of pavlova.recipeIngredientGroups) {
    item.isOwned = true;
  }
  const ack = await world.gladys.fake.sceneAction('clear_checked_items', {});
  // Vogel (free, checked) + the 7 ingredients of the pavlova.
  assert.deepEqual(ack.data.outputs, { removed_items: 8 });
  assert.deepEqual(
    world.cookidoo.shopping.recipes.map((recipe) => recipe.title),
    ['Vollwert-Brötchen/Baguettes'],
  );
  assert.deepEqual(free(world), [['Fleisch', false]]);
  // The bread recipe is partly bought (Hefe): it stays, Hefe with it.
  const again = await world.gladys.fake.sceneAction('clear_checked_items', {});
  assert.deepEqual(again.data.outputs, { removed_items: 0 });
  world.app.stop();
});

test('a scene action without account or name fails with a localized message', async () => {
  const unconfigured = await createWorld({ config: {} });
  let ack = await unconfigured.gladys.fake.sceneAction('add_item', { name: 'Lait' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, LANGS.map((lang) => TEXT.notConfiguredShort[lang]).join(' / '));
  unconfigured.app.stop();

  const world = await createWorld();
  ack = await world.gladys.fake.sceneAction('add_item', { name: '   ' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Indiquez le nom d'un article/);
  world.app.stop();
});

test('Cookidoo down: the action fails, the scene goes on', async () => {
  const world = await createWorld();
  world.cookidoo.down = true;
  const ack = await world.gladys.fake.sceneAction('add_item', { name: 'Lait' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, LANGS.map((lang) => TEXT.networkShort[lang]).join(' / '));
  assert.ok(ack.error.length <= 200);
  world.app.stop();
});
