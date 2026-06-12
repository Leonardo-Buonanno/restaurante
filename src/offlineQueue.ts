import { performOperation, ApiError } from './api'
import type { AppState, StateOperation } from './types'

const queueKey = 'mesa-pro-operation-queue-v1'
const lastSyncedKey = 'mesa-pro-last-synced-at-v1'

export interface OfflineQueueItem {
  id: string
  createdAt: number
  operation: StateOperation
}

export interface OfflineQueueSnapshot {
  pendingCount: number
  lastQueuedAt?: number
  lastSyncedAt?: number
}

function readQueue(): OfflineQueueItem[] {
  try {
    const stored = localStorage.getItem(queueKey)
    if (!stored) return []
    const parsed = JSON.parse(stored) as OfflineQueueItem[]
    return Array.isArray(parsed)
      ? parsed.filter((item) => item.operation?.type && item.operation?.payload)
      : []
  } catch {
    return []
  }
}

function writeQueue(items: OfflineQueueItem[]) {
  if (items.length === 0) {
    localStorage.removeItem(queueKey)
    return
  }

  localStorage.setItem(queueKey, JSON.stringify(items.slice(-200)))
}

function readLastSyncedAt() {
  const value = Number(localStorage.getItem(lastSyncedKey))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function getOfflineQueueSnapshot(): OfflineQueueSnapshot {
  const queue = readQueue()
  return {
    pendingCount: queue.length,
    lastQueuedAt: queue.at(-1)?.createdAt,
    lastSyncedAt: readLastSyncedAt(),
  }
}

export function queueOperation(operation: StateOperation): OfflineQueueSnapshot {
  const now = Date.now()
  writeQueue([
    ...readQueue(),
    {
      id: `op-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      operation,
    },
  ])
  return getOfflineQueueSnapshot()
}

export function markOnlineSyncComplete(): OfflineQueueSnapshot {
  localStorage.setItem(lastSyncedKey, String(Date.now()))
  writeQueue([])
  return getOfflineQueueSnapshot()
}

export function shouldQueueOperation(error: unknown) {
  return !(error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status))
}

export async function flushOfflineQueue(
  token: string,
): Promise<OfflineQueueSnapshot & { flushed: number; state?: AppState }> {
  const queue = readQueue()

  if (queue.length === 0) {
    return { ...getOfflineQueueSnapshot(), flushed: 0 }
  }

  let latestState: AppState | undefined
  for (const item of queue) {
    latestState = await performOperation(token, item.operation)
  }

  localStorage.setItem(lastSyncedKey, String(Date.now()))
  writeQueue([])

  return {
    ...getOfflineQueueSnapshot(),
    flushed: queue.length,
    state: latestState,
  }
}
