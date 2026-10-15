// -----------------------------------------------------------------------------
// The dashboard widgets: contents checked against the core's vocabulary and
// budget (the SDK's validateWidgetContent: [] = rendered exactly as sent),
// the buttons and their forms, the recipe pictures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { PLANNED_DAY, createWorld } from './helpers/world.js';
import { MESSAGES, TEXT } from '../src/i18n.js';
import { buildRecipeContent, buildShoppingListContent, recipeImageKey } from '../src/widgets.js';

const DAY = 24 * 60 * 60 * 1000;

async function content(world, key) {
  const ack = await world.gladys.fake.widgetGet(key, { language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'within the vocabulary and budget');
  return ack.data.content;
}

const buttons = (c) => c.components.filter((component) => component.type === 'button');

test('the shopping list widget: counts, rows, and four buttons', async () => {
  const world = await createWorld();
  const c = await content(world, 'shopping_list');
  const [toBuy, checked] = c.components.filter((component) => component.type === 'value');
  assert.equal(toBuy.value, 24);
  assert.equal(checked.value, 2);
  const list = c.components.find((component) => component.type === 'card-list');
  assert.equal(list.items.length, 8);
  assert.deepEqual(list.items[0], {
    title: 'Zucker',
    subtitle: '200 g · Mini-Pavlova mit Orangen',
  });
  const caption = c.components.find((component) => component.variant === 'caption');
  assert.deepEqual(caption.text, MESSAGES.more(18));
  assert.deepEqual(
    buttons(c).map((b) => b.action.key),
    ['add_item', 'check_item', 'uncheck_item', 'clear_checked'],
  );
  const check = buttons(c)[1].action.fields[0];
  assert.equal(check.options.length, 24, 'every item to buy can be checked');
  assert.equal(new Set(check.options.map((o) => o.value)).size, 24, 'unique values');
  assert.equal(buttons(c)[3].action.confirm, true, 'clearing asks first');
  world.app.stop();
});

test('checked items come last, with a badge', () => {
  const c = buildShoppingListContent({
    items: [
      { id: '1', kind: 'additional', name: 'Pain', description: '', checked: true },
      { id: '2', kind: 'additional', name: 'Lait', description: '', checked: false },
    ],
  });
  assert.deepEqual(validateWidgetContent(c), []);
  const list = c.components.find((component) => component.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, Boolean(item.badge)]),
    [
      ['Lait', false],
      ['Pain', true],
    ],
  );
});

test('an empty list says so, and offers only the add button', () => {
  const c = buildShoppingListContent({ items: [] });
  assert.deepEqual(validateWidgetContent(c), []);
  assert.deepEqual(
    c.components.find((component) => component.type === 'text').text,
    TEXT.listEmpty,
  );
  assert.deepEqual(
    buttons(c).map((b) => b.action.key),
    ['add_item'],
  );
});

test('the widget buttons act on Cookidoo and answer with a toast', async () => {
  const world = await createWorld();
  const { fake } = world.gladys;
  let ack = await fake.widgetAction(
    'shopping_list',
    'add_item',
    {},
    { values: { name: 'Beurre' } },
  );
  assert.deepEqual(ack.data.message, MESSAGES.added('Beurre'));
  assert.deepEqual(world.cookidoo.shopping.additionalItems.at(-1).name, 'Beurre');

  const c = await content(world, 'shopping_list');
  const option = buttons(c)[1].action.fields[0].options.find((o) => o.label.en === 'Beurre');
  ack = await fake.widgetAction(
    'shopping_list',
    'check_item',
    {},
    { values: { item: option.value } },
  );
  assert.deepEqual(ack.data.message, MESSAGES.checkedItem('Beurre'));
  assert.equal(world.cookidoo.shopping.additionalItems.at(-1).isOwned, true);

  ack = await fake.widgetAction(
    'shopping_list',
    'uncheck_item',
    {},
    { values: { item: option.value } },
  );
  assert.deepEqual(ack.data.message, MESSAGES.uncheckedItem('Beurre'));

  ack = await fake.widgetAction('shopping_list', 'clear_checked', {});
  assert.deepEqual(ack.data.message, MESSAGES.cleared(1)); // Vogel

  // An item removed in the app meanwhile.
  ack = await fake.widgetAction('shopping_list', 'check_item', {}, { values: { item: 'a:gone' } });
  assert.deepEqual(ack.data.message, TEXT.itemGone);
  // A core older than 5.2.0 sends no form values.
  ack = await fake.widgetAction('shopping_list', 'add_item', {});
  assert.deepEqual(ack.data.message, TEXT.formNotSupported);
  for (const message of [MESSAGES.added('Beurre'), TEXT.formNotSupported]) {
    for (const text of Object.values(message)) {
      assert.ok(text.length <= 200, 'a toast is cut at 200 characters');
    }
  }
  world.app.stop();
});

test('the recipe of the day: picture, time and a link to Cookidoo', async () => {
  const world = await createWorld();
  const c = await content(world, 'recipe_of_the_day');
  const grid = c.components.find((component) => component.type === 'card-list');
  assert.equal(grid.display, 'grid');
  assert.deepEqual(grid.items, [
    {
      title: 'Waffles',
      subtitle: MESSAGES.minutes(25),
      image: 'recipe-r214846',
      links: [{ url: 'https://cookidoo.fr/recipes/recipe/fr-FR/r214846', label: TEXT.openRecipe }],
    },
  ]);
  // The picture is fetched from Cookidoo's CDN and checked like the core does.
  const image = await world.gladys.fake.widgetGetImage('recipe-r214846');
  assert.equal(image.success, true, image.error);
  assert.deepEqual(validateWidgetImage(image.data.image), []);
  const fetched = world.cookidoo.requests.filter((r) => r.host === 'assets.tmecosys.com');
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].path, /^\/image\/upload\/t_web_shared_recipe_221x240\//);
  // A key the integration never handed out is refused.
  const unknown = await world.gladys.fake.widgetGetImage('recipe-unknown');
  assert.equal(unknown.success, false);
  world.app.stop();
});

test('nothing planned today: the next recipes of the week, dated', () => {
  const snapshot = {
    week: [
      { day: '2025-03-04', recipes: [] },
      {
        day: '2025-03-06',
        recipes: [{ id: '01ABC', name: 'Ma soupe', totalSeconds: 0, custom: true }],
      },
    ],
  };
  const c = buildRecipeContent(
    snapshot,
    { host: 'cookidoo.fr', language: 'fr-FR' },
    PLANNED_DAY,
    () => {},
  );
  assert.deepEqual(validateWidgetContent(c), []);
  assert.deepEqual(c.components[0].text, TEXT.nothingToday);
  const [item] = c.components.find((component) => component.type === 'card-list').items;
  assert.equal(item.title, 'Ma soupe');
  assert.equal(new Date(item.date).getDate(), 6);
  assert.deepEqual(item.badge.text, TEXT.customRecipe);
  assert.equal(item.links[0].url, 'https://cookidoo.fr/created-recipes/fr-FR/01ABC');

  const empty = buildRecipeContent(
    { week: [] },
    { host: 'cookidoo.fr', language: 'fr-FR' },
    PLANNED_DAY + DAY,
    () => {},
  );
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.deepEqual(empty.components[1].text, TEXT.nothingThisWeek);
});

test('image keys follow the core pattern', () => {
  for (const id of ['r214846', '01K2CVHD1DXG1PVETNVV3JPKWW', 'odd/id with spaces']) {
    assert.match(recipeImageKey({ id }), /^[a-z0-9][a-z0-9-]{0,63}$/);
  }
});

test('the widgets say why they are empty', async () => {
  const unconfigured = await createWorld({ config: {} });
  let c = await content(unconfigured, 'shopping_list');
  assert.deepEqual(c.components[0].text, TEXT.notConfigured);
  unconfigured.app.stop();

  const down = await createWorld({ cookidoo: { down: true } });
  c = await content(down, 'recipe_of_the_day');
  assert.deepEqual(c.components[0].text, TEXT.network);
  down.app.stop();
});
