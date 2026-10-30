// Fuentes de reserva calentadas en ratos ociosos. La primera vez que el navegador maqueta una
// escritura que la fuente de la app no tiene (han, kana, hangul o emoji), busca y carga otra del
// sistema. Le pasa una vez por proceso, escritura y peso, y es lento: con CPU ×4 en Windows
// cuesta 30–130 ms la primera vez y 2–12 ms después (medido el 30-10-2026). Si eso cae al
// teclear o al apuntar, es una tarea larga (RNF-03). Se maqueta una muestra por tarea.

/** Una muestra por escritura: han, kana, hangul y emoji. */
const SAMPLES = ['游戏', 'のゲーム', '게임', '🎮'] as const;
/**
 * Pesos con nombres de juegos al teclear y al apuntar: paleta y título de la fila (600), iniciales
 * de la portada generada y cabeceras (700) y aviso (400). El tamaño también cuenta, pero mucho
 * menos (≈20–30 ms con ×4 la primera vez): basta con el de base.
 */
const WEIGHTS = [600, 700, 400] as const;

type Idle = (task: () => void) => void;

const onIdle: Idle =
  typeof requestIdleCallback === 'function'
    ? (task) => requestIdleCallback(task)
    : // Safari sin `requestIdleCallback`: tras un respiro, cuando el arranque ya ha pasado.
      (task) => setTimeout(task, 500);

/**
 * Maqueta, fuera de la vista y en ratos ociosos, cada muestra con cada peso. Hay que llamarla
 * después del primer pintado: un rato ocioso puede llegar antes. Al terminar deja la marca
 * `app:fonts-warm` (la espera `npm run perf`).
 */
export function warmFallbackFonts(idle: Idle = onIdle): void {
  const queue = WEIGHTS.flatMap((weight) => SAMPLES.map((text) => ({ text, weight })));
  const next = (): void => {
    const sample = queue.shift();
    if (!sample) {
      performance.mark('app:fonts-warm');
      return;
    }
    const probe = document.createElement('span');
    probe.className = 'visually-hidden';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.fontWeight = String(sample.weight);
    probe.textContent = sample.text;
    document.body.append(probe);
    // La fuente de reserva se resuelve al maquetar el texto.
    probe.getBoundingClientRect();
    probe.remove();
    idle(next);
  };
  idle(next);
}
