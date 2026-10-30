// APIs que existen en el navegador, en Cloudflare Workers y en Node, pero que TypeScript solo
// declara en las `lib` DOM y WebWorker, que el `tsconfig` de `core` no incluye (§14.3, regla 1).
// Solo lo que `core` usa: nada de E/S.

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array<ArrayBuffer>;
}
