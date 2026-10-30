# Clave de firma de desarrollo

`dev-catalog-key.pem` es la clave privada ed25519 (PKCS#8) **de desarrollo**, `kid` `dev-1`. Firma el mini-catálogo de `fixtures/catalog/` y los catálogos de las pruebas. Su pública está en `packages/core/src/catalog-format/signature.ts`, marcada como `use: 'dev'`.

Está en el repositorio a propósito, así que cualquiera puede firmar con ella: un *build* de producción **nunca** confía en ella (`trustedSigningKeys({ dev: false })`). La privada de producción solo vive en el secreto `CATALOG_SIGNING_KEY` de GitHub (§11.3 de `prototipe.md`).
