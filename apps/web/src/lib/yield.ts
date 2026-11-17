// Ceder el turno al navegador entre trozos de un trabajo largo (§9.5: ninguna tarea larga).

/** `scheduler.yield()` donde lo hay (sigue antes que otras tareas) y, si no, una tarea nueva. */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
