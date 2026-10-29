// Comprobación «a verificar en M0» de la §8.9 y la §12.4: en el Chromium de Playwright,
// ¿estrangula `Emulation.setCPUThrottlingRate` de la página a un Worker dedicado? ¿Y enviado al
// propio Worker, con la sesión que da `Target.setAutoAttach`? Solo informa: la parte 1 de
// `perf` existe precisamente porque la respuesta medida en Edge fue «no».
//
// Playwright no expone las sesiones hijas de CDP, así que se abre otro Chromium con
// `--remote-debugging-port` y se habla CDP por WebSocket en modo `flatten`.
import { createServer } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { BENCH_URL } from './env.ts';
import { PerfRows } from './rows.ts';

const RATE = 4;
/** Iteraciones del bucle de prueba (≈20–40 ms sin estrangular). */
const LOOP = 30_000_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('sin puerto')),
      );
    });
  });
}

interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId?: string;
}

/** Cliente mínimo de CDP en modo `flatten` (cada mensaje lleva su `sessionId`). */
class Cdp {
  private id = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
  >();
  private readonly listeners = new Set<(event: CdpEvent) => void>();

  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message: string };
      } & Partial<CdpEvent>;
      if (message.id !== undefined) {
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error.message));
        else request?.resolve(message.result ?? {});
      } else if (message.method) {
        for (const listener of this.listeners) listener(message as CdpEvent);
      }
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<Record<string, unknown>> {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.ws.close();
  }
}

/** Mediana de 5 vueltas del bucle, en el hilo principal o en el Worker de prueba. */
function timeLoop(page: Page, where: 'main' | 'worker'): Promise<number> {
  return page.evaluate(
    async ([target, n]) => {
      const loop = (count: number) => {
        const t = performance.now();
        let x = 0;
        for (let i = 0; i < count; i++) x = (x * 31 + i) | 0;
        return { ms: performance.now() - t, x };
      };
      const runs: number[] = [];
      for (let k = 0; k < 5; k++) {
        if (target === 'main') {
          runs.push(loop(n).ms);
        } else {
          const worker = (globalThis as { __perfWorker?: Worker }).__perfWorker as Worker;
          runs.push(
            await new Promise<number>((resolve) => {
              worker.onmessage = (event: MessageEvent<{ ms: number }>) => resolve(event.data.ms);
              worker.postMessage(n);
            }),
          );
        }
      }
      return runs.sort((a, b) => a - b)[2] as number;
    },
    [where, LOOP] as const,
  );
}

test('M0: ¿se estrangula el Worker dedicado en el Chromium de Playwright?', async ({
  playwright,
}, testInfo) => {
  const rows = new PerfRows(`Comprobación de M0 · Worker dedicado con CPU ×${RATE}`);
  const port = await freePort();
  const browser = await playwright.chromium.launch({
    args: [`--remote-debugging-port=${port}`],
  });
  let cdp: Cdp | null = null;
  try {
    const page = await browser.newPage();
    await page.goto(BENCH_URL);
    await page.evaluate(() => {
      // El mismo bucle que en el hilo principal; `n` fuera del bucle (`e.data` es un *getter*).
      const source = `onmessage = (e) => { const n = e.data; const t = performance.now(); let x = 0; for (let i = 0; i < n; i++) x = (x * 31 + i) | 0; postMessage({ ms: performance.now() - t, x }); };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      (globalThis as { __perfWorker?: Worker }).__perfWorker = new Worker(url);
    });
    const base = { main: await timeLoop(page, 'main'), worker: await timeLoop(page, 'worker') };

    // 1. Estrangulamiento de la página (lo que hace `perf`): ¿llega al Worker?
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: RATE });
    const pageOnly = { main: await timeLoop(page, 'main'), worker: await timeLoop(page, 'worker') };
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    // 2. `Target.setAutoAttach` sobre la página y `Emulation.setCPUThrottlingRate` al Worker.
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);
    const { targetInfos } = (await cdp.send('Target.getTargets')) as {
      targetInfos: { targetId: string; type: string; url: string }[];
    };
    const target = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(BENCH_URL));
    expect(target, 'la pestaña de la página de prueba').toBeTruthy();
    const { sessionId: pageSession } = (await cdp.send('Target.attachToTarget', {
      targetId: target?.targetId,
      flatten: true,
    })) as { sessionId: string };
    const workerSession = new Promise<string | null>((resolve) => {
      const stop = cdp?.on((event) => {
        const info = event.params.targetInfo as { type?: string } | undefined;
        if (event.method === 'Target.attachedToTarget' && info?.type === 'worker') {
          stop?.();
          resolve(event.params.sessionId as string);
        }
      });
      setTimeout(() => resolve(null), 5000);
    });
    await cdp.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      pageSession,
    );
    const workerId = await workerSession;
    let autoAttach: { worker: number | null; error: string | null } = {
      worker: null,
      error: workerId ? null : 'Target.setAutoAttach no ha adjuntado el Worker',
    };
    if (workerId) {
      try {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE }, workerId);
        autoAttach = { worker: await timeLoop(page, 'worker'), error: null };
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }, workerId);
      } catch (error) {
        autoAttach = {
          worker: null,
          error: `Target.setAutoAttach adjunta el Worker, pero Emulation.setCPUThrottlingRate responde «${(error as Error).message}»`,
        };
      }
    }

    const ratio = (x: number) => Math.round((x / base.worker) * 100) / 100;
    const mainRatio = Math.round((pageOnly.main / base.main) * 100) / 100;
    // Estrangulado si se acerca más al ×4 del hilo principal que a ×1 (el resto es ruido).
    const verdict = (ms: number) =>
      `${base.worker.toFixed(1)} → ${ms.toFixed(1)} ms: ${ms / base.worker < 1 + (mainRatio - 1) / 2 ? 'NO se estrangula' : 'sí se estrangula'}`;
    rows.add({
      metric: `Hilo principal: ×${RATE} en la página (bucle, mediana de 5)`,
      stat: 'ralentiza ×',
      value: mainRatio,
      unit: '',
      note: `${base.main.toFixed(1)} → ${pageOnly.main.toFixed(1)} ms`,
    });
    rows.add({
      metric: `Worker dedicado: ×${RATE} en la página`,
      stat: 'ralentiza ×',
      value: ratio(pageOnly.worker),
      unit: '',
      note: verdict(pageOnly.worker),
    });
    rows.add({
      metric: `Worker dedicado: ×${RATE} con Target.setAutoAttach`,
      stat: 'ralentiza ×',
      value: autoAttach.worker === null ? null : ratio(autoAttach.worker),
      unit: '',
      note: autoAttach.error ?? verdict(autoAttach.worker as number),
    });
  } finally {
    cdp?.close();
    await browser.close();
    await rows.attach(testInfo);
  }
});
