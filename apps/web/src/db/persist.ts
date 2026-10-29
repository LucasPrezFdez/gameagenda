// `navigator.storage.persist()` en la primera escritura (§7.2, RNF-08): pide al navegador que no
// borre la agenda cuando le falte espacio. Si lo niega, la app sigue igual.

let requested = false;

export function requestPersistentStorage(): void {
  if (requested) return;
  requested = true;
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persist !== 'function') return;
  void storage
    .persisted()
    .then((persisted) => (persisted ? true : storage.persist()))
    .catch(() => false);
}
