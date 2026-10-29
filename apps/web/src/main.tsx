import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createMemoryAgenda } from './agenda/memory-agenda.ts';
import { type AppServices, ServicesProvider } from './app/services.tsx';
import { installGlobalErrorHandlers } from './errors/error-log.ts';
import { createNoticeCenter } from './notices/notice-center.ts';
import { registerServiceWorker } from './pwa/register-sw.ts';
import { startRouter } from './router/router.tsx';
import { createAppSearchClient } from './search-client/index.ts';
import { createSettingsStore } from './settings/settings-store.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/palette.css';
import './styles/list.css';
import './styles/sheet.css';

installGlobalErrorHandlers();
startRouter();

const settings = createSettingsStore();
const services: AppServices = {
  agenda: createMemoryAgenda(),
  search: createAppSearchClient(),
  settings,
  notices: createNoticeCenter(),
};
services.search.init({ catalogVersion: null, showAdult: settings.getSnapshot().showAdult });

const root = document.getElementById('root');
if (!root) throw new Error('Falta el elemento #root');

createRoot(root).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);

registerServiceWorker();
