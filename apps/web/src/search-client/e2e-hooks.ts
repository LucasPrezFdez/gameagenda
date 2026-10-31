// Ganchos de los E2E en el hilo principal (ver §12.3). Solo los importa el *build* del modo `e2e`:
// en el de producción, `import.meta.env.MODE` no es `e2e` y este módulo queda fuera del *bundle*.
// Las pruebas los fijan con `page.addInitScript` en `globalThis.__GA_SEARCH_TEST__`.
import type {
  SearchTransport,
  StatusMessage,
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
  /**
   * Sin Ed25519 en WebCrypto (el WebKit de Playwright en Windows), acepta sin verificarlo un
   * *manifest* firmado con la clave de desarrollo. **Encendido salvo `false`**: sin él,
   * `webkit-movil` no tendría catálogo. Donde hay Ed25519 no cambia nada: la firma se verifica
   * igual. Ver ADR-005.
   */
  readonly unverifiedDevSignature?: boolean;
}

export interface SearchTestHandle {
  /** Suelta el Worker parado con `hold`. */
  release(): void;
  /** Tiempo de cada consulta dentro del Worker (`results.ms`), para las mediciones a mano. */
  readonly workerMs: number[];
  /** El último `status` del Worker (estado, versión y `error` del catálogo). */
  readonly status: StatusMessage | null;
}

declare global {
  var __GA_SEARCH_TEST__: SearchTestOptions | undefined;
  var __gaSearchTest: SearchTestHandle | undefined;
}

export function withTestHooks(worker: Worker, transport: SearchTransport): SearchTransport {
  const options = globalThis.__GA_SEARCH_TEST__ ?? {};
  const control = (message: TestControlMessage) => worker.postMessage(message);
  // Antes de `init`: la carga del catálogo ya sale con los ajustes.
  control({
    type: 'test',
    hold: options.hold ?? null,
    failFirstLoad: options.failFirstLoad,
    unverifiedDevSignature: options.unverifiedDevSignature ?? true,
  });
  let status: StatusMessage | null = null;
  const handle: SearchTestHandle = {
    release: () => control({ type: 'test', hold: null }),
    workerMs: [],
    get status() {
      return status;
    },
  };
  globalThis.__gaSearchTest = handle;
  const latencyMs = options.latencyMs ?? 0;
  return {
    postMessage: (message: UiToWorkerMessage) => transport.postMessage(message),
    listen(listener: (message: WorkerToUiMessage) => void) {
      return transport.listen((message) => {
        if (message.type === 'results') handle.workerMs.push(message.ms);
        if (message.type === 'status') status = message;
        if (message.type === 'status' || latencyMs <= 0) listener(message);
        else setTimeout(() => listener(message), latencyMs);
      });
    },
    terminate: () => transport.terminate(),
  };
}
