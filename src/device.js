// -----------------------------------------------------------------------------
// The Gladys device of a Cookidoo account, and its states.
//
// One device per account, keyed on the id of the Cookidoo profile (the
// identifier Home Assistant keys its entries on): it never changes for an
// account, whatever its e-mail, password or country host.
//
// Feature keys are forever (external ids): never rename one. The names are
// written in the configured language when the user adds the device.
//
// The device is refreshed by the integration's own timer, not by the core:
// `should_poll: false` (Gladys#3198, and Cookidoo has nothing to say every
// minute).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { NAMES, STATES } from './i18n.js';
import { localDay } from './account.js';

export const DEVICE_TYPE = 'account';

/** Feature keys (stable) and their definitions. */
export const FEATURES = {
  remaining_items: { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, max: 10000 },
  checked_items: { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, max: 10000 },
  shopping_list: { category: C.TEXT, type: T.TEXT.TEXT, max: 0, text: true },
  today_recipes: { category: C.TEXT, type: T.TEXT.TEXT, max: 0, text: true },
  today_recipes_count: { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, max: 100 },
  today_total_time: {
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    max: 1440,
  },
  subscription: { category: C.TEXT, type: T.TEXT.TEXT, max: 0, text: true },
  subscription_end: { category: C.TEXT, type: T.TEXT.TEXT, max: 0, text: true },
  subscription_days_left: {
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.DAYS,
    max: 3660,
  },
};

/** Longest text state sent: Gladys stores more, a dashboard shows less. */
const MAX_TEXT = 500;

/** @param {object} gladys @param {string} profileId */
export const deviceIds = (gladys, profileId) => gladys.externalIds(DEVICE_TYPE, profileId);

/**
 * The device to publish.
 * @param {object} gladys
 * @param {{ language: string }} config
 * @param {string} profileId
 */
export function buildDevice(gladys, config, profileId) {
  const ids = deviceIds(gladys, profileId);
  const names = NAMES[config.language] ?? NAMES.en;
  return {
    name: 'Cookidoo',
    external_id: ids.device,
    model: 'Cookidoo',
    should_poll: false,
    features: Object.entries(FEATURES).map(([key, def]) => ({
      name: names[key],
      external_id: ids.feature(key),
      category: def.category,
      type: def.type,
      ...(def.unit ? { unit: def.unit } : {}),
      min: 0,
      max: def.max,
      read_only: true,
      has_feedback: false,
      keep_history: !def.text,
    })),
  };
}

const clip = (value) => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value);

/**
 * The recipes planned on a day.
 * @param {Array<{ day: string, recipes: object[] }>} week
 * @param {string} day
 */
export const recipesOn = (week, day) => week.find((entry) => entry.day === day)?.recipes ?? [];

/**
 * Days until a subscription ends, 0 once ended (or without end date).
 * @param {string | null} expires
 * @param {number} now
 */
export function daysLeft(expires, now) {
  if (!expires) {
    return 0;
  }
  const ms = Date.parse(expires) - now;
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

/**
 * The name of a subscription type, in a language.
 * @param {{ type: string } | null} subscription
 * @param {string} language
 */
export function subscriptionLabel(subscription, language) {
  const table = STATES[language] ?? STATES.en;
  const type = subscription?.type ?? 'NONE';
  if (table[type] && ['REGULAR', 'TRIAL', 'NONE'].includes(type)) {
    return table[type];
  }
  // A type Cookidoo added since: shown as it comes, capitalized.
  return type.charAt(0) + type.slice(1).toLowerCase();
}

/**
 * The end date of a subscription, written in a language.
 * @param {{ expires: string | null } | null} subscription
 * @param {string} language
 */
export function subscriptionEndLabel(subscription, language) {
  if (!subscription?.expires) {
    return (STATES[language] ?? STATES.en).no_end;
  }
  // In UTC: the date Cookidoo states (it ends at 23:59 UTC, which is already
  // the next day in Europe).
  return new Date(subscription.expires).toLocaleDateString(language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The values of the features, from a snapshot.
 * @param {object} snapshot Account.snapshot
 * @param {{ language: string }} config
 * @param {number} now
 * @returns {Record<keyof FEATURES, number | string>}
 */
export function featureValues(snapshot, config, now) {
  const states = STATES[config.language] ?? STATES.en;
  const items = snapshot.shopping.items;
  const toBuy = items.filter((item) => !item.checked);
  const today = recipesOn(snapshot.week, localDay(now));
  return {
    remaining_items: toBuy.length,
    checked_items: items.length - toBuy.length,
    shopping_list: toBuy.length
      ? clip(toBuy.map((item) => item.name).join(', '))
      : states.empty_list,
    today_recipes: today.length
      ? clip(today.map((recipe) => recipe.name).join(' · '))
      : states.no_recipe,
    today_recipes_count: today.length,
    today_total_time: Math.round(
      today.reduce((total, recipe) => total + recipe.totalSeconds, 0) / 60,
    ),
    subscription: subscriptionLabel(snapshot.subscription, config.language),
    subscription_end: subscriptionEndLabel(snapshot.subscription, config.language),
    subscription_days_left: daysLeft(snapshot.subscription?.expires ?? null, now),
  };
}

/**
 * The states to publish (publishStates format).
 * @param {object} gladys
 * @param {string} profileId
 * @param {object} snapshot
 * @param {{ language: string }} config
 * @param {number} now
 */
export function buildStates(gladys, profileId, snapshot, config, now) {
  const ids = deviceIds(gladys, profileId);
  return Object.entries(featureValues(snapshot, config, now)).map(([key, value]) =>
    FEATURES[key].text
      ? { device_feature_external_id: ids.feature(key), text: String(value) }
      : { device_feature_external_id: ids.feature(key), state: value },
  );
}
