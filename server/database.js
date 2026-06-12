import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const { Pool, types } = pg

types.setTypeParser(20, (value) => Number(value))
types.setTypeParser(1700, (value) => Number(value))

function sqliteSql(sql) {
  return sql.replace(/\$\d+/g, '?')
}

export async function createDatabase({ dbPath }) {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5_000),
    })

    return {
      dialect: 'postgres',
      label: 'PostgreSQL',
      async exec(sql) {
        await pool.query(sql)
      },
      async get(sql, params = []) {
        const result = await pool.query(sql, params)
        return result.rows[0]
      },
      async all(sql, params = []) {
        const result = await pool.query(sql, params)
        return result.rows
      },
      async run(sql, params = []) {
        const result = await pool.query(sql, params)
        return { changes: result.rowCount }
      },
      async ping() {
        await pool.query('SELECT 1')
      },
      async close() {
        await pool.end()
      },
    }
  }

  const sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')

  return {
    dialect: 'sqlite',
    label: `SQLite:${dbPath}`,
    async exec(sql) {
      sqlite.exec(sqliteSql(sql))
    },
    async get(sql, params = []) {
      return sqlite.prepare(sqliteSql(sql)).get(...params)
    },
    async all(sql, params = []) {
      return sqlite.prepare(sqliteSql(sql)).all(...params)
    },
    async run(sql, params = []) {
      return sqlite.prepare(sqliteSql(sql)).run(...params)
    },
    async ping() {
      sqlite.prepare('SELECT 1').get()
    },
    async close() {
      sqlite.close()
    },
  }
}
