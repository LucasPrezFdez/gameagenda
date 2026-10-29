// Ganchos de los E2E en el Worker (ver §12.3). Solo los importa el *build* del modo `e2e`: en el
// de producción, `import.meta.env.MODE` no es `e2e` y este módulo queda fuera del *bundle*.
import type { TestControlMessage } from '../search-client/protocol.ts';
import { CatalogLoadError } from './catalog-store.ts';
import type { HostTestHooks } from './host.ts';

export interface WorkerTestHooks extends HostTestHooks {
  control(message: TestControlMessage): void;
}

export function createWorkerTestHooks(): WorkerTestHooks {
  let hold: 'none' | 'scan' | null = null;
  let failNext = false;
  return {
    hold: () => hold,
    beforeLoad() {
      if (!failNext) return;
      failNext = false;
      throw new CatalogLoadError('network', 'Fallo de red simulado (E2E)');
    },
    control(message) {
      if (message.hold !== undefined) hold = message.hold;
      if (message.failFirstLoad) failNext = true;
    },
  };
}
