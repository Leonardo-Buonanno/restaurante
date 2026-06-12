import { runBackup } from '../server/backup.js'

try {
  const result = await runBackup()
  console.log(JSON.stringify({ ok: true, ...result }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
  process.exit(1)
}
