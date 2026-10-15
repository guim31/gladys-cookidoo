// -----------------------------------------------------------------------------
// From the Cookidoo answers to the integration's own model.
//
// The JSON shapes are the ones documented by cookidoo-api (miaucl, MIT) and
// its recorded responses (test/fixtures/cookidoo/). The parsers are lenient
// on what they do not need and strict on what they do: a missing list is an
// empty one, an item without id or name is skipped, but an answer that is
// not the expected object at all is an API change (CookidooError 'api').
// -----------------------------------------------------------------------------

import { apiError } from './errors.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * "200 g", "1 - 2 TL", "4": the quantity and unit of an ingredient.
 * @param {object} item
 */
export function ingredientDescription(item) {
  const quantity = item.quantity;
  let amount = '';
  if (isObject(quantity)) {
    if (quantity.value !== undefined && quantity.value !== null && quantity.value !== '') {
      amount = String(quantity.value);
    } else if (quantity.from && quantity.to) {
      amount = `${quantity.from} - ${quantity.to}`;
    }
  }
  const unit = text(item.unitNotation);
  return [amount, unit].filter(Boolean).join(' ');
}

/**
 * The shopping list (`pantry:home`): the ingredients of the recipes added to
 * the list, and the free items typed by the user.
 * @param {unknown} doc
 * @returns {{ recipes: Array<{ id: string, name: string, custom: boolean, ingredientIds: string[] }>, items: Array<ShoppingItem> }}
 *
 * @typedef {object} ShoppingItem
 * @property {string} id the Cookidoo id
 * @property {'ingredient' | 'additional'} kind
 * @property {string} name
 * @property {string} description quantity and unit ('' for a free item)
 * @property {boolean} checked bought (Cookidoo: `isOwned`)
 * @property {string} [recipe] name of the recipe an ingredient belongs to
 */
export function parseShoppingList(doc) {
  if (!isObject(doc)) {
    throw apiError('unexpected shopping list answer');
  }
  const recipes = [];
  const items = [];
  const seen = new Set();
  for (const [source, custom] of [
    [doc.recipes, false],
    [doc.customerRecipes, true],
  ]) {
    for (const recipe of list(source)) {
      if (!isObject(recipe)) {
        continue;
      }
      const recipeName = text(recipe.title) || text(recipe.name);
      const ingredientIds = [];
      for (const ingredient of list(recipe.recipeIngredientGroups)) {
        const id = text(ingredient?.id);
        const name = text(ingredient?.ingredientNotation);
        if (!id || !name || seen.has(`i:${id}`)) {
          continue;
        }
        seen.add(`i:${id}`);
        ingredientIds.push(id);
        items.push({
          id,
          kind: 'ingredient',
          name,
          description: ingredientDescription(ingredient),
          checked: ingredient.isOwned === true,
          recipe: recipeName,
        });
      }
      const id = text(recipe.id);
      if (id) {
        recipes.push({ id, name: recipeName, custom, ingredientIds });
      }
    }
  }
  for (const item of list(doc.additionalItems)) {
    const id = text(item?.id);
    const name = text(item?.name);
    if (!id || !name || seen.has(`a:${id}`)) {
      continue;
    }
    seen.add(`a:${id}`);
    items.push({ id, kind: 'additional', name, description: '', checked: item.isOwned === true });
  }
  return { recipes, items };
}

/**
 * The items an edit endpoint answers (`{ data: [...] }`), for checks.
 * @param {unknown} doc
 */
export function parseEditedItems(doc) {
  if (!isObject(doc)) {
    throw apiError('unexpected answer to an edit');
  }
  return list(doc.data)
    .filter(isObject)
    .map((item) => ({
      id: text(item.id),
      name: text(item.name) || text(item.ingredientNotation),
      checked: item.isOwned === true,
    }));
}

/**
 * "1500.0" (seconds), 1500, "PT25M" (ISO 8601): a duration in seconds.
 * @param {unknown} value
 * @returns {number}
 */
export function durationSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.round(numeric));
  }
  const iso = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!iso) {
    return 0;
  }
  const [, d = 0, h = 0, m = 0, s = 0] = iso;
  return Math.round(Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s));
}

/**
 * The picture of a recipe, at a size fitting a widget: the Cookidoo image
 * URLs are templates whose `{transformation}` picks the size.
 * @param {unknown} assets `assets` of a planned recipe
 * @returns {string | undefined}
 */
export function recipeImageUrl(assets) {
  const images = isObject(assets) ? assets.images : undefined;
  const template = isObject(images)
    ? [images.square, images.portrait, images.landscape].find(
        (url) => typeof url === 'string' && url.startsWith('https://'),
      )
    : typeof images === 'string' && images.startsWith('https://')
      ? images
      : undefined;
  return template?.replace('{transformation}', 't_web_shared_recipe_221x240');
}

/**
 * The week plan (`planning:api-my-week-from-date`).
 * @param {unknown} doc
 * @returns {Array<{ day: string, recipes: Array<PlannedRecipe>, customRecipeIds: string[] }>}
 *
 * @typedef {object} PlannedRecipe
 * @property {string} id
 * @property {string} name
 * @property {number} totalSeconds
 * @property {boolean} custom created by the user
 * @property {string} [image] picture URL
 */
export function parseWeek(doc) {
  if (!isObject(doc)) {
    throw apiError('unexpected week plan answer');
  }
  const days = [];
  for (const day of list(doc.myDays)) {
    const key = text(day?.dayKey) || text(day?.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      continue;
    }
    const recipes = [];
    for (const [source, custom] of [
      [day.recipes, false],
      [day.customerRecipes, true],
    ]) {
      for (const recipe of list(source)) {
        const id = text(recipe?.id);
        const name = text(recipe?.title);
        if (!id || !name) {
          continue;
        }
        recipes.push({
          id,
          name,
          totalSeconds: durationSeconds(recipe.totalTime),
          custom,
          image: recipeImageUrl(recipe.assets),
        });
      }
    }
    const known = new Set(recipes.map((recipe) => recipe.id));
    const customRecipeIds = list(day.customerRecipeIds)
      .map(text)
      .filter((id) => id && !known.has(id));
    days.push({ day: key, recipes, customRecipeIds });
  }
  return days;
}

/**
 * A recipe created by the user (`customer-recipes:recipe-details`), as a
 * planned recipe.
 * @param {unknown} doc
 * @returns {PlannedRecipe}
 */
export function parseCustomRecipe(doc) {
  const content = isObject(doc) ? doc.recipeContent : undefined;
  const id = isObject(doc) ? text(doc.recipeId) : '';
  const name = isObject(content) ? text(content.name) : '';
  if (!id || !name) {
    throw apiError('unexpected custom recipe answer');
  }
  const image = text(content.image);
  return {
    id,
    name,
    totalSeconds: durationSeconds(content.totalTime),
    custom: true,
    image: image.startsWith('https://')
      ? image.replace('{transformation}', 't_web_shared_recipe_221x240')
      : undefined,
  };
}

/**
 * The active subscription (`ownership:subscriptions`), or null when none is.
 * @param {unknown} doc
 * @returns {{ type: string, status: string, expires: string | null } | null}
 */
export function parseSubscription(doc) {
  if (!Array.isArray(doc)) {
    throw apiError('unexpected subscriptions answer');
  }
  const active = doc.find((entry) => isObject(entry) && entry.active === true);
  if (!active) {
    return null;
  }
  const expires = text(active.expires);
  return {
    type: text(active.type).toUpperCase() || 'NONE',
    status: text(active.status).toUpperCase(),
    expires: expires && !Number.isNaN(Date.parse(expires)) ? expires : null,
  };
}

/**
 * The community profile (`community-profile:user-private-profile`): its id is
 * the stable identifier of the account (Home Assistant keys its entries on it).
 * @param {unknown} doc
 * @returns {{ id: string }}
 */
export function parseProfile(doc) {
  const id = isObject(doc) ? text(doc.id) : '';
  if (!id) {
    throw apiError('unexpected profile answer');
  }
  return { id };
}
