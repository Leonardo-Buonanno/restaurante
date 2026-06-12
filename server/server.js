import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { extname, join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { scheduleBackups } from './backup.js'
import { createDatabase } from './database.js'
import {
  defaultIntegrationSettings,
  initialAppState,
  restaurant,
  staffSeed,
} from './seed-data.js'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = join(rootDir, 'data')
const distDir = join(rootDir, 'dist')
const dbPath = process.env.DB_PATH || join(dataDir, 'mesa-pro.sqlite')
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 12)
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 750_000)
const maxStateBytes = Number(process.env.MAX_STATE_BYTES || 600_000)
const allowPrivateIntegrationEndpoints = process.env.ALLOW_PRIVATE_INTEGRATION_ENDPOINTS === 'true'
const metricsToken = process.env.METRICS_TOKEN || ''
const metricsPublic = process.env.METRICS_PUBLIC === 'true'
const allowedHosts = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean)
const startedAt = Date.now()

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = await createDatabase({ dbPath })

const metrics = {
  startedAt,
  requestsTotal: 0,
  errorsTotal: 0,
  byStatus: {},
  byMethod: {},
  lastRequestAt: null,
}

const rateBuckets = new Map()

const allowedStateActions = [
  'manageTables',
  'manageAccessProfiles',
  'manageProducts',
  'manageIntegrations',
  'viewReports',
  'cancelOrders',
  'updateKitchenStatus',
  'registerPayments',
  'closeTables',
  'resetOperationalData',
]

const allowedViews = ['floor', 'order', 'kitchen', 'checkout', 'manager', 'menu', 'integrations']
const allowedTableStatus = ['free', 'seated', 'ordering', 'preparing', 'served', 'checkout', 'attention']
const allowedOrderStatus = ['draft', 'sent', 'preparing', 'ready', 'served', 'cancelled']
const allowedStations = ['bar', 'grill', 'cold', 'dessert', 'pass']
const allowedPaymentMethods = ['pix', 'credit', 'debit', 'cash', 'voucher']

function now() {
  return Date.now()
}

function log(level, message, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    service: 'mesapro-api',
    ...fields,
  }
  console.log(JSON.stringify(entry))
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function securityError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function stringValue(value, max = 300) {
  return String(value ?? '').trim().slice(0, max)
}

function numberValue(value, fallback = 0, min = 0, max = 1_000_000) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function boolValue(value) {
  return Boolean(value)
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function listValue(value, maxItems, mapper) {
  return Array.isArray(value) ? value.slice(0, maxItems).map(mapper).filter(Boolean) : []
}

function dedupe(values) {
  return values.filter((value, index, list) => list.indexOf(value) === index)
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || req.socket.remoteAddress || 'unknown'
}

function requireRateLimit(key, { limit, windowMs }) {
  const current = now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= current) {
    rateBuckets.set(key, { count: 1, resetAt: current + windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > limit) {
    const error = securityError('Muitas tentativas. Aguarde e tente novamente.', 429)
    error.retryAfter = Math.ceil((bucket.resetAt - current) / 1000)
    throw error
  }
}

function cleanupRateBuckets() {
  const current = now()
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= current) rateBuckets.delete(key)
  }
}

setInterval(cleanupRateBuckets, 60_000).unref()

function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  const digest = pbkdf2Sync(String(pin), salt, 120_000, 32, 'sha512').toString('hex')
  return { salt, digest }
}

function verifyPin(pin, salt, digest) {
  const attempt = pbkdf2Sync(String(pin), salt, 120_000, 32, 'sha512')
  const expected = Buffer.from(digest, 'hex')
  return expected.length === attempt.length && timingSafeEqual(expected, attempt)
}

async function migrate() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active SMALLINT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_states (
      restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      staff_id TEXT,
      action TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS state_events (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      staff_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      base_version BIGINT NOT NULL,
      resulting_version BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_settings (
      restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
      printer_endpoint TEXT NOT NULL DEFAULT '',
      payments_provider TEXT NOT NULL DEFAULT 'manual',
      payments_public_key TEXT NOT NULL DEFAULT '',
      kds_webhook TEXT NOT NULL DEFAULT '',
      enable_printer SMALLINT NOT NULL DEFAULT 0,
      enable_payments SMALLINT NOT NULL DEFAULT 0,
      enable_kds_webhook SMALLINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fiscal_settings (
      restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_endpoint TEXT NOT NULL DEFAULT '',
      state_code TEXT NOT NULL DEFAULT '',
      city_code TEXT NOT NULL DEFAULT '',
      enable_fiscal SMALLINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );
  `)

  if (db.dialect === 'postgres') {
    await db.exec('ALTER TABLE app_states ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1')
  } else {
    const columns = await db.all('PRAGMA table_info(app_states)')
    if (!columns.some((column) => column.name === 'version')) {
      await db.exec('ALTER TABLE app_states ADD COLUMN version BIGINT NOT NULL DEFAULT 1')
    }
  }
}

async function seed() {
  const existingRestaurant = await db.get('SELECT id FROM restaurants WHERE slug = $1', [restaurant.slug])
  if (!existingRestaurant) {
    await db.run('INSERT INTO restaurants (id, name, slug, created_at) VALUES ($1, $2, $3, $4)', [
      restaurant.id,
      restaurant.name,
      restaurant.slug,
      now(),
    ])
  }

  const staffCount = await db.get('SELECT COUNT(*) AS total FROM staff WHERE restaurant_id = $1', [
    restaurant.id,
  ])
  if (Number(staffCount?.total ?? 0) === 0) {
    for (const member of staffSeed) {
      const pin = hashPin(member.pin)
      await db.run(
        `
          INSERT INTO staff (id, restaurant_id, name, role, pin_salt, pin_hash, active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
        `,
        [member.id, restaurant.id, member.name, member.role, pin.salt, pin.digest, now()],
      )
    }
  }

  const state = await db.get('SELECT restaurant_id FROM app_states WHERE restaurant_id = $1', [
    restaurant.id,
  ])
  if (!state) {
    await db.run('INSERT INTO app_states (restaurant_id, payload, updated_at) VALUES ($1, $2, $3)', [
      restaurant.id,
      JSON.stringify(initialAppState),
      now(),
    ])
  }

  const integrations = await db.get(
    'SELECT restaurant_id FROM integration_settings WHERE restaurant_id = $1',
    [restaurant.id],
  )
  if (!integrations) {
    await db.run(
      `
        INSERT INTO integration_settings (
          restaurant_id,
          printer_endpoint,
          payments_provider,
          payments_public_key,
          kds_webhook,
          enable_printer,
          enable_payments,
          enable_kds_webhook,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        restaurant.id,
        defaultIntegrationSettings.printerEndpoint,
        defaultIntegrationSettings.paymentsProvider,
        defaultIntegrationSettings.paymentsPublicKey,
        defaultIntegrationSettings.kdsWebhook,
        Number(defaultIntegrationSettings.enablePrinter),
        Number(defaultIntegrationSettings.enablePayments),
        Number(defaultIntegrationSettings.enableKdsWebhook),
        now(),
      ],
    )
  }

  const fiscal = await db.get(
    'SELECT restaurant_id FROM fiscal_settings WHERE restaurant_id = $1',
    [restaurant.id],
  )
  if (!fiscal) {
    await db.run(
      `
        INSERT INTO fiscal_settings (
          restaurant_id,
          provider,
          provider_endpoint,
          state_code,
          city_code,
          enable_fiscal,
          updated_at
        )
        VALUES ($1, 'manual', '', '', '', 0, $2)
      `,
      [restaurant.id, now()],
    )
  }
}

await migrate()
await seed()
scheduleBackups({ logger: log, dbPath })

function cleanStaff(member) {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
  }
}

async function getRestaurantBySlug(slug) {
  return db.get('SELECT * FROM restaurants WHERE slug = $1', [slug])
}

async function getStaffForRestaurant(restaurantId) {
  const rows = await db.all(
    'SELECT id, name, role FROM staff WHERE restaurant_id = $1 AND active = 1 ORDER BY name',
    [restaurantId],
  )
  return rows.map(cleanStaff)
}

async function getStaffCount(restaurantId) {
  const row = await db.get('SELECT COUNT(*) AS total FROM staff WHERE restaurant_id = $1', [restaurantId])
  return Number(row?.total ?? 0)
}

async function getActiveAdminCount(restaurantId) {
  const row = await db.get(
    "SELECT COUNT(*) AS total FROM staff WHERE restaurant_id = $1 AND role = 'admin' AND active = 1",
    [restaurantId],
  )
  return Number(row?.total ?? 0)
}

async function getAppState(restaurantId, activeUserId) {
  const row = await db.get('SELECT payload, version FROM app_states WHERE restaurant_id = $1', [restaurantId])
  const state = row ? safeJson(row.payload, initialAppState) : initialAppState
  return {
    ...state,
    staff: await getStaffForRestaurant(restaurantId),
    activeUserId,
    _version: Number(row?.version ?? 1),
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function sanitizeAccessProfile(profile) {
  const permissions = dedupe(listValue(profile.permissions, 12, (permission) =>
    allowedViews.includes(permission) ? permission : null,
  ))
  const actions = dedupe(listValue(profile.actions, 20, (action) =>
    allowedStateActions.includes(action) ? action : null,
  ))
  const id = stringValue(profile.id, 80)
  const name = stringValue(profile.name, 80)

  if (!id || !name || permissions.length === 0) return null
  return {
    id,
    name,
    permissions,
    actions,
    system: boolValue(profile.system),
  }
}

function sanitizeTable(table) {
  const id = stringValue(table.id, 80)
  if (!id) return null
  return {
    id,
    number: Math.floor(numberValue(table.number, 1, 1, 9999)),
    seats: Math.floor(numberValue(table.seats, 1, 1, 999)),
    guestCount: Math.floor(numberValue(table.guestCount, 0, 0, 999)),
    zone: stringValue(table.zone, 80),
    status: enumValue(table.status, allowedTableStatus, 'free'),
    serverId: stringValue(table.serverId, 80) || undefined,
    openedAt: table.openedAt ? numberValue(table.openedAt, undefined, 0, Number.MAX_SAFE_INTEGER) : undefined,
    lastActivityAt: numberValue(table.lastActivityAt, now(), 0, Number.MAX_SAFE_INTEGER),
  }
}

function sanitizeMenuItem(item) {
  const id = stringValue(item.id, 80)
  const name = stringValue(item.name, 140)
  if (!id || !name) return null

  return {
    id,
    name,
    category: stringValue(item.category, 80),
    description: stringValue(item.description, 700),
    price: numberValue(item.price, 0, 0, 100_000),
    prepMinutes: Math.floor(numberValue(item.prepMinutes, 0, 0, 600)),
    station: enumValue(item.station, allowedStations, 'pass'),
    tags: listValue(item.tags, 30, (tag) => stringValue(tag, 40)),
    allergens: listValue(item.allergens, 30, (allergen) => stringValue(allergen, 40)),
    favorite: boolValue(item.favorite),
    available: boolValue(item.available),
    pairingIds: listValue(item.pairingIds, 100, (idValue) => stringValue(idValue, 80)),
    modifierGroups: listValue(item.modifierGroups, 20, (group) => ({
      name: stringValue(group.name, 80),
      required: boolValue(group.required),
      options: listValue(group.options, 30, (option) => stringValue(option, 120)),
    })).filter((group) => group.name && group.options.length > 0),
  }
}

function sanitizeOrder(order) {
  const id = stringValue(order.id, 80)
  const tableId = stringValue(order.tableId, 80)
  if (!id || !tableId) return null

  return {
    id,
    tableId,
    menuItemId: stringValue(order.menuItemId, 80),
    name: stringValue(order.name, 140),
    category: stringValue(order.category, 80),
    station: enumValue(order.station, allowedStations, 'pass'),
    quantity: Math.floor(numberValue(order.quantity, 1, 1, 999)),
    unitPrice: numberValue(order.unitPrice, 0, 0, 100_000),
    seat: stringValue(order.seat, 80),
    notes: stringValue(order.notes, 700),
    modifiers: listValue(order.modifiers, 40, (modifier) => stringValue(modifier, 160)),
    status: enumValue(order.status, allowedOrderStatus, 'draft'),
    createdAt: numberValue(order.createdAt, now(), 0, Number.MAX_SAFE_INTEGER),
    sentAt: order.sentAt ? numberValue(order.sentAt, undefined, 0, Number.MAX_SAFE_INTEGER) : undefined,
    readyAt: order.readyAt ? numberValue(order.readyAt, undefined, 0, Number.MAX_SAFE_INTEGER) : undefined,
    servedAt: order.servedAt ? numberValue(order.servedAt, undefined, 0, Number.MAX_SAFE_INTEGER) : undefined,
    cancelledAt: order.cancelledAt ? numberValue(order.cancelledAt, undefined, 0, Number.MAX_SAFE_INTEGER) : undefined,
    cancelledBy: stringValue(order.cancelledBy, 80) || undefined,
    cancelReason: stringValue(order.cancelReason, 300) || undefined,
  }
}

function sanitizeServiceRequest(request) {
  const id = stringValue(request.id, 80)
  const tableId = stringValue(request.tableId, 80)
  if (!id || !tableId) return null

  return {
    id,
    tableId,
    label: stringValue(request.label, 160),
    createdAt: numberValue(request.createdAt, now(), 0, Number.MAX_SAFE_INTEGER),
    priority: enumValue(request.priority, ['normal', 'high'], 'normal'),
    resolved: boolValue(request.resolved),
  }
}

function sanitizePayment(payment) {
  const id = stringValue(payment.id, 80)
  const tableId = stringValue(payment.tableId, 80)
  if (!id || !tableId) return null

  return {
    id,
    tableId,
    amount: numberValue(payment.amount, 0, 0, 1_000_000),
    method: enumValue(payment.method, allowedPaymentMethods, 'pix'),
    createdAt: numberValue(payment.createdAt, now(), 0, Number.MAX_SAFE_INTEGER),
  }
}

function sanitizeAuditEvent(event) {
  const id = stringValue(event.id, 80)
  if (!id) return null

  return {
    id,
    action: stringValue(event.action, 100),
    label: stringValue(event.label, 240),
    actorId: stringValue(event.actorId, 80) || undefined,
    actorName: stringValue(event.actorName, 120) || undefined,
    tableId: stringValue(event.tableId, 80) || undefined,
    orderId: stringValue(event.orderId, 80) || undefined,
    createdAt: numberValue(event.createdAt, now(), 0, Number.MAX_SAFE_INTEGER),
    metadata: typeof event.metadata === 'object' && event.metadata
      ? Object.fromEntries(
          Object.entries(event.metadata)
            .slice(0, 30)
            .map(([key, value]) => [stringValue(key, 60), ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined])
            .filter(([key, value]) => key && value !== undefined),
        )
      : {},
  }
}

async function persistedState(restaurantId) {
  const row = await db.get('SELECT payload FROM app_states WHERE restaurant_id = $1', [restaurantId])
  return row ? safeJson(row.payload, initialAppState) : initialAppState
}

async function persistedStateRecord(restaurantId) {
  const row = await db.get('SELECT payload, version FROM app_states WHERE restaurant_id = $1', [restaurantId])
  return {
    state: row ? safeJson(row.payload, initialAppState) : initialAppState,
    version: Number(row?.version ?? 1),
  }
}

function stateProfileHasAction(state, role, action, fallbackRoles = []) {
  if (fallbackRoles.includes(role)) return true
  const profile = Array.isArray(state.accessProfiles)
    ? state.accessProfiles.find((item) => item.id === role)
    : null
  return Boolean(profile?.actions?.includes(action))
}

async function sanitizeAppState(state, restaurantId, session) {
  const existing = await persistedState(restaurantId)
  const canManageAccessProfiles = stateProfileHasAction(existing, session.user.role, 'manageAccessProfiles', ['admin'])
  const canManageProducts = stateProfileHasAction(existing, session.user.role, 'manageProducts', ['admin', 'manager'])

  const sanitized = {
    staff: await getStaffForRestaurant(restaurantId),
    accessProfiles: canManageAccessProfiles
      ? listValue(state.accessProfiles, 100, sanitizeAccessProfile)
      : (Array.isArray(existing.accessProfiles) ? existing.accessProfiles : initialAppState.accessProfiles),
    tables: listValue(state.tables, 400, sanitizeTable),
    menu: canManageProducts
      ? listValue(state.menu, 1_000, sanitizeMenuItem)
      : (Array.isArray(existing.menu) ? existing.menu : []),
    orders: listValue(state.orders, 2_000, sanitizeOrder),
    serviceRequests: listValue(state.serviceRequests, 1_000, sanitizeServiceRequest),
    payments: listValue(state.payments, 2_000, sanitizePayment),
    auditEvents: listValue(state.auditEvents, 300, sanitizeAuditEvent),
  }

  return sanitized
}

function conflictError(message = 'Estado alterado por outro dispositivo. Recarregue e tente novamente.') {
  const error = securityError(message, 409)
  error.code = 'STATE_VERSION_CONFLICT'
  return error
}

async function saveAppState(restaurantId, state, session, expectedVersion) {
  const payload = JSON.stringify(await sanitizeAppState(state, restaurantId, session))
  if (Buffer.byteLength(payload, 'utf8') > maxStateBytes) {
    throw securityError('Estado operacional excede o limite permitido', 413)
  }

  const record = await db.get('SELECT version FROM app_states WHERE restaurant_id = $1', [restaurantId])
  const currentVersion = Number(record?.version ?? 1)
  const requestedVersion = expectedVersion === undefined ? currentVersion : Number(expectedVersion)
  if (!Number.isFinite(requestedVersion) || requestedVersion !== currentVersion) {
    throw conflictError()
  }

  const result = await db.run(
    `
      UPDATE app_states
      SET payload = $1, updated_at = $2, version = version + 1
      WHERE restaurant_id = $3 AND version = $4
    `,
    [payload, now(), restaurantId, currentVersion],
  )

  if (!result.changes) throw conflictError()
  return currentVersion + 1
}

async function saveStateRecord(restaurantId, state, expectedVersion) {
  const payload = JSON.stringify(state)
  if (Buffer.byteLength(payload, 'utf8') > maxStateBytes) {
    throw securityError('Estado operacional excede o limite permitido', 413)
  }

  const result = await db.run(
    `
      UPDATE app_states
      SET payload = $1, updated_at = $2, version = version + 1
      WHERE restaurant_id = $3 AND version = $4
    `,
    [payload, now(), restaurantId, expectedVersion],
  )

  if (!result.changes) throw conflictError()
  return expectedVersion + 1
}

async function audit(restaurantId, staffId, action, metadata = {}) {
  await db.run(
    `
      INSERT INTO audit_events (id, restaurant_id, staff_id, action, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [randomBytes(12).toString('hex'), restaurantId, staffId, action, JSON.stringify(metadata), now()],
  )
}

async function createSession(restaurantId, staffId) {
  const token = randomBytes(32).toString('base64url')
  await db.run(
    `
      INSERT INTO sessions (token_hash, restaurant_id, staff_id, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [hash(token), restaurantId, staffId, now() + sessionTtlMs, now()],
  )
  return token
}

async function createInitialAdmin(restaurantId, body) {
  if ((await getStaffCount(restaurantId)) > 0) {
    const error = new Error('Primeiro administrador ja foi criado')
    error.status = 409
    throw error
  }

  const name = String(body.name ?? '').trim()
  const pin = String(body.pin ?? '').trim()

  if (name.length < 2) {
    const error = new Error('Informe o nome do administrador')
    error.status = 400
    throw error
  }

  if (!/^\d{4,12}$/.test(pin)) {
    const error = new Error('O PIN deve ter de 4 a 12 digitos numericos')
    error.status = 400
    throw error
  }

  const adminId = `staff-${randomBytes(8).toString('hex')}`
  const hashedPin = hashPin(pin)

  await db.run(
    `
      INSERT INTO staff (id, restaurant_id, name, role, pin_salt, pin_hash, active, created_at)
      VALUES ($1, $2, $3, 'admin', $4, $5, 1, $6)
    `,
    [adminId, restaurantId, name, hashedPin.salt, hashedPin.digest, now()],
  )

  await audit(restaurantId, adminId, 'setup.initial_admin')
  return adminId
}

async function getSession(token) {
  if (!token) return null
  const row = await db.get(
    `
      SELECT
        sessions.*,
        staff.name,
        staff.role,
        restaurants.name AS restaurant_name,
        restaurants.slug
      FROM sessions
      JOIN staff ON staff.id = sessions.staff_id
      JOIN restaurants ON restaurants.id = sessions.restaurant_id
      WHERE token_hash = $1
    `,
    [hash(token)],
  )

  if (!row || row.expires_at < now()) {
    if (row) await db.run('DELETE FROM sessions WHERE token_hash = $1', [hash(token)])
    return null
  }

  return {
    token,
    restaurantId: row.restaurant_id,
    user: { id: row.staff_id, name: row.name, role: row.role },
    restaurant: { id: row.restaurant_id, name: row.restaurant_name, slug: row.slug },
  }
}

async function requireAction(session, action, fallbackRoles = []) {
  if (fallbackRoles.includes(session.user.role)) return

  const state = await persistedState(session.restaurantId)
  if (stateProfileHasAction(state, session.user.role, action)) return

  const error = new Error('Acesso negado para esta acao')
  error.status = 403
  throw error
}

function stateProfileHasView(state, role, view, fallbackRoles = []) {
  if (fallbackRoles.includes(role)) return true
  const profile = Array.isArray(state.accessProfiles)
    ? state.accessProfiles.find((item) => item.id === role)
    : null
  return Boolean(profile?.permissions?.includes(view))
}

async function requireView(session, view, fallbackRoles = ['admin']) {
  if (fallbackRoles.includes(session.user.role)) return

  const state = await persistedState(session.restaurantId)
  if (stateProfileHasView(state, session.user.role, view)) return

  const error = new Error('Acesso negado para esta tela')
  error.status = 403
  throw error
}

function stateAuditEvent(session, action, label, metadata = {}) {
  return {
    id: `audit-${randomBytes(8).toString('hex')}`,
    action,
    label,
    actorId: session.user.id,
    actorName: session.user.name,
    tableId: typeof metadata.tableId === 'string' ? metadata.tableId : undefined,
    orderId: typeof metadata.orderId === 'string' ? metadata.orderId : undefined,
    createdAt: now(),
    metadata,
  }
}

function appendStateAudit(state, event) {
  return {
    ...state,
    auditEvents: [event, ...(Array.isArray(state.auditEvents) ? state.auditEvents : [])].slice(0, 300),
  }
}

function tableOrdersFromState(state, tableId, { includeCancelled = false } = {}) {
  return (Array.isArray(state.orders) ? state.orders : []).filter(
    (order) => order.tableId === tableId && (includeCancelled || order.status !== 'cancelled'),
  )
}

function orderSubtotalFromState(orders) {
  return orders.reduce((total, order) => total + Number(order.quantity || 0) * Number(order.unitPrice || 0), 0)
}

function tableTotalFromState(state, tableId) {
  const subtotalValue = orderSubtotalFromState(tableOrdersFromState(state, tableId))
  return subtotalValue + subtotalValue * 0.1
}

function tablePaidFromState(state, tableId) {
  return (Array.isArray(state.payments) ? state.payments : [])
    .filter((payment) => payment.tableId === tableId)
    .reduce((total, payment) => total + Number(payment.amount || 0), 0)
}

function remainingForTable(state, tableId) {
  return Math.max(0, tableTotalFromState(state, tableId) - tablePaidFromState(state, tableId))
}

function updateTableAfterOrders(state, tableId) {
  const activeOrders = tableOrdersFromState(state, tableId)
  const allServed = activeOrders.length > 0 && activeOrders.every((order) => order.status === 'served')
  const anyReady = activeOrders.some((order) => order.status === 'ready')
  const anyPreparing = activeOrders.some((order) => ['sent', 'preparing'].includes(order.status))
  const anyDraft = activeOrders.some((order) => order.status === 'draft')
  const nextStatus = allServed
    ? 'served'
    : anyReady
      ? 'attention'
      : anyPreparing
        ? 'preparing'
        : anyDraft
          ? 'ordering'
          : undefined

  if (!nextStatus) return state

  return {
    ...state,
    tables: state.tables.map((table) =>
      table.id === tableId ? { ...table, status: nextStatus, lastActivityAt: now() } : table,
    ),
  }
}

function ensureProfileExists(state, role) {
  const profiles = Array.isArray(state.accessProfiles) ? state.accessProfiles : []
  if (!profiles.some((profile) => profile.id === role)) {
    throw securityError('Tipo de acesso nao encontrado', 400)
  }
}

function normalizePin(pin) {
  const value = String(pin ?? '').trim()
  if (!/^\d{4,12}$/.test(value)) {
    throw securityError('O PIN deve ter de 4 a 12 digitos numericos', 400)
  }
  return value
}

function operationError(message, status = 400) {
  return securityError(message, status)
}

async function recordStateEvent(session, type, payload, baseVersion, resultingVersion) {
  await db.run(
    `
      INSERT INTO state_events (id, restaurant_id, staff_id, type, payload, base_version, resulting_version, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      randomBytes(12).toString('hex'),
      session.restaurantId,
      session.user.id,
      type,
      JSON.stringify(payload ?? {}),
      baseVersion,
      resultingVersion,
      now(),
    ],
  )
}

async function applyStateOperation(session, type, payload = {}) {
  let integrationDispatch = null
  let fiscalDispatch = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { state: rawState, version } = await persistedStateRecord(session.restaurantId)
    let state = {
      ...rawState,
      staff: await getStaffForRestaurant(session.restaurantId),
    }
    const baseVersion = version
    let event

    if (type === 'table.create') {
      await requireAction(session, 'manageTables', ['admin', 'manager'])
      const table = sanitizeTable(payload.table ?? payload)
      if (!table) throw operationError('Mesa invalida')
      if (state.tables.some((item) => item.id === table.id || item.number === table.number)) {
        throw operationError('Ja existe uma mesa com este numero')
      }
      state = { ...state, tables: [...state.tables, { ...table, status: 'free', lastActivityAt: now() }] }
      event = stateAuditEvent(session, 'table.create', `Mesa ${table.number} cadastrada`, {
        tableId: table.id,
        tableNumber: table.number,
        zone: table.zone,
      })
    } else if (type === 'table.open') {
      await requireView(session, 'floor')
      const tableId = stringValue(payload.tableId, 80)
      const guests = Math.floor(numberValue(payload.guests, 2, 1, 999))
      const table = state.tables.find((item) => item.id === tableId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      state = {
        ...state,
        tables: state.tables.map((item) =>
          item.id === tableId
            ? {
                ...item,
                status: item.status === 'free' ? 'seated' : item.status,
                guestCount: item.guestCount || guests,
                serverId: session.user.id,
                openedAt: item.openedAt ?? now(),
                lastActivityAt: now(),
              }
            : item,
        ),
      }
      event = stateAuditEvent(session, 'table.open', `Mesa ${table.number} aberta`, { tableId })
    } else if (type === 'table.guests') {
      await requireView(session, 'order')
      const tableId = stringValue(payload.tableId, 80)
      const guestCount = Math.floor(numberValue(payload.guestCount, 1, 1, 999))
      if (!state.tables.some((item) => item.id === tableId)) throw operationError('Mesa nao encontrada', 404)
      state = {
        ...state,
        tables: state.tables.map((table) =>
          table.id === tableId ? { ...table, guestCount, lastActivityAt: now() } : table,
        ),
      }
      event = stateAuditEvent(session, 'table.guests', 'Quantidade de pessoas atualizada', { tableId, guestCount })
    } else if (type === 'table.checkout') {
      await requireView(session, 'checkout')
      const tableId = stringValue(payload.tableId, 80)
      const table = state.tables.find((item) => item.id === tableId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      state = {
        ...state,
        tables: state.tables.map((item) =>
          item.id === tableId ? { ...item, status: 'checkout', lastActivityAt: now() } : item,
        ),
      }
      event = stateAuditEvent(session, 'table.checkout', `Mesa ${table.number} enviada para conta`, { tableId })
    } else if (type === 'table.sendToKitchen') {
      await requireView(session, 'order')
      const tableId = stringValue(payload.tableId, 80)
      const table = state.tables.find((item) => item.id === tableId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      const pending = state.orders.filter((order) => order.tableId === tableId && order.status === 'draft')
      if (pending.length === 0) throw operationError('Nao ha itens pendentes para enviar')
      const sentAt = now()
      state = {
        ...state,
        tables: state.tables.map((item) =>
          item.id === tableId ? { ...item, status: 'preparing', lastActivityAt: sentAt } : item,
        ),
        orders: state.orders.map((order) =>
          order.tableId === tableId && order.status === 'draft'
            ? { ...order, status: 'sent', sentAt }
            : order,
        ),
      }
      event = stateAuditEvent(session, 'order.send_kitchen', `Pedido enviado para cozinha na mesa ${table.number}`, {
        tableId,
        items: pending.length,
      })
      integrationDispatch = { table, orders: pending.map((order) => ({ ...order, status: 'sent', sentAt })) }
    } else if (type === 'table.close') {
      await requireAction(session, 'closeTables', ['admin', 'manager'])
      const tableId = stringValue(payload.tableId, 80)
      const table = state.tables.find((item) => item.id === tableId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      const orders = tableOrdersFromState(state, tableId)
      if (orders.length === 0) throw operationError('Mesa sem pedidos para fechar')
      const remaining = remainingForTable(state, tableId)
      if (remaining > 0.01) throw operationError('Mesa ainda possui saldo em aberto', 409)
      const closedOrders = tableOrdersFromState(state, tableId, { includeCancelled: true })
      const closedPayments = state.payments.filter((payment) => payment.tableId === tableId)
      state = {
        ...state,
        tables: state.tables.map((item) =>
          item.id === tableId
            ? {
                ...item,
                status: 'free',
                guestCount: 0,
                serverId: undefined,
                openedAt: undefined,
                lastActivityAt: now(),
              }
            : item,
        ),
        orders: state.orders.filter((order) => order.tableId !== tableId),
        payments: state.payments.filter((payment) => payment.tableId !== tableId),
        serviceRequests: state.serviceRequests.map((request) =>
          request.tableId === tableId ? { ...request, resolved: true } : request,
        ),
      }
      event = stateAuditEvent(session, 'table.close', `Mesa ${table.number} liberada`, { tableId })
      fiscalDispatch = { table, orders: closedOrders, payments: closedPayments }
    } else if (type === 'order.create') {
      await requireView(session, 'order')
      const tableId = stringValue(payload.tableId, 80)
      const menuItemId = stringValue(payload.menuItemId, 80)
      const table = state.tables.find((item) => item.id === tableId)
      const item = state.menu.find((menuItem) => menuItem.id === menuItemId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      if (!item || !item.available) throw operationError('Produto indisponivel', 409)
      const order = sanitizeOrder({
        id: stringValue(payload.id, 80) || `order-${randomBytes(8).toString('hex')}`,
        tableId,
        menuItemId: item.id,
        name: item.name,
        category: item.category,
        station: item.station,
        quantity: Math.floor(numberValue(payload.quantity, 1, 1, 999)),
        unitPrice: item.price,
        seat: stringValue(payload.seat || 'Mesa', 80),
        notes: stringValue(payload.notes, 700),
        modifiers: Array.isArray(payload.modifiers)
          ? payload.modifiers
          : item.modifierGroups?.map((group) => `${group.name}: ${group.options[0]}`) ?? [],
        status: 'draft',
        createdAt: now(),
      })
      state = {
        ...state,
        tables: state.tables.map((tableItem) =>
          tableItem.id === tableId
            ? {
                ...tableItem,
                status: 'ordering',
                guestCount: tableItem.guestCount || 1,
                serverId: session.user.id,
                openedAt: tableItem.openedAt ?? now(),
                lastActivityAt: now(),
              }
            : tableItem,
        ),
        orders: [...state.orders, order],
      }
      event = stateAuditEvent(session, 'order.add_item', `${item.name} adicionado a mesa ${table.number}`, {
        tableId,
        orderId: order.id,
        menuItemId: item.id,
        itemName: item.name,
      })
    } else if (type === 'order.quantity') {
      await requireView(session, 'order')
      const orderId = stringValue(payload.orderId, 80)
      const quantity = Math.floor(numberValue(payload.quantity, 0, 0, 999))
      const order = state.orders.find((item) => item.id === orderId)
      if (!order) throw operationError('Pedido nao encontrado', 404)
      if (order.status !== 'draft') throw operationError('Quantidade so pode ser alterada em item nao enviado', 409)
      state = {
        ...state,
        orders: quantity > 0
          ? state.orders.map((item) => (item.id === orderId ? { ...item, quantity } : item))
          : state.orders.filter((item) => item.id !== orderId),
      }
      event = stateAuditEvent(session, 'order.quantity', `${order.name} atualizado`, {
        tableId: order.tableId,
        orderId,
        quantity,
      })
    } else if (type === 'order.notes') {
      await requireView(session, 'order')
      const orderId = stringValue(payload.orderId, 80)
      const order = state.orders.find((item) => item.id === orderId)
      if (!order) throw operationError('Pedido nao encontrado', 404)
      if (order.status !== 'draft') throw operationError('Observacao so pode ser alterada em item nao enviado', 409)
      const notes = stringValue(payload.notes, 700)
      state = { ...state, orders: state.orders.map((item) => (item.id === orderId ? { ...item, notes } : item)) }
      event = stateAuditEvent(session, 'order.notes', `${order.name} atualizado`, { tableId: order.tableId, orderId })
    } else if (type === 'order.status') {
      await requireAction(session, 'updateKitchenStatus', ['admin', 'manager'])
      const orderId = stringValue(payload.orderId, 80)
      const status = enumValue(payload.status, allowedOrderStatus, '')
      if (!['preparing', 'ready', 'served'].includes(status)) throw operationError('Status invalido')
      const order = state.orders.find((item) => item.id === orderId)
      if (!order) throw operationError('Pedido nao encontrado', 404)
      const timestampPatch =
        status === 'ready'
          ? { readyAt: now() }
          : status === 'served'
            ? { servedAt: now() }
            : {}
      state = {
        ...state,
        orders: state.orders.map((item) =>
          item.id === orderId ? { ...item, ...timestampPatch, status } : item,
        ),
      }
      state = updateTableAfterOrders(state, order.tableId)
      event = stateAuditEvent(session, 'order.status', `${order.name} alterado para ${status}`, {
        tableId: order.tableId,
        orderId,
        status,
      })
    } else if (type === 'order.cancel') {
      await requireAction(session, 'cancelOrders', ['admin', 'manager'])
      const orderId = stringValue(payload.orderId, 80)
      const reason = stringValue(payload.reason, 300)
      if (!reason) throw operationError('Informe o motivo do cancelamento')
      const order = state.orders.find((item) => item.id === orderId)
      if (!order) throw operationError('Pedido nao encontrado', 404)
      if (['served', 'cancelled'].includes(order.status)) throw operationError('Pedido nao pode ser cancelado', 409)
      state = {
        ...state,
        orders: state.orders.map((item) =>
          item.id === orderId
            ? {
                ...item,
                status: 'cancelled',
                cancelledAt: now(),
                cancelledBy: session.user.id,
                cancelReason: reason,
              }
            : item,
        ),
      }
      state = updateTableAfterOrders(state, order.tableId)
      event = stateAuditEvent(session, 'order.cancel', `${order.name} cancelado`, {
        tableId: order.tableId,
        orderId,
        reason,
      })
    } else if (type === 'request.create') {
      await requireView(session, 'order')
      const tableId = stringValue(payload.tableId, 80)
      if (!state.tables.some((table) => table.id === tableId)) throw operationError('Mesa nao encontrada', 404)
      const request = sanitizeServiceRequest({
        id: stringValue(payload.id, 80) || `request-${randomBytes(8).toString('hex')}`,
        tableId,
        label: stringValue(payload.label, 160) || 'Cliente pediu atendimento',
        priority: enumValue(payload.priority, ['normal', 'high'], 'normal'),
        resolved: false,
        createdAt: now(),
      })
      state = {
        ...state,
        tables: state.tables.map((table) =>
          table.id === tableId ? { ...table, status: 'attention', lastActivityAt: now() } : table,
        ),
        serviceRequests: [...state.serviceRequests, request],
      }
      event = stateAuditEvent(session, 'request.create', request.label, { tableId, requestId: request.id })
    } else if (type === 'request.resolve') {
      await requireView(session, 'floor')
      const requestId = stringValue(payload.requestId, 80)
      const request = state.serviceRequests.find((item) => item.id === requestId)
      if (!request) throw operationError('Chamado nao encontrado', 404)
      state = {
        ...state,
        serviceRequests: state.serviceRequests.map((item) =>
          item.id === requestId ? { ...item, resolved: true } : item,
        ),
      }
      event = stateAuditEvent(session, 'request.resolve', 'Chamado resolvido', {
        tableId: request.tableId,
        requestId,
      })
    } else if (type === 'payment.create') {
      await requireAction(session, 'registerPayments', ['admin', 'manager'])
      const tableId = stringValue(payload.tableId, 80)
      const table = state.tables.find((item) => item.id === tableId)
      if (!table) throw operationError('Mesa nao encontrada', 404)
      const requestedAmount = numberValue(payload.amount, 0, 0, 1_000_000)
      const amount = Math.min(requestedAmount, remainingForTable(state, tableId) || requestedAmount)
      if (amount <= 0) throw operationError('Pagamento invalido')
      const payment = sanitizePayment({
        id: stringValue(payload.id, 80) || `pay-${randomBytes(8).toString('hex')}`,
        tableId,
        amount,
        method: enumValue(payload.method, allowedPaymentMethods, 'pix'),
        createdAt: now(),
      })
      state = { ...state, payments: [...state.payments, payment] }
      event = stateAuditEvent(session, 'payment.add', `Pagamento registrado na mesa ${table.number}`, {
        tableId,
        amount: payment.amount,
        method: payment.method,
      })
    } else if (type === 'menu.create') {
      await requireAction(session, 'manageProducts', ['admin', 'manager'])
      const item = sanitizeMenuItem(payload.item ?? payload)
      if (!item) throw operationError('Produto invalido')
      if (state.menu.some((menuItem) => menuItem.id === item.id)) throw operationError('Produto ja existe')
      state = { ...state, menu: [...state.menu, item] }
      event = stateAuditEvent(session, 'menu.create', `${item.name} cadastrado no cardapio`, {
        menuItemId: item.id,
        itemName: item.name,
        price: item.price,
      })
    } else if (type === 'menu.update') {
      await requireAction(session, 'manageProducts', ['admin', 'manager'])
      const itemId = stringValue(payload.itemId, 80)
      const existing = state.menu.find((item) => item.id === itemId)
      if (!existing) throw operationError('Produto nao encontrado', 404)
      const item = sanitizeMenuItem({ ...payload.item, id: itemId })
      if (!item) throw operationError('Produto invalido')
      state = {
        ...state,
        menu: state.menu.map((menuItem) =>
          menuItem.id === itemId
            ? { ...item, pairingIds: existing.pairingIds ?? [], modifierGroups: existing.modifierGroups ?? [] }
            : menuItem,
        ),
      }
      event = stateAuditEvent(session, 'menu.update', `${item.name} atualizado no cardapio`, {
        menuItemId: item.id,
        itemName: item.name,
        price: item.price,
      })
    } else if (type === 'menu.availability') {
      await requireAction(session, 'manageProducts', ['admin', 'manager'])
      const itemId = stringValue(payload.itemId, 80)
      const item = state.menu.find((menuItem) => menuItem.id === itemId)
      if (!item) throw operationError('Produto nao encontrado', 404)
      const available = payload.available === undefined ? !item.available : Boolean(payload.available)
      state = {
        ...state,
        menu: state.menu.map((menuItem) => (menuItem.id === itemId ? { ...menuItem, available } : menuItem)),
      }
      event = stateAuditEvent(session, 'menu.availability', `${item.name} alterado no cardapio`, {
        menuItemId: itemId,
        itemName: item.name,
        available,
      })
    } else if (type === 'access.create') {
      await requireAction(session, 'manageAccessProfiles', ['admin'])
      const profile = sanitizeAccessProfile(payload.profile ?? payload)
      if (!profile) throw operationError('Tipo de acesso invalido')
      if (state.accessProfiles.some((item) => item.id === profile.id || item.name.toLowerCase() === profile.name.toLowerCase())) {
        throw operationError('Tipo de acesso ja existe')
      }
      state = { ...state, accessProfiles: [...state.accessProfiles, { ...profile, system: false }] }
      event = stateAuditEvent(session, 'access.create', `Tipo de acesso ${profile.name} criado`, {
        profileId: profile.id,
        profileName: profile.name,
      })
    } else if (type === 'access.update') {
      await requireAction(session, 'manageAccessProfiles', ['admin'])
      const profileId = stringValue(payload.profileId, 80)
      const existing = state.accessProfiles.find((profile) => profile.id === profileId)
      if (!existing) throw operationError('Tipo de acesso nao encontrado', 404)
      if (existing.system) throw operationError('Perfis padrao nao podem ser editados', 409)
      const profile = sanitizeAccessProfile({ ...payload.profile, id: profileId, system: false })
      if (!profile) throw operationError('Tipo de acesso invalido')
      state = {
        ...state,
        accessProfiles: state.accessProfiles.map((item) => (item.id === profileId ? profile : item)),
      }
      event = stateAuditEvent(session, 'access.update', `Tipo de acesso ${profile.name} atualizado`, {
        profileId,
        profileName: profile.name,
      })
    } else if (type === 'access.delete') {
      await requireAction(session, 'manageAccessProfiles', ['admin'])
      const profileId = stringValue(payload.profileId, 80)
      const profile = state.accessProfiles.find((item) => item.id === profileId)
      if (!profile) throw operationError('Tipo de acesso nao encontrado', 404)
      if (profile.system) throw operationError('Perfis padrao nao podem ser excluidos', 409)
      if (state.staff.some((member) => member.role === profileId)) throw operationError('Tipo de acesso esta em uso', 409)
      state = { ...state, accessProfiles: state.accessProfiles.filter((item) => item.id !== profileId) }
      event = stateAuditEvent(session, 'access.delete', `Tipo de acesso ${profile.name} excluido`, {
        profileId,
        profileName: profile.name,
      })
    } else {
      throw operationError('Operacao desconhecida', 404)
    }

    if (event) state = appendStateAudit(state, event)
    const sanitized = await sanitizeAppState(state, session.restaurantId, session)

    try {
      const nextVersion = await saveStateRecord(session.restaurantId, sanitized, baseVersion)
      await audit(session.restaurantId, session.user.id, type, event?.metadata ?? {})
      await recordStateEvent(session, type, payload, baseVersion, nextVersion)

      if (integrationDispatch) {
        void dispatchKitchenIntegrations(session, integrationDispatch.table, integrationDispatch.orders).catch((error) =>
          log('error', 'integration_dispatch_failed', { error: error.message, type }),
        )
      }
      if (fiscalDispatch) {
        void dispatchFiscalDocument(session, fiscalDispatch).catch((error) =>
          log('error', 'fiscal_dispatch_failed', { error: error.message, type }),
        )
      }

      return getAppState(session.restaurantId, session.user.id)
    } catch (error) {
      if (error.code === 'STATE_VERSION_CONFLICT' && attempt < 2) continue
      throw error
    }
  }

  throw conflictError()
}

async function getIntegrations(restaurantId) {
  const row = await db.get('SELECT * FROM integration_settings WHERE restaurant_id = $1', [
    restaurantId,
  ])
  return {
    printerEndpoint: row?.printer_endpoint ?? '',
    paymentsProvider: row?.payments_provider ?? 'manual',
    paymentsPublicKey: row?.payments_public_key ?? '',
    kdsWebhook: row?.kds_webhook ?? '',
    enablePrinter: Boolean(row?.enable_printer),
    enablePayments: Boolean(row?.enable_payments),
    enableKdsWebhook: Boolean(row?.enable_kds_webhook),
    updatedAt: row?.updated_at ?? now(),
  }
}

async function saveIntegrations(restaurantId, settings) {
  const clean = {
    printerEndpoint: stringValue(settings.printerEndpoint, 500),
    paymentsProvider: stringValue(settings.paymentsProvider || 'manual', 80),
    paymentsPublicKey: stringValue(settings.paymentsPublicKey, 500),
    kdsWebhook: stringValue(settings.kdsWebhook, 500),
    enablePrinter: Boolean(settings.enablePrinter),
    enablePayments: Boolean(settings.enablePayments),
    enableKdsWebhook: Boolean(settings.enableKdsWebhook),
  }

  validateIntegrationUrl(clean.printerEndpoint, 'Endpoint da impressora')
  validateIntegrationUrl(clean.kdsWebhook, 'Webhook da cozinha')

  await db.run(
    `
      INSERT INTO integration_settings (
        restaurant_id,
        printer_endpoint,
        payments_provider,
        payments_public_key,
        kds_webhook,
        enable_printer,
        enable_payments,
        enable_kds_webhook,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT(restaurant_id) DO UPDATE SET
        printer_endpoint = EXCLUDED.printer_endpoint,
        payments_provider = EXCLUDED.payments_provider,
        payments_public_key = EXCLUDED.payments_public_key,
        kds_webhook = EXCLUDED.kds_webhook,
        enable_printer = EXCLUDED.enable_printer,
        enable_payments = EXCLUDED.enable_payments,
        enable_kds_webhook = EXCLUDED.enable_kds_webhook,
        updated_at = EXCLUDED.updated_at
    `,
    [
      restaurantId,
      clean.printerEndpoint,
      clean.paymentsProvider,
      clean.paymentsPublicKey,
      clean.kdsWebhook,
      Number(clean.enablePrinter),
      Number(clean.enablePayments),
      Number(clean.enableKdsWebhook),
      now(),
    ],
  )

  return getIntegrations(restaurantId)
}

async function getFiscalSettings(restaurantId) {
  const row = await db.get('SELECT * FROM fiscal_settings WHERE restaurant_id = $1', [restaurantId])
  return {
    provider: row?.provider ?? 'manual',
    providerEndpoint: row?.provider_endpoint ?? '',
    stateCode: row?.state_code ?? '',
    cityCode: row?.city_code ?? '',
    enableFiscal: Boolean(row?.enable_fiscal),
    updatedAt: row?.updated_at ?? now(),
  }
}

async function saveFiscalSettings(restaurantId, settings) {
  const clean = {
    provider: stringValue(settings.provider || 'manual', 80),
    providerEndpoint: stringValue(settings.providerEndpoint, 500),
    stateCode: stringValue(settings.stateCode, 2).toUpperCase(),
    cityCode: stringValue(settings.cityCode, 20),
    enableFiscal: Boolean(settings.enableFiscal),
  }

  if (clean.providerEndpoint) validateIntegrationUrl(clean.providerEndpoint, 'Endpoint fiscal')
  if (clean.enableFiscal && !clean.providerEndpoint) {
    throw securityError('Informe o endpoint fiscal para emissao externa', 400)
  }

  await db.run(
    `
      INSERT INTO fiscal_settings (
        restaurant_id,
        provider,
        provider_endpoint,
        state_code,
        city_code,
        enable_fiscal,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(restaurant_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        provider_endpoint = EXCLUDED.provider_endpoint,
        state_code = EXCLUDED.state_code,
        city_code = EXCLUDED.city_code,
        enable_fiscal = EXCLUDED.enable_fiscal,
        updated_at = EXCLUDED.updated_at
    `,
    [
      restaurantId,
      clean.provider,
      clean.providerEndpoint,
      clean.stateCode,
      clean.cityCode,
      Number(clean.enableFiscal),
      now(),
    ],
  )

  return getFiscalSettings(restaurantId)
}

async function createStaffMember(session, body) {
  await requireAction(session, 'manageAccessProfiles', ['admin'])
  const state = await persistedState(session.restaurantId)
  const name = stringValue(body.name, 120)
  const role = stringValue(body.role, 80)
  const pin = normalizePin(body.pin)
  if (name.length < 2) throw securityError('Informe o nome do operador', 400)
  ensureProfileExists(state, role)

  const id = `staff-${randomBytes(8).toString('hex')}`
  const hashedPin = hashPin(pin)
  await db.run(
    `
      INSERT INTO staff (id, restaurant_id, name, role, pin_salt, pin_hash, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
    `,
    [id, session.restaurantId, name, role, hashedPin.salt, hashedPin.digest, now()],
  )
  await audit(session.restaurantId, session.user.id, 'staff.create', { staffId: id, role })
  return getAppState(session.restaurantId, session.user.id)
}

async function updateStaffMember(session, staffId, body) {
  await requireAction(session, 'manageAccessProfiles', ['admin'])
  const state = await persistedState(session.restaurantId)
  const existing = await db.get('SELECT * FROM staff WHERE id = $1 AND restaurant_id = $2', [
    staffId,
    session.restaurantId,
  ])
  if (!existing) throw securityError('Operador nao encontrado', 404)

  const name = body.name === undefined ? existing.name : stringValue(body.name, 120)
  const role = body.role === undefined ? existing.role : stringValue(body.role, 80)
  const active = body.active === undefined ? Boolean(existing.active) : Boolean(body.active)
  if (name.length < 2) throw securityError('Informe o nome do operador', 400)
  ensureProfileExists(state, role)
  if (staffId === session.user.id && !active) throw securityError('Nao desative o proprio operador', 409)
  if (existing.role === 'admin' && role !== 'admin' && (await getActiveAdminCount(session.restaurantId)) <= 1) {
    throw securityError('Mantenha pelo menos um administrador ativo', 409)
  }
  if (existing.role === 'admin' && !active && (await getActiveAdminCount(session.restaurantId)) <= 1) {
    throw securityError('Mantenha pelo menos um administrador ativo', 409)
  }

  await db.run(
    'UPDATE staff SET name = $1, role = $2, active = $3 WHERE id = $4 AND restaurant_id = $5',
    [name, role, Number(active), staffId, session.restaurantId],
  )
  if (!active) await db.run('DELETE FROM sessions WHERE staff_id = $1 AND restaurant_id = $2', [staffId, session.restaurantId])
  await audit(session.restaurantId, session.user.id, 'staff.update', { staffId, role, active })
  return getAppState(session.restaurantId, session.user.id)
}

async function resetStaffPin(session, staffId, body) {
  await requireAction(session, 'manageAccessProfiles', ['admin'])
  const pin = normalizePin(body.pin)
  const existing = await db.get('SELECT * FROM staff WHERE id = $1 AND restaurant_id = $2', [
    staffId,
    session.restaurantId,
  ])
  if (!existing) throw securityError('Operador nao encontrado', 404)
  const hashedPin = hashPin(pin)
  await db.run(
    'UPDATE staff SET pin_salt = $1, pin_hash = $2 WHERE id = $3 AND restaurant_id = $4',
    [hashedPin.salt, hashedPin.digest, staffId, session.restaurantId],
  )
  await db.run('DELETE FROM sessions WHERE staff_id = $1 AND restaurant_id = $2', [staffId, session.restaurantId])
  await audit(session.restaurantId, session.user.id, 'staff.pin_reset', { staffId })
  return getAppState(session.restaurantId, session.user.id)
}

function subtotal(orders) {
  return orders.reduce((total, order) => total + order.quantity * order.unitPrice, 0)
}

function minutesSince(timestamp) {
  return timestamp ? Math.max(0, Math.floor((now() - timestamp) / 60_000)) : 0
}

function buildReport(state) {
  const activeTables = state.tables.filter((table) => table.status !== 'free')
  const revenue = state.tables.reduce(
    (total, table) => total + subtotal(state.orders.filter((order) => order.tableId === table.id)),
    0,
  )
  const payments = state.payments.reduce((total, payment) => total + payment.amount, 0)
  const delayedOrders = state.orders.filter(
    (order) => ['sent', 'preparing'].includes(order.status) && minutesSince(order.sentAt ?? order.createdAt) > 20,
  )
  const topItems = Array.from(new Set(state.orders.map((order) => order.menuItemId)))
    .map((id) => {
      const itemOrders = state.orders.filter((order) => order.menuItemId === id)
      return {
        id,
        name: itemOrders[0]?.name ?? 'Item',
        quantity: itemOrders.reduce((total, order) => total + order.quantity, 0),
        revenue: itemOrders.reduce((total, order) => total + order.quantity * order.unitPrice, 0),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)

  return {
    generatedAt: now(),
    activeTables: activeTables.length,
    revenue,
    payments,
    avgTicket: activeTables.length ? revenue / activeTables.length : 0,
    readyOrders: state.orders.filter((order) => order.status === 'ready').length,
    delayedOrders: delayedOrders.length,
    openRequests: state.serviceRequests.filter((request) => !request.resolved).length,
    topItems,
    paymentsByMethod: state.payments.reduce((methods, payment) => {
      methods[payment.method] = (methods[payment.method] ?? 0) + payment.amount
      return methods
    }, {}),
  }
}

function validateIntegrationUrl(value, label) {
  if (!value) return

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw securityError(`${label} invalido`, 400)
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw securityError(`${label} deve usar HTTP ou HTTPS`, 400)
  }

  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:' && !allowPrivateIntegrationEndpoints) {
    throw securityError(`${label} deve usar HTTPS em producao`, 400)
  }

  if (parsed.username || parsed.password) {
    throw securityError(`${label} nao deve conter credenciais na URL`, 400)
  }
}

function isPrivateIp(address) {
  if (!address) return true
  if (address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false

  const [a, b] = address.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

async function assertSafeIntegrationTarget(value) {
  if (!value || allowPrivateIntegrationEndpoints) return
  const parsed = new URL(value)
  const records = await lookup(parsed.hostname, { all: true, verbatim: true })
  if (records.some((record) => isPrivateIp(record.address))) {
    throw securityError('Destino de integracao bloqueado por seguranca', 400)
  }
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase()
    if (!contentType.includes('application/json')) {
      rejectBody(Object.assign(new Error('Content-Type deve ser application/json'), { status: 415 }))
      return
    }

    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (Buffer.byteLength(data, 'utf8') > maxBodyBytes) {
        rejectBody(Object.assign(new Error('Payload muito grande'), { status: 413 }))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data) {
        resolveBody({})
        return
      }

      try {
        resolveBody(JSON.parse(data))
      } catch {
        rejectBody(Object.assign(new Error('JSON invalido'), { status: 400 }))
      }
    })
  })
}

function send(res, status, payload) {
  if (status === 429 && payload?.retryAfter) {
    res.setHeader('Retry-After', String(payload.retryAfter))
  }

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

async function getAuth(req) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return getSession(token)
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (!origin) return true

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const allowDevOrigin = process.env.NODE_ENV !== 'production'

  if (allowDevOrigin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else if (req.method !== 'GET') {
    send(res, 403, { error: 'Origem nao permitida' })
    return false
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '600')
  return true
}

function applySecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "img-src 'self' data: https://images.unsplash.com",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' http://127.0.0.1:8787 http://localhost:8787",
      "worker-src 'self'",
      "manifest-src 'self'",
      "form-action 'self'",
    ].join('; '),
  )

  if (process.env.FORCE_HTTPS === 'true' && req.headers['x-forwarded-proto'] !== 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

function hostAllowed(req) {
  if (process.env.NODE_ENV !== 'production' || allowedHosts.length === 0) return true
  const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase()
  return allowedHosts.includes(requestHost)
}

function loopbackRequest(req) {
  const address = req.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function metricsAllowed(req) {
  if (metricsPublic || process.env.NODE_ENV !== 'production') return true
  const header = req.headers.authorization ?? ''
  if (metricsToken && header === `Bearer ${metricsToken}`) return true
  return !metricsToken && loopbackRequest(req)
}

async function testEndpoint(url, payload) {
  if (!url) return { ok: false, configured: false, message: 'Endpoint nao configurado' }

  validateIntegrationUrl(url, 'Endpoint de integracao')
  await assertSafeIntegrationTarget(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      configured: true,
      status: response.status,
      message: response.ok ? 'Integracao respondeu com sucesso' : 'Integracao respondeu com erro',
    }
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error.name === 'AbortError' ? 'Tempo esgotado' : error.message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function postIntegrationPayload(url, payload) {
  validateIntegrationUrl(url, 'Endpoint de integracao')
  await assertSafeIntegrationTarget(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return { ok: response.ok, status: response.status }
  } finally {
    clearTimeout(timeout)
  }
}

async function dispatchKitchenIntegrations(session, table, orders) {
  const settings = await getIntegrations(session.restaurantId)
  const payload = {
    type: 'order.sent',
    restaurantId: session.restaurantId,
    table: { id: table.id, number: table.number, zone: table.zone },
    orders,
    sentBy: session.user,
    createdAt: now(),
  }
  const results = []

  if (settings.enablePrinter && settings.printerEndpoint) {
    results.push({ target: 'printer', ...(await postIntegrationPayload(settings.printerEndpoint, payload)) })
  }
  if (settings.enableKdsWebhook && settings.kdsWebhook) {
    results.push({ target: 'kds', ...(await postIntegrationPayload(settings.kdsWebhook, payload)) })
  }

  if (results.length > 0) {
    await audit(session.restaurantId, session.user.id, 'integrations.dispatch_order', { results })
  }
  return results
}

async function dispatchFiscalDocument(session, sale) {
  const settings = await getFiscalSettings(session.restaurantId)
  if (!settings.enableFiscal) return { ok: false, configured: false }

  const payload = {
    type: 'fiscal.nfce.issue.request',
    restaurantId: session.restaurantId,
    provider: settings.provider,
    stateCode: settings.stateCode,
    cityCode: settings.cityCode,
    table: sale.table,
    orders: sale.orders,
    payments: sale.payments,
    closedBy: session.user,
    createdAt: now(),
  }
  const result = await postIntegrationPayload(settings.providerEndpoint, payload)
  await audit(session.restaurantId, session.user.id, 'fiscal.dispatch_nfce', result)
  return result
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    requireRateLimit(`health:${clientIp(req)}`, { limit: 120, windowMs: 60_000 })
    const started = performance.now()
    await db.ping()
    send(res, 200, {
      ok: true,
      database: db.label,
      dialect: db.dialect,
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      latencyMs: Number((performance.now() - started).toFixed(2)),
      time: now(),
    })
    return
  }

  if (url.pathname === '/api/ready' && req.method === 'GET') {
    await db.ping()
    send(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/metrics' && req.method === 'GET') {
    requireRateLimit(`metrics:${clientIp(req)}`, { limit: 30, windowMs: 60_000 })
    if (!metricsAllowed(req)) {
      send(res, 403, { error: 'Metricas protegidas em producao' })
      return
    }
    send(res, 200, {
      ...metrics,
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      memory: process.memoryUsage(),
      database: { dialect: db.dialect, label: db.label },
    })
    return
  }

  if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
    requireRateLimit(`bootstrap:${clientIp(req)}`, { limit: 60, windowMs: 60_000 })
    const slug = url.searchParams.get('restaurant') || restaurant.slug
    const found = await getRestaurantBySlug(slug)
    if (!found) {
      send(res, 404, { error: 'Restaurante nao encontrado' })
      return
    }

    send(res, 200, {
      restaurant: { id: found.id, name: found.name, slug: found.slug },
      staff: await getStaffForRestaurant(found.id),
    })
    return
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    requireRateLimit(`login-ip:${clientIp(req)}`, { limit: 20, windowMs: 15 * 60_000 })
    const body = await readBody(req)
    requireRateLimit(`login-user:${clientIp(req)}:${stringValue(body.staffId, 80)}`, {
      limit: 8,
      windowMs: 15 * 60_000,
    })
    const found = await getRestaurantBySlug(body.restaurantSlug || restaurant.slug)
    if (!found) {
      send(res, 404, { error: 'Restaurante nao encontrado' })
      return
    }

    const member = await db.get(
      'SELECT * FROM staff WHERE id = $1 AND restaurant_id = $2 AND active = 1',
      [body.staffId, found.id],
    )

    if (!member || !verifyPin(body.pin, member.pin_salt, member.pin_hash)) {
      await audit(found.id, body.staffId ?? null, 'auth.failed', { staffId: body.staffId })
      send(res, 401, { error: 'Credenciais invalidas' })
      return
    }

    const token = await createSession(found.id, member.id)
    const session = await getSession(token)
    await audit(found.id, member.id, 'auth.login')
    send(res, 200, session)
    return
  }

  if (url.pathname === '/api/setup/admin' && req.method === 'POST') {
    requireRateLimit(`setup:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60_000 })
    const body = await readBody(req)
    const found = await getRestaurantBySlug(body.restaurantSlug || restaurant.slug)
    if (!found) {
      send(res, 404, { error: 'Restaurante nao encontrado' })
      return
    }

    const adminId = await createInitialAdmin(found.id, body)
    const token = await createSession(found.id, adminId)
    send(res, 201, await getSession(token))
    return
  }

  const session = await getAuth(req)
  if (!session) {
    send(res, 401, { error: 'Sessao invalida ou expirada' })
    return
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    send(res, 200, session)
    return
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    await db.run('DELETE FROM sessions WHERE token_hash = $1', [hash(session.token)])
    await audit(session.restaurantId, session.user.id, 'auth.logout')
    send(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/operations' && req.method === 'POST') {
    requireRateLimit(`operations:${session.restaurantId}:${session.user.id}`, { limit: 240, windowMs: 60_000 })
    const body = await readBody(req)
    send(res, 200, await applyStateOperation(session, body.type, body.payload ?? {}))
    return
  }

  if (url.pathname === '/api/tables' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'table.create', body))
    return
  }

  const tableRoute = url.pathname.match(/^\/api\/tables\/([^/]+)\/([^/]+)$/)
  if (tableRoute && req.method === 'POST') {
    const [, tableId, action] = tableRoute
    const body = await readBody(req)
    const tableActions = {
      open: 'table.open',
      guests: 'table.guests',
      checkout: 'table.checkout',
      'send-to-kitchen': 'table.sendToKitchen',
      close: 'table.close',
    }
    const type = tableActions[action]
    if (!type) {
      send(res, 404, { error: 'Rota nao encontrada' })
      return
    }
    send(res, 200, await applyStateOperation(session, type, { ...body, tableId }))
    return
  }

  if (url.pathname === '/api/orders' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'order.create', body))
    return
  }

  const orderRoute = url.pathname.match(/^\/api\/orders\/([^/]+)\/([^/]+)$/)
  if (orderRoute && req.method === 'POST') {
    const [, orderId, action] = orderRoute
    const body = await readBody(req)
    const orderActions = {
      quantity: 'order.quantity',
      notes: 'order.notes',
      status: 'order.status',
      cancel: 'order.cancel',
    }
    const type = orderActions[action]
    if (!type) {
      send(res, 404, { error: 'Rota nao encontrada' })
      return
    }
    send(res, 200, await applyStateOperation(session, type, { ...body, orderId }))
    return
  }

  if (url.pathname === '/api/service-requests' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'request.create', body))
    return
  }

  const requestRoute = url.pathname.match(/^\/api\/service-requests\/([^/]+)\/resolve$/)
  if (requestRoute && req.method === 'POST') {
    send(res, 200, await applyStateOperation(session, 'request.resolve', { requestId: requestRoute[1] }))
    return
  }

  if (url.pathname === '/api/payments' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'payment.create', body))
    return
  }

  if (url.pathname === '/api/menu' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'menu.create', body))
    return
  }

  const menuRoute = url.pathname.match(/^\/api\/menu\/([^/]+)\/([^/]+)$/)
  if (menuRoute && req.method === 'POST') {
    const [, itemId, action] = menuRoute
    const body = await readBody(req)
    const type = action === 'update' ? 'menu.update' : action === 'availability' ? 'menu.availability' : ''
    if (!type) {
      send(res, 404, { error: 'Rota nao encontrada' })
      return
    }
    send(res, 200, await applyStateOperation(session, type, { ...body, itemId }))
    return
  }

  if (url.pathname === '/api/access-profiles' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await applyStateOperation(session, 'access.create', body))
    return
  }

  const accessRoute = url.pathname.match(/^\/api\/access-profiles\/([^/]+)$/)
  if (accessRoute && ['POST', 'DELETE'].includes(req.method)) {
    const body = req.method === 'POST' ? await readBody(req) : {}
    send(
      res,
      200,
      await applyStateOperation(session, req.method === 'DELETE' ? 'access.delete' : 'access.update', {
        ...body,
        profileId: accessRoute[1],
      }),
    )
    return
  }

  if (url.pathname === '/api/staff' && req.method === 'GET') {
    await requireAction(session, 'manageAccessProfiles', ['admin', 'manager'])
    send(res, 200, { staff: await getStaffForRestaurant(session.restaurantId) })
    return
  }

  if (url.pathname === '/api/staff' && req.method === 'POST') {
    const body = await readBody(req)
    send(res, 201, await createStaffMember(session, body))
    return
  }

  const staffRoute = url.pathname.match(/^\/api\/staff\/([^/]+)(?:\/([^/]+))?$/)
  if (staffRoute && req.method === 'POST') {
    const [, staffId, action] = staffRoute
    const body = await readBody(req)
    if (action === 'pin') {
      send(res, 200, await resetStaffPin(session, staffId, body))
      return
    }
    send(res, 200, await updateStaffMember(session, staffId, body))
    return
  }

  if (staffRoute && req.method === 'DELETE') {
    send(res, 200, await updateStaffMember(session, staffRoute[1], { active: false }))
    return
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    send(res, 200, await getAppState(session.restaurantId, session.user.id))
    return
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    requireRateLimit(`state-put:${session.restaurantId}:${session.user.id}`, { limit: 180, windowMs: 60_000 })
    await requireAction(session, 'resetOperationalData', ['admin'])
    const body = await readBody(req)
    const nextVersion = await saveAppState(session.restaurantId, body.state ?? body, session, body.expectedVersion)
    await audit(session.restaurantId, session.user.id, 'state.legacy_replace')
    send(res, 200, { ok: true, updatedAt: now(), version: nextVersion })
    return
  }

  if (url.pathname === '/api/reports/summary' && req.method === 'GET') {
    await requireAction(session, 'viewReports', ['admin', 'manager'])
    send(res, 200, buildReport(await getAppState(session.restaurantId, session.user.id)))
    return
  }

  if (url.pathname === '/api/integrations' && req.method === 'GET') {
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    send(res, 200, await getIntegrations(session.restaurantId))
    return
  }

  if (url.pathname === '/api/integrations' && req.method === 'PUT') {
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    const body = await readBody(req)
    const settings = await saveIntegrations(session.restaurantId, body.settings ?? body)
    await audit(session.restaurantId, session.user.id, 'integrations.update')
    send(res, 200, settings)
    return
  }

  if (url.pathname === '/api/integrations/test' && req.method === 'POST') {
    requireRateLimit(`integrations-test:${session.restaurantId}:${session.user.id}`, {
      limit: 20,
      windowMs: 60_000,
    })
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    const body = await readBody(req)
    const settings = await getIntegrations(session.restaurantId)
    const payload = {
      restaurantId: session.restaurantId,
      requestedBy: session.user.id,
      type: body.type,
      createdAt: now(),
    }
    const endpoint =
      body.type === 'printer'
        ? settings.printerEndpoint
        : body.type === 'kds'
          ? settings.kdsWebhook
          : ''
    const result =
      body.type === 'payments'
        ? {
            ok: settings.enablePayments,
            configured: settings.enablePayments,
            message: settings.enablePayments
              ? `Provedor ${settings.paymentsProvider} configurado`
              : 'Pagamentos nao configurados',
          }
        : await testEndpoint(endpoint, payload)

    await audit(session.restaurantId, session.user.id, 'integrations.test', { type: body.type, result })
    send(res, 200, result)
    return
  }

  if (url.pathname === '/api/fiscal' && req.method === 'GET') {
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    send(res, 200, await getFiscalSettings(session.restaurantId))
    return
  }

  if (url.pathname === '/api/fiscal' && req.method === 'PUT') {
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    const body = await readBody(req)
    const settings = await saveFiscalSettings(session.restaurantId, body.settings ?? body)
    await audit(session.restaurantId, session.user.id, 'fiscal.update')
    send(res, 200, settings)
    return
  }

  if (url.pathname === '/api/fiscal/test' && req.method === 'POST') {
    requireRateLimit(`fiscal-test:${session.restaurantId}:${session.user.id}`, {
      limit: 20,
      windowMs: 60_000,
    })
    await requireAction(session, 'manageIntegrations', ['admin', 'manager'])
    const settings = await getFiscalSettings(session.restaurantId)
    const result = settings.enableFiscal
      ? await testEndpoint(settings.providerEndpoint, {
          type: 'fiscal.healthcheck',
          provider: settings.provider,
          stateCode: settings.stateCode,
          restaurantId: session.restaurantId,
          createdAt: now(),
        })
      : { ok: false, configured: false, message: 'Fiscal nao configurado' }
    await audit(session.restaurantId, session.user.id, 'fiscal.test', { result })
    send(res, 200, result)
    return
  }

  if (url.pathname === '/api/privacy/export' && req.method === 'GET') {
    await requireAction(session, 'viewReports', ['admin', 'manager'])
    const auditRows = await db.all(
      'SELECT action, metadata, created_at FROM audit_events WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 1000',
      [session.restaurantId],
    )
    await audit(session.restaurantId, session.user.id, 'privacy.export')
    send(res, 200, {
      exportedAt: now(),
      restaurant: session.restaurant,
      state: await getAppState(session.restaurantId, session.user.id),
      integrations: await getIntegrations(session.restaurantId),
      fiscal: await getFiscalSettings(session.restaurantId),
      auditEvents: auditRows,
    })
    return
  }

  if (url.pathname === '/api/privacy/operational-data' && req.method === 'DELETE') {
    await requireAction(session, 'resetOperationalData', ['admin'])
    const current = await getAppState(session.restaurantId, session.user.id)
    const nextState = {
      ...initialAppState,
      staff: current.staff,
      accessProfiles: current.accessProfiles,
      activeUserId: session.user.id,
      auditEvents: [
        stateAuditEvent(session, 'privacy.operational_reset', 'Dados operacionais apagados por solicitacao LGPD'),
      ],
    }
    await saveStateRecord(session.restaurantId, await sanitizeAppState(nextState, session.restaurantId, session), current._version)
    await audit(session.restaurantId, session.user.id, 'privacy.operational_reset')
    send(res, 200, await getAppState(session.restaurantId, session.user.id))
    return
  }

  send(res, 404, { error: 'Rota nao encontrada' })
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  }
  return types[extname(filePath)] ?? 'application/octet-stream'
}

function serveStatic(res, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const filePath = join(distDir, relative)
  const fallback = join(distDir, 'index.html')
  const target = existsSync(filePath) ? filePath : fallback

  if (!existsSync(target)) {
    send(res, 404, { error: 'Build nao encontrado. Rode npm run build antes de npm start.' })
    return
  }

  res.writeHead(200, {
    'Content-Type': contentType(target),
    'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  res.end(readFileSync(target))
}

function createAppServer() {
  const keyPath = process.env.HTTPS_KEY_PATH
  const certPath = process.env.HTTPS_CERT_PATH
  if (keyPath && certPath) {
    return {
      protocol: 'https',
      server: createHttpsServer(
        {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath),
        },
        requestHandler,
      ),
    }
  }

  return {
    protocol: 'http',
    server: createHttpServer(requestHandler),
  }
}

async function requestHandler(req, res) {
  const started = performance.now()
  const requestId = req.headers['x-request-id'] || randomBytes(8).toString('hex')
  res.setHeader('X-Request-Id', requestId)

  res.on('finish', () => {
    const durationMs = Number((performance.now() - started).toFixed(2))
    metrics.requestsTotal += 1
    metrics.lastRequestAt = now()
    metrics.byStatus[res.statusCode] = (metrics.byStatus[res.statusCode] ?? 0) + 1
    metrics.byMethod[req.method] = (metrics.byMethod[req.method] ?? 0) + 1
    if (res.statusCode >= 500) metrics.errorsTotal += 1

    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      requestId,
      method: req.method,
      path: req.url,
      status: res.statusCode,
      durationMs,
    })
  })

  try {
    applySecurityHeaders(req, res)
    if (!hostAllowed(req)) {
      send(res, 421, { error: 'Host nao permitido' })
      return
    }
    if (!applyCors(req, res)) return

    if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(req.method || '')) {
      send(res, 405, { error: 'Metodo nao permitido' })
      return
    }

    requireRateLimit(`global:${clientIp(req)}`, { limit: 600, windowMs: 60_000 })

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    serveStatic(res, url)
  } catch (error) {
    const status = error.status || 500
    log('error', 'handler_error', {
      requestId,
      method: req.method,
      path: req.url,
      status,
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    })
    send(res, status, {
      error: status === 500 ? 'Erro interno' : error.message,
      retryAfter: error.retryAfter,
      detail: process.env.NODE_ENV === 'production' ? undefined : error.message,
    })
  }
}

const { protocol, server } = createAppServer()

server.listen(port, host, () => {
  log('info', 'server_started', {
    url: `${protocol}://${host}:${port}`,
    database: db.label,
    dialect: db.dialect,
  })
})

async function shutdown(signal) {
  log('info', 'server_shutdown', { signal })
  server.close(async () => {
    await db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
