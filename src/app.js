// -----------------------------------------------------------------------------
// The integration, wired on a Gladys client (the real one in index.js, the
// SDK's fake one in the tests).
//
// Refresh. The core does not poll external devices reliably (Gladys#3198, not
// fixed in 5.2.1), and Cookidoo has nothing to say every minute: the device
// is published with `should_poll: false` and the integration reads Cookidoo
// on its own timer, every `refresh_minutes` (5 by default). The timer only
// reads Cookidoo when someone looks: the device is added in Gladys, or a
// widget was shown during the last hour. `onPoll` stays as a fallback.
//
// States. Only the changes are published (publishChangedStates), with a
// heartbeat every 6 hours so that a stable value never looks stale ("no
// recent value" after 48 h). A device just added gets everything at once.
//
// Logs. Info is for the lifecycle only (start, connection to Cookidoo, its
// loss and its return, one line per user action); a normal refresh writes
// debug lines only (LOG_LEVEL=debug). Never a password, a token, an e-mail.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Account } from './account.js';
import { isConfigured, normalizeConfig, refreshPeriodMs, resolveMarket } from './config.js';
import { errorKind } from './cookidoo/errors.js';
import { buildDevice, buildStates, deviceIds, featureValues, subscriptionLabel } from './device.js';
import { createImageRegistry, fetchWidgetImage } from './images.js';
import { createIssueLog } from './issues.js';
import { MESSAGES, STATES, TEXT, thrown } from './i18n.js';
import { SCENE_ACTION, remainingCount } from './scenes.js';
import { Store } from './store.js';
import {
  WIDGET,
  WIDGET_ACTION,
  buildRecipeContent,
  buildShoppingListContent,
  messageContent,
  parseOptionValue,
} from './widgets.js';

const require = createRequire(import.meta.url);
const { version } = require('../gladys-assistant-integration.json');

/** Who the requests say they come from: the integration, not a browser. */
export const USER_AGENT = `gladys-cookidoo/${version} (+https://github.com/guim31/gladys-cookidoo)`;

export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** A widget shown within this delay keeps the refresh timer reading Cookidoo. */
const WIDGET_WATCH_MS = 60 * 60 * 1000;

/** The short error of a failed operation, joined in the four languages. */
const operationError = (err) => new Error(thrown(TEXT[`${errorKind(err)}Short`]));

/**
 * @param {object} gladys GladysIntegration or the SDK's fake
 * @param {object} [options]
 * @param {Store} [options.store]
 * @param {typeof fetch} [options.fetch]
 * @param {boolean} [options.timers] run the refresh timer (tests may turn it off)
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 */
export function registerHandlers(gladys, options = {}) {
  const {
    store = new Store('/data'),
    fetch: fetchImpl = fetch,
    timers = true,
    now = () => Date.now(),
    logger = createLogger({ name: 'cookidoo' }),
  } = options;

  const issues = createIssueLog(logger);
  const images = createImageRegistry();
  let config = normalizeConfig();
  /** @type {Account | null} */
  let account = null;
  let accountSignature = '';
  let publishedProfile = null;
  let connected = null; // last connection status sent: true, a kind, or null
  let contentSignature = '';
  let widgetPulledAt = 0;
  let timer = null;
  let stopped = false;
  let ready = Promise.resolve();

  // --- Helpers -----------------------------------------------------------------

  const deviceAdded = () => {
    if (!account?.profileId) {
      return false;
    }
    const id = deviceIds(gladys, account.profileId).device;
    return (gladys.devices ?? []).some((device) => device.external_id === id);
  };

  async function setStatus(value, message) {
    if (connected === value) {
      return;
    }
    connected = value;
    await gladys.setConnectionStatus(value === true, message).catch((err) => {
      logger.debug(`setConnectionStatus failed (${err.message})`);
    });
  }

  /** Publish the device once its identity (the profile id) is known. */
  async function publishDevice({ force = false } = {}) {
    if (!account?.profileId || (!force && publishedProfile === account.profileId)) {
      return;
    }
    await gladys.publishDiscoveredDevices([buildDevice(gladys, config, account.profileId)]);
    publishedProfile = account.profileId;
  }

  /** Publish the states of an added device: the changes, or everything. */
  async function publishStates({ all = false } = {}) {
    if (!account?.snapshot || !deviceAdded()) {
      return;
    }
    const states = buildStates(gladys, account.profileId, account.snapshot, config, now());
    if (all) {
      gladys.forgetPublishedStates(deviceIds(gladys, account.profileId).device);
    }
    const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    logger.debug(`${count} state(s) published`);
  }

  /** Nudge the widgets when what they show changed (or always, `force`). */
  function refreshWidgets({ force = false } = {}) {
    const signature = account?.snapshot
      ? JSON.stringify([account.snapshot.shopping, account.snapshot.week])
      : '';
    if (!force && signature === contentSignature) {
      return;
    }
    contentSignature = signature;
    for (const key of Object.values(WIDGET)) {
      gladys.requestWidgetRefresh(key);
    }
  }

  /**
   * After a successful read: status, device, states, widgets. A refusal of
   * Gladys (a rejected payload, the state rate limit) is not a Cookidoo
   * failure: logged on its own, never thrown.
   */
  async function afterRead() {
    if (connected !== true) {
      logger.info(`Connected to Cookidoo (${account.market.host}, ${account.market.language})`);
    }
    issues.ok('cookidoo', 'Cookidoo answers again');
    await setStatus(true);
    try {
      await publishDevice();
      await publishStates();
      issues.ok('gladys', 'Publishing to Gladys works again');
    } catch (err) {
      issues.fail('gladys', `Publishing to Gladys failed (${err.message})`);
    }
    refreshWidgets();
  }

  async function afterFailure(err) {
    const kind = errorKind(err);
    issues.fail('cookidoo', `Cookidoo ${kind} failure: ${err.message}`);
    await setStatus(kind, TEXT[kind]);
  }

  /**
   * One refresh: read Cookidoo, publish what changed. Errors are reported
   * (status, one log line while they last), never thrown.
   * @param {{ always?: boolean }} [options] read even if nobody looks
   */
  async function cycle({ always = false } = {}) {
    if (!account) {
      return;
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    const watched = deviceAdded() || now() - widgetPulledAt < WIDGET_WATCH_MS;
    if (!always && !watched) {
      logger.debug('Nobody looks at Cookidoo (no device added, no widget shown): skipped');
      return;
    }
    try {
      await account.refresh();
      logger.debug('Cookidoo read');
    } catch (err) {
      await afterFailure(err);
      return;
    }
    await afterRead();
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      try {
        await cycle();
      } finally {
        schedule();
      }
    }, refreshPeriodMs(config));
    timer.unref?.();
  }

  /** (Re)start with the current config: account, device, first read, timer. */
  async function start() {
    stopped = false;
    if (!isConfigured(config)) {
      account = null;
      accountSignature = '';
      clearTimeout(timer);
      logger.info('Not configured yet: waiting for the Cookidoo e-mail and password');
      await setStatus('not_configured', TEXT.notConfigured);
      return;
    }
    const market = resolveMarket(config);
    const signature = JSON.stringify([config.email, config.password, market]);
    if (signature !== accountSignature) {
      account = await new Account({
        config,
        store,
        fetch: fetchImpl,
        userAgent: USER_AGENT,
        now,
      }).load();
      accountSignature = signature;
      publishedProfile = null;
      connected = null;
      contentSignature = '';
    } else {
      account.config = config;
    }
    // A known account is published at once: Gladys may show it while
    // Cookidoo is still being read.
    await publishDevice({ force: true }).catch((err) =>
      logger.error(`Publishing the device failed (${err.message})`),
    );
    await cycle({ always: true });
    schedule();
  }

  /** The data for a widget: the snapshot, refreshed when older than a period. */
  async function widgetData() {
    widgetPulledAt = now();
    if (!account) {
      return null;
    }
    const stale = !account.snapshot || now() - account.snapshot.readAt > refreshPeriodMs(config);
    if (stale) {
      try {
        await account.refresh();
      } catch (err) {
        await afterFailure(err);
        if (!account.snapshot) {
          throw err;
        }
        return account.snapshot; // the last data read, rather than nothing
      }
      await afterRead();
    }
    return account.snapshot;
  }

  /** After an operation on the list: states and widgets follow at once. */
  async function afterChange() {
    await publishStates().catch((err) => logger.debug(`publish failed (${err.message})`));
    refreshWidgets();
  }

  function requireAccount() {
    if (!account) {
      throw new Error(thrown(TEXT.notConfiguredShort));
    }
    return account;
  }

  // --- Discovery and devices -----------------------------------------------------

  gladys.onScanRequest(async () => {
    await publishDevice({ force: true });
  });

  const onDeviceAddedOrUpdated = async (device) => {
    if (!account?.profileId || device.external_id !== deviceIds(gladys, account.profileId).device) {
      return;
    }
    // Gladys dropped the states sent before the device existed: send them
    // all now, read Cookidoo first if nothing was read yet.
    if (!account.snapshot) {
      await cycle({ always: true });
    }
    await publishStates({ all: true }).catch((err) =>
      logger.warn(`Publishing the states failed (${err.message})`),
    );
    refreshWidgets({ force: true });
  };
  gladys.onDeviceCreated(onDeviceAddedOrUpdated);
  gladys.onDeviceUpdated(onDeviceAddedOrUpdated);

  // Fallback only: the device is published with should_poll: false.
  gladys.onPoll(async () => {
    if (account?.snapshot && now() - account.snapshot.readAt < refreshPeriodMs(config) * 0.9) {
      return;
    }
    await cycle({ always: true });
  });

  // --- Configuration screen ------------------------------------------------------

  gladys.onAction('test_connection', async () => {
    logger.info('Action: test the connection');
    if (!account) {
      return TEXT.notConfigured;
    }
    try {
      const snapshot = await account.test();
      await afterRead();
      await publishStates({ all: true }).catch((err) =>
        logger.warn(`Publishing the states failed (${err.message})`),
      );
      const values = featureValues(snapshot, config, now());
      const todayText = Object.fromEntries(
        Object.keys(STATES).map((lang) => [
          lang,
          values.today_recipes_count > 0 ? values.today_recipes : STATES[lang].no_recipe,
        ]),
      );
      const subscription = Object.fromEntries(
        Object.keys(STATES).map((lang) => [lang, subscriptionLabel(snapshot.subscription, lang)]),
      );
      return MESSAGES.connected({
        toBuy: values.remaining_items,
        checked: values.checked_items,
        today: todayText,
        subscription,
      });
    } catch (err) {
      await afterFailure(err);
      return TEXT[errorKind(err)];
    }
  });

  // --- Scene actions -----------------------------------------------------------

  const sceneName = (fields) => {
    const name = String(fields?.name ?? '').trim();
    if (!name) {
      throw new Error(thrown(TEXT.nameMissing));
    }
    return name;
  };

  gladys.onSceneAction(SCENE_ACTION.ADD, async (fields) => {
    const name = sceneName(fields);
    const target = requireAccount();
    logger.info('Scene action: add an item');
    try {
      const { added } = await target.addItem(name);
      await afterChange();
      return { added, remaining_items: remainingCount(target.snapshot?.shopping.items ?? []) };
    } catch (err) {
      logger.warn(`Scene action add_item failed (${err.message})`);
      throw operationError(err);
    }
  });

  for (const [key, checked] of [
    [SCENE_ACTION.CHECK, true],
    [SCENE_ACTION.UNCHECK, false],
  ]) {
    gladys.onSceneAction(key, async (fields) => {
      const name = sceneName(fields);
      const target = requireAccount();
      logger.info(`Scene action: ${checked ? 'check' : 'uncheck'} an item`);
      try {
        const { found } = await target.setChecked({ name }, checked);
        await afterChange();
        return { found, remaining_items: remainingCount(target.snapshot?.shopping.items ?? []) };
      } catch (err) {
        logger.warn(`Scene action ${key} failed (${err.message})`);
        throw operationError(err);
      }
    });
  }

  gladys.onSceneAction(SCENE_ACTION.CLEAR, async () => {
    const target = requireAccount();
    logger.info('Scene action: clear the checked items');
    try {
      const { removed } = await target.clearChecked();
      await afterChange();
      return { removed_items: removed };
    } catch (err) {
      logger.warn(`Scene action clear_checked_items failed (${err.message})`);
      throw operationError(err);
    }
  });

  // --- Widgets -------------------------------------------------------------------

  gladys.onWidgetGet(WIDGET.SHOPPING_LIST, async () => {
    if (!isConfigured(config)) {
      return messageContent(TEXT.notConfigured);
    }
    try {
      const snapshot = await widgetData();
      return snapshot ? buildShoppingListContent(snapshot.shopping) : messageContent(TEXT.network);
    } catch (err) {
      return messageContent(TEXT[errorKind(err)]);
    }
  });

  gladys.onWidgetGet(WIDGET.RECIPE_OF_THE_DAY, async () => {
    if (!isConfigured(config)) {
      return messageContent(TEXT.notConfigured);
    }
    try {
      const snapshot = await widgetData();
      return snapshot
        ? buildRecipeContent(snapshot, account.market, now(), images.register)
        : messageContent(TEXT.network);
    } catch (err) {
      return messageContent(TEXT[errorKind(err)]);
    }
  });

  gladys.onWidgetGetImage(async (key) => {
    logger.debug(`Widget image ${key}`);
    return fetchWidgetImage(images, key, fetchImpl, USER_AGENT);
  });

  gladys.onWidgetAction(WIDGET.SHOPPING_LIST, async (actionKey, _params, { values } = {}) => {
    logger.info(`Widget action: ${actionKey}`);
    const target = requireAccount();
    const needsForm = actionKey !== WIDGET_ACTION.CLEAR;
    if (needsForm && (!values || typeof values !== 'object')) {
      // A core older than 5.2.0 drops the form and sends no values.
      return TEXT.formNotSupported;
    }
    try {
      if (actionKey === WIDGET_ACTION.ADD) {
        const name = String(values.name ?? '').trim();
        if (!name) {
          return TEXT.nameMissing;
        }
        const { added } = await target.addItem(name);
        await afterChange();
        return added ? MESSAGES.added(name) : MESSAGES.alreadyListed(name);
      }
      if (actionKey === WIDGET_ACTION.CHECK || actionKey === WIDGET_ACTION.UNCHECK) {
        const checked = actionKey === WIDGET_ACTION.CHECK;
        const wanted = parseOptionValue(values.item);
        const result = wanted ? await target.setChecked(wanted, checked) : { found: false };
        await afterChange();
        if (!result.found) {
          return TEXT.itemGone;
        }
        return checked
          ? MESSAGES.checkedItem(result.item.name)
          : MESSAGES.uncheckedItem(result.item.name);
      }
      if (actionKey === WIDGET_ACTION.CLEAR) {
        const { removed } = await target.clearChecked();
        await afterChange();
        return MESSAGES.cleared(removed);
      }
      throw new Error(`unknown widget action ${actionKey}`);
    } catch (err) {
      logger.warn(`Widget action ${actionKey} failed (${err.message})`);
      throw operationError(err);
    }
  });

  // --- Lifecycle -----------------------------------------------------------------

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    const languageChanged = normalizeConfig(newConfig).language !== config.language;
    config = normalizeConfig(newConfig);
    await start();
    if (languageChanged) {
      // New text states in the new language (the names stay: Gladys keeps
      // the ones of the creation).
      await publishStates({ all: true }).catch(() => {});
    }
  });

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      ready = start();
      await ready;
    } catch (err) {
      logger.error(`Initialization failed (${err.message})`);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    }
  });

  return {
    get ready() {
      return ready;
    },
    get account() {
      return account;
    },
    get config() {
      return config;
    },
    cycle,
    /** Whether the refresh timer is armed (the tests wait for it). */
    get timerArmed() {
      return timer !== null;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
