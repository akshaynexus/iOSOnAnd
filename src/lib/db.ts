// Tiny D1 access helper for the iOSOnAnd tracker (Workers runtime).
// No ORM, no runtime dependencies: raw prepared statements against the
// D1 binding. Keep the server bundle lean (no heavy top-level imports).
//
// Wave-2 contract:
//   getDb()                          -> D1Database (reads binding internally)
//   queryAll<T>(sql, params?)        -> Promise<T[]>
//   queryFirst<T>(sql, params?)      -> Promise<T | null>
//   exec(sql, params?)               -> Promise<void>
//
// Binding source: `env` from 'cloudflare:workers' (the Worker's environment,
// which carries the DB binding from wrangler.jsonc `d1_databases`).

import { env } from "cloudflare:workers";

// Minimal structural D1 typings (dependency-free: no @cloudflare/workers-types
// import, so this file has zero runtime imports besides the Workers `env`).
export interface D1Result<T> {
  results: T[];
  success: boolean;
}

export interface D1ExecResult {
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1ExecResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface WorkerEnv {
  DB: D1Database;
}

export function getDb(): D1Database {
  const db = (env as unknown as WorkerEnv).DB;
  if (!db) {
    throw new Error("Missing D1 binding: DB (check wrangler.jsonc d1_databases)");
  }
  return db;
}

export async function queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const out = await getDb().prepare(sql).bind(...params).all<T>();
  return out.results ?? [];
}

export async function queryFirst<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return getDb().prepare(sql).bind(...params).first<T>();
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await getDb().prepare(sql).bind(...params).run();
}
