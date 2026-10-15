// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of the manifest; this module
// gives the defaults and normalizes the received object, so the rest of the
// code never deals with `undefined` or with a number sent as a string.
//
// The Cookidoo account lives on one country host (cookidoo.fr, cookidoo.de…,
// cookidoo.international for the countries without their own site) and serves
// its content in one of the languages of that country: both come from the
// table of cookidoo-api (src/cookidoo/markets.json, MIT).
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Country code → { host, languages } (from cookidoo-api's localization table). */
export const MARKETS = require('./cookidoo/markets.json');

/** Languages of the texts the integration produces (feature names, states). */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Minutes between two reads of the shopping list and the week plan. */
export const REFRESH_MINUTES = ['2', '5', '10', '15', '30'];

// Defaults: they MUST stay consistent with the `default` values of the manifest.
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  country: 'fr',
  cookidoo_language: 'auto',
  language: 'fr',
  refresh_minutes: '5',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const country = String(raw.country ?? DEFAULT_CONFIG.country)
    .trim()
    .toLowerCase();
  const language = String(raw.language ?? DEFAULT_CONFIG.language);
  const refresh = String(raw.refresh_minutes ?? DEFAULT_CONFIG.refresh_minutes);
  return {
    email: String(raw.email ?? '').trim(),
    password: String(raw.password ?? ''),
    country: MARKETS[country] ? country : DEFAULT_CONFIG.country,
    cookidoo_language: String(raw.cookidoo_language ?? DEFAULT_CONFIG.cookidoo_language).trim(),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
    refresh_minutes: REFRESH_MINUTES.includes(refresh) ? refresh : DEFAULT_CONFIG.refresh_minutes,
  };
}

/** The integration can only sign in once the e-mail and the password are set. */
export function isConfigured(config) {
  return Boolean(config.email && config.password);
}

/** Milliseconds between two refreshes. */
export function refreshPeriodMs(config) {
  return Number(config.refresh_minutes) * 60 * 1000;
}

/**
 * The Cookidoo host and content language of the account. `auto` picks the
 * language of the country matching the integration's language (fr-FR for
 * French on cookidoo.fr, de-CH for German on cookidoo.ch…), else the
 * country's first one; a language the country does not offer falls back the
 * same way.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {{ country: string, host: string, language: string }}
 */
export function resolveMarket(config) {
  const market = MARKETS[config.country] ?? MARKETS[DEFAULT_CONFIG.country];
  const country = MARKETS[config.country] ? config.country : DEFAULT_CONFIG.country;
  let language = market.languages.find((lang) => lang === config.cookidoo_language);
  if (!language) {
    language =
      market.languages.find((lang) => lang.split('-')[0] === config.language) ??
      market.languages[0];
  }
  return { country, host: market.host, language };
}
