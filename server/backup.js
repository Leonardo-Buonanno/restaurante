import { execFile } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

function backupName(extension) {
  return `mesapro-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
}

function backupKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY || ''
  return value ? createHash('sha256').update(value).digest() : null
}

async function encryptBackup(target) {
  const key = backupKey()
  if (!key) return target

  const iv = randomBytes(12)
  const encryptedTarget = `${target}.enc`
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  await pipeline(createReadStream(target), cipher, createWriteStream(encryptedTarget))
  const tag = cipher.getAuthTag().toString('hex')
  writeFileSync(`${encryptedTarget}.meta.json`, JSON.stringify({ algorithm: 'aes-256-gcm', iv: iv.toString('hex'), tag }, null, 2))
  rmSync(target, { force: true })
  return encryptedTarget
}

function pruneBackups(backupDir) {
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 0)
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return []

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const removed = []
  for (const file of readdirSync(backupDir)) {
    if (!file.startsWith('mesapro-')) continue
    const target = join(backupDir, file)
    const stats = statSync(target)
    if (stats.mtimeMs >= cutoff) continue
    rmSync(target, { force: true })
    removed.push(target)
  }
  return removed
}

async function notifyBackupFailure(error) {
  const webhook = process.env.BACKUP_ALERT_WEBHOOK || ''
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'mesapro-api',
        type: 'backup.failed',
        error: error.message,
        createdAt: Date.now(),
      }),
    })
  } catch {
    // Backup alerts must never crash the app.
  }
}

export async function runBackup(options = {}) {
  const backupDir = options.backupDir || process.env.BACKUP_DIR || join(rootDir, 'backups')
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

  let target
  let type
  if (process.env.DATABASE_URL) {
    target = join(backupDir, backupName('dump'))
    await execFileAsync('pg_dump', [
      process.env.DATABASE_URL,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      target,
    ])
    type = 'postgres'
  } else {
    const dbPath = options.dbPath || process.env.DB_PATH || join(rootDir, 'data', 'mesa-pro.sqlite')
    target = join(backupDir, backupName('sqlite'))
    const sqlite = new DatabaseSync(dbPath)
    await sqliteBackup(sqlite, target)
    sqlite.close()
    type = 'sqlite'
  }

  const finalTarget = await encryptBackup(target)
  const pruned = pruneBackups(backupDir)
  return { type, target: finalTarget, encrypted: Boolean(backupKey()), pruned: pruned.length }
}

export function scheduleBackups({ logger, dbPath } = {}) {
  const intervalMinutes = Number(process.env.BACKUP_INTERVAL_MINUTES || 0)
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return null

  const interval = setInterval(() => {
    void runBackup({ dbPath })
      .then((result) => logger?.('info', 'backup_completed', result))
      .catch((error) =>
        notifyBackupFailure(error).finally(() =>
          logger?.('error', 'backup_failed', {
            error: error.message,
          }),
        ),
      )
  }, intervalMinutes * 60_000)

  interval.unref?.()
  return interval
}
