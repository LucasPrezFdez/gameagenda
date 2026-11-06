// D1 de las pruebas: la interfaz de `env.ts` sobre `node:sqlite` (SQLite 3.53.4 en Node 24.21), con
// las migraciones de `../migrations/` aplicadas en orden. Imita lo que importa de D1: claves
// foráneas activas, `batch()` en una transacción que se deshace entera si falla una sentencia,
// `undefined` rechazado al enlazar y booleanos como 1 y 0. Lo que no imita (el SQLite de D1 puede
// ser otra versión, los límites de consultas) se comprueba con `wrangler dev` y en producción.

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from '../env.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const READ_PATTERN = /^\s*SELECT\b/i;

function toSqlite(value: D1Value | undefined): SQLInputValue {
  if (value === undefined) throw new TypeError('D1_TYPE_ERROR: undefined no se puede enlazar');
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

class Statement implements D1PreparedStatement {
  readonly db: SqliteD1;
  readonly sql: string;
  readonly params: readonly D1Value[];

  constructor(db: SqliteD1, sql: string, params: readonly D1Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: D1Value[]): D1PreparedStatement {
    return new Statement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    return ((this.db.execute(this) as D1Result<T>).results[0] ?? null) as T | null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.db.execute(this) as D1Result<T>;
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.db.execute(this) as D1Result<T>;
  }
}

export class SqliteD1 implements D1Database {
  readonly sqlite: DatabaseSync;
  /** Consultas hechas, para contarlas por petición (§7.7: ≤50 en el plan gratuito). */
  queries = 0;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) this.sqlite.exec(readFileSync(MIGRATIONS_DIR + f, 'utf8'));
  }

  prepare(sql: string): D1PreparedStatement {
    return new Statement(this, sql);
  }

  /** Como en D1, un `batch()` cuenta como una sola consulta. */
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.queries++;
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => this.run(s as Statement) as D1Result<T>);
      this.sqlite.exec('COMMIT');
      return out;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  execute(statement: Statement): D1Result {
    this.queries++;
    return this.run(statement);
  }

  private run(statement: Statement): D1Result {
    const stmt = this.sqlite.prepare(statement.sql);
    const results = stmt.all(...statement.params.map(toSqlite)) as Record<string, unknown>[];
    // `changes()` conserva el valor de la última escritura: tras un SELECT, 0.
    const { c, id } = this.sqlite
      .prepare('SELECT changes() AS c, last_insert_rowid() AS id')
      .get() as { c: number; id: number };
    const changes = READ_PATTERN.test(statement.sql) ? 0 : c;
    return { results, success: true, meta: { changes, last_row_id: id, duration: 0 } };
  }

  /** Para mirar el estado en una prueba (CA4.7: «comprobado con una consulta»). */
  rows<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
}
