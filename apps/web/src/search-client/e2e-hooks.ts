// Ganchos de los E2E en el hilo principal (ver §12.3). Solo los importa el *build* del modo `e2e`:
// en el de producción, `import.meta.env.MODE` no es `e2e` y este módulo queda fuera del *bundle*.
// Las pruebas los fijan con `page.addInitScript` en `globalThis.__GA_SEARCH_TEST__`.
import type {
  SearchTransport,
  TestControlMessage,
  UiToWorkerMessage,
  WorkerToUiMessage,
} from './protocol.ts';

export interface SearchTestOptions {
  /** Retraso de cada respuesta del Worker (salvo `status`), en ms: la carrera de Intro. */
  readonly latencyMs?: number;
  /** El Worker se queda en `none` o en `scan` hasta `__gaSearchTest.release()`. */
  readonly hold?: 'none' | 'scan';
  /** La primera carga del catálogo falla como sin red; «Reintentar» la repite. */
  readonly failFirstLoad?: boolean;
}

declare global {
  var __GA_SEARCH_TEST__: SearchTestOptions | undefined;
  var __gaSearchTest: { release(): void } | undefined;
}

export function withTestHooks(worker: Worker, transport: SearchTransport): SearchTransport {
  const options = globalThis.__GA_SEARCH_TEST__ ?? {};
  const control = (message: TestControlMessage) => worker.postMessage(message);
  // Antes de `init`: la carga del catálogo ya sale con los ajustes.
  if (options.hold || options.failFirstLoad) {
    control({ type: 'test', hold: options.hold ?? null, failFirstLoad: options.failFirstLoad });
  }
  globalThis.__gaSearchTest = { release: () => control({ type: 'test', hold: null }) };
  const latencyMs = options.latencyMs ?? 0;
  if (latencyMs <= 0) return transport;
  return {
    postMessage: (message: UiToWorkerMessage) => transport.postMessage(message),
    listen(listener: (message: WorkerToUiMessage) => void) {
      return transport.listen((message) => {
        if (message.type === 'status') listener(message);
        else setTimeout(() => listener(message), latencyMs);
      });
    },
    terminate: () => transport.terminate(),
  };
}
