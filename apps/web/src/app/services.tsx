// Servicios de la app (agenda, búsqueda, ajustes y avisos), con *hooks* de suscripción.
import { createContext, type ReactNode, use, useMemo, useSyncExternalStore } from 'react';
import type { AgendaEntry, AgendaStore } from '../agenda/types.ts';
import type { NoticeCenter } from '../notices/notice-center.ts';
import type { QueryState, SearchClient, StatusMessage } from '../search-client/index.ts';
import type { SettingsStore, UiSettings } from '../settings/settings-store.ts';

export interface AppServices {
  readonly agenda: AgendaStore;
  readonly search: SearchClient;
  readonly settings: SettingsStore;
  readonly notices: NoticeCenter;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

export function useServices(): AppServices {
  const services = use(ServicesContext);
  if (!services) throw new Error('Falta ServicesProvider');
  return services;
}

export function useAgendaEntries(): readonly AgendaEntry[] {
  const { agenda } = useServices();
  return useSyncExternalStore(agenda.subscribe, agenda.getSnapshot);
}

/** Entradas por id, para marcar «En tu lista» sin recorrer la lista en cada fila. */
export function useEntriesById(): ReadonlyMap<string, AgendaEntry> {
  const entries = useAgendaEntries();
  return useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
}

export function useSettings(): UiSettings {
  const { settings } = useServices();
  return useSyncExternalStore(settings.subscribe, settings.getSnapshot);
}

export function useCatalogStatus(): StatusMessage {
  const { search } = useServices();
  return useSyncExternalStore(search.subscribeStatus, search.getStatus);
}

export function useQueryState(): QueryState {
  const { search } = useServices();
  return useSyncExternalStore(search.subscribeQuery, search.getQueryState);
}

export function useCanUndo(): boolean {
  const { notices } = useServices();
  return useSyncExternalStore(notices.undoStack.subscribe, () => notices.undoStack.size > 0);
}
