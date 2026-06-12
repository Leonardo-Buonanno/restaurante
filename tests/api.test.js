import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'

const port = 8910 + Math.floor(Math.random() * 500)
const dbPath = join(tmpdir(), `mesapro-test-${process.pid}.sqlite`)
const baseUrl = `http://127.0.0.1:${port}`

function cleanupDb() {
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}

async function waitForServer() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error('Servidor nao iniciou a tempo')
}

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

test('API transacional protege permissoes e executa fluxo de mesa', async (t) => {
  cleanupDb()
  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      DATABASE_URL: '',
      BACKUP_INTERVAL_MINUTES: '0',
    },
    stdio: 'ignore',
  })

  t.after(async () => {
    if (!server.killed) server.kill('SIGTERM')
    await Promise.race([
      once(server, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
    cleanupDb()
  })

  await waitForServer()

  const setup = await api('/api/setup/admin', {
    method: 'POST',
    body: { name: 'Admin Teste', pin: '1234', restaurantSlug: 'principal' },
  })
  assert.equal(setup.response.status, 201)
  const adminToken = setup.payload.token

  const staff = await api('/api/staff', {
    token: adminToken,
    method: 'POST',
    body: { name: 'Garcom Teste', role: 'waiter', pin: '4321' },
  })
  assert.equal(staff.response.status, 201)
  const waiter = staff.payload.staff.find((member) => member.name === 'Garcom Teste')
  assert.ok(waiter)

  const loginWaiter = await api('/api/auth/login', {
    method: 'POST',
    body: { staffId: waiter.id, pin: '4321', restaurantSlug: 'principal' },
  })
  assert.equal(loginWaiter.response.status, 200)

  const denied = await api('/api/operations', {
    token: loginWaiter.payload.token,
    method: 'POST',
    body: {
      type: 'table.create',
      payload: { table: { id: 'mesa-negada', number: 99, seats: 2, zone: 'Teste' } },
    },
  })
  assert.equal(denied.response.status, 403)

  const table = await api('/api/tables', {
    token: adminToken,
    method: 'POST',
    body: { table: { id: 'mesa-1', number: 1, seats: 4, zone: 'Salao' } },
  })
  assert.equal(table.response.status, 201)
  assert.equal(table.payload._version, 2)

  const menu = await api('/api/menu', {
    token: adminToken,
    method: 'POST',
    body: {
      item: {
        id: 'burger',
        name: 'Burger',
        category: 'Pratos',
        description: 'Teste',
        price: 10,
        prepMinutes: 10,
        station: 'grill',
        tags: [],
        allergens: [],
        favorite: true,
        available: true,
        pairingIds: [],
        modifierGroups: [],
      },
    },
  })
  assert.equal(menu.response.status, 201)

  assert.equal((await api('/api/tables/mesa-1/open', { token: adminToken, method: 'POST', body: { guests: 2 } })).response.status, 200)
  assert.equal((await api('/api/orders', { token: adminToken, method: 'POST', body: { tableId: 'mesa-1', menuItemId: 'burger' } })).response.status, 201)
  assert.equal((await api('/api/tables/mesa-1/send-to-kitchen', { token: adminToken, method: 'POST', body: {} })).response.status, 200)
  assert.equal((await api('/api/payments', { token: adminToken, method: 'POST', body: { tableId: 'mesa-1', amount: 11, method: 'pix' } })).response.status, 201)
  const closed = await api('/api/tables/mesa-1/close', { token: adminToken, method: 'POST', body: {} })
  assert.equal(closed.response.status, 200)
  assert.equal(closed.payload.tables.find((item) => item.id === 'mesa-1').status, 'free')
})
