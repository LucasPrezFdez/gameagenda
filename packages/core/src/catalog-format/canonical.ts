// JSON canónico (RFC 8785, JCS) para firmar el *manifest* (§7.6): claves ordenadas por unidades
// UTF-16, sin espacios y cadenas como las escribe `JSON.stringify`, que es lo que pide la RFC. El
// *manifest* solo lleva cadenas, enteros, booleanos, `null`, objetos y listas: un número que no es
// entero seguro es un error, porque su forma canónica (§3.2.2.3 de la RFC) no hace falta aquí.

/** El JSON canónico de `value`; las propiedades `undefined` se omiten, como en `JSON.stringify`. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`canonicalJson: solo admite enteros seguros (${value})`);
    }
    // `JSON.stringify(-0)` da «0», como pide la RFC.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      // `<` entre cadenas compara unidades UTF-16: el orden de la §3.2.3 de la RFC.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: tipo no admitido (${typeof value})`);
}
