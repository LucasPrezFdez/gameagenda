// Servicios de la app (agenda, búsqueda, ajustes, avisos, aviso de copia y, desde M4,
// sincronización), con *hooks* de suscripción.
import { createContext, type ReactNode, use, useMemo, useSyncExternalStore } from 'react';
import type { AgendaEntry, AgendaStore } from '../agenda/types.ts';
import type { CopyReminderState, CopyReminderStore } from '../data/copy-reminder.ts';
import type { NoticeCenter } from '../notices/notice-center.ts';
import type { PerfSampler } from '../perf/sampler.ts';
import type { PerfSamples } from '../perf/samples.ts';
import type { QueryState, SearchClient, StatusMessage } from '../search-client/index.ts';
import type { SettingsStore, UiSettings } from '../settings/settings-store.ts';
import type { SyncService, SyncState } from '../sync/types.ts';

export interface AppServices {
  readonly agenda: AgendaStore;
  readonly search: SearchClient;
  readonly settings: SettingsStore;
  readonly notices: NoticeCenter;
  readonly copyReminder: CopyReminderStore;
  /** Muestras del panel de rendimiento (M3). */
  readonly perf?: PerfSampler;
  /** Sincronización (M4): estado y operaciones de Ajustes › Sincronización (`sync/types.ts`). */
  readonly sync: SyncService;
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

export function useCopyReminder(): CopyReminderState | null {
  const { copyReminder } = useServices();
  return useSyncExternalStore(copyReminder.subscribe, copyReminder.getSnapshot);
}

/** El estado de la sincronización (M4), para Ajustes › Sincronización. */
export function useSyncState(): SyncState {
  const { sync } = useServices();
  return useSyncExternalStore(sync.subscribe, sync.getSnapshot);
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

const noSamples = () => () => {};
const emptySamples = (): PerfSamples => ({ since: null, values: {} });

/** Las muestras del panel de rendimiento (vacías si no hay muestreo). */
export function usePerfSamples(): PerfSamples {
  const { perf } = useServices();
  return useSyncExternalStore(perf?.subscribe ?? noSamples, perf?.getSnapshot ?? emptySamples);
}
