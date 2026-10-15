// -----------------------------------------------------------------------------
// Entry point of the Cookidoo integration for Gladys Assistant.
//
// SDK wiring only: the handlers are registered by src/app.js BEFORE connect().
// The Gladys supervisor gives the container GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR, read by the SDK,
// and TZ, the time zone of Gladys (what "today" means for the week plan).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: shutting down`);
  app.stop();
});

logger.info('Starting the Cookidoo integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err.message})`);
  process.exit(1);
});
