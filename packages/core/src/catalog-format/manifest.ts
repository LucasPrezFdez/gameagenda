// Esquema del manifest del catálogo (§7.6). El de M1 no lleva `sig`, `killSwitches`, `recent`
// ni `details`: el esquema los admite como opcionales. Ignora los campos desconocidos.

import { z } from 'zod';

const RE_VERSION = /^\d{8}\.[1-9]\d*$/;
// Ruta relativa al origen del catálogo, sin `..` ni barra inicial.
const RE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const RE_SEMVER = /^\d+\.\d+\.\d+$/;
const RE_BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const count = z.int().nonnegative();

/** Un fichero publicado: ruta con el *hash* en el nombre, SHA-256 y tamaño en bytes. */
export const catalogFileSchema = z.object({
  path: z.string().regex(RE_PATH),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: count,
});

export const catalogManifestSchema = z.object({
  format: z.literal('gacat'),
  v: z.literal(1),
  /** `AAAAMMDD.N`. */
  version: z.string().regex(RE_VERSION),
  generatedAt: z.iso.datetime(),
  /** Filas de cada fichero; `core` es el recuento del Catálogo con +18 visible (CA1.2). */
  counts: z.object({
    core: count,
    aliases: count,
    recent: count.optional(),
    boot: count.optional(),
  }),
  files: z.object({
    core: catalogFileSchema,
    aliases: catalogFileSchema,
    recent: catalogFileSchema.optional(),
    /** Índice de *shards*, `details/index.<hash>.json` (M2). */
    details: catalogFileSchema.optional(),
    boot: catalogFileSchema.optional(),
  }),
  enrichmentAgeDays: count,
  minClientVersion: z.string().regex(RE_SEMVER),
  killSwitches: z.object({ covers: z.boolean(), details: z.boolean() }).optional(),
  /** Firma ed25519 del JSON canónico sin `sig` (RFC 8785); obligatoria desde v0.2.0. */
  sig: z
    .object({
      kid: z.string().min(1),
      ed25519: z.string().regex(RE_BASE64URL),
    })
    .optional(),
});

export type CatalogFile = z.infer<typeof catalogFileSchema>;
export type CatalogManifest = z.infer<typeof catalogManifestSchema>;
