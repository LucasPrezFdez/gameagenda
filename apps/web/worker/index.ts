// Punto de entrada del Worker `ga-web` (`main` en `wrangler.jsonc`).

import { createApp } from './app.ts';

const app = createApp();

export default {
  fetch: app.fetch,
};
