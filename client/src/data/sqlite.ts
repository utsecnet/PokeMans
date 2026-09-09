/**
 * The one seam the whole Android port turns on.
 *
 * Today every query runs through `node:sqlite`, which is synchronous: `all()` returns rows,
 * not a promise. `@capacitor-community/sqlite` is asynchronous, because on Android the query
 * crosses from the WebView into native code. There is no synchronous shim for that — the
 * bridge is a message pass — so the ~260 call sites in the server have to become `await`
 * whichever driver ends up underneath.
 *
 * That conversion is the expensive part of this port, and it is worth doing *before*
 * Capacitor is in the picture: an async codebase can still be run and tested against
 * node:sqlite in the existing Express server and a normal browser. Debugging the async
 * rewrite and the native shell at the same time would mean never knowing which one broke.
 *
 * So: this interface is async from the start, both implementations satisfy it, and the port
 * happens in two independently verifiable steps rather than one.
 */
export interface SqlDatabase {
  /** Every row a statement returns. */
  all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  /** The first row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T | undefined>;
  /** A statement run for its effect. `changes` is what the undo and upsert paths read. */
  run(sql: string, params?: Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number }>;
  /** Multiple statements, for schema application and migrations. */
  exec(sql: string): Promise<void>;
  /**
   * Runs `work` inside a transaction, rolling back if it throws.
   *
   * Explicit rather than implied because two writes in this app must not half-apply: filing
   * a card touches an entry and a box, and the reorder rewrites every position. On the
   * native side each statement is a separate bridge call, so without this they are separate
   * transactions and a failure halfway leaves an order with duplicate positions.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Which databases the app opens.
 *
 * They stay separate on Android for the same reason they are separate now: the catalogue is
 * re-downloadable and the personal data is not. Splitting them lets Android's Auto Backup
 * include the small irreplaceable one and exclude the 11 MB that can be fetched again —
 * which, incidentally, is the OS-level protection that would have saved a collection deleted
 * by accident.
 */
export type DatabaseName = 'catalog' | 'personal';

export interface SqliteDriver {
  open(name: DatabaseName): Promise<SqlDatabase>;
}
