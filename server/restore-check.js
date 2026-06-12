import { execFile } from 'node:child_process'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createDecipheriv, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

function backupKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY || ''
  return value ? createHash('sha256').update(value).digest() : null
}

async function maybeDecrypt(source) {
  if (!source.endsWith('.enc')) return { source, cleanup: () => undefined }

  const key = backupKey()
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY e obrigatorio para validar backup criptografado')

  const metaPath = `${source}.meta.json`
  if (!existsSync(metaPath)) throw new Error(`Metadados de criptografia nao encontrados: ${metaPath}`)

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const dir = mkdtempSync(join(tmpdir(), 'mesapro-restore-check-'))
  const target = join(dir, basename(source).replace(/\.enc$/, ''))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(meta.tag, 'hex'))
  await pipeline(createReadStream(source), decipher, createWriteStream(target))
  return { source: target, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export async function checkRestore(sourcePath = process.env.BACKUP_SOURCE) {
  if (!sourcePath) throw new Error('Informe BACKUP_SOURCE ou passe o arquivo como argumento')
  if (!existsSync(sourcePath)) throw new Error(`Backup nao encontrado: ${sourcePath}`)

  const decrypted = await maybeDecrypt(sourcePath)
  try {
    if (decrypted.source.endsWith('.dump')) {
      await execFileAsync('pg_restore', ['--list', decrypted.source])
      return { ok: true, type: 'postgres', source: sourcePath }
    }

    const sqlite = new DatabaseSync(decrypted.source, { readOnly: true })
    const result = sqlite.prepare('PRAGMA integrity_check').get()
    sqlite.close()
    if (result.integrity_check !== 'ok') throw new Error(`Integridade SQLite falhou: ${result.integrity_check}`)
    return { ok: true, type: 'sqlite', source: sourcePath }
  } finally {
    decrypted.cleanup()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  checkRestore(process.argv[2])
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
      process.exit(1)
    })
}
