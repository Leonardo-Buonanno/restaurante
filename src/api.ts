import type {
  ApiSession,
  AppState,
  FiscalSettings,
  IntegrationSettings,
  ReportSummary,
  Restaurant,
  StateOperation,
  StaffMember,
} from './types'

const defaultRestaurantSlug = import.meta.env.VITE_RESTAURANT_SLUG || 'principal'

function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  if (window.location.port === '5173') return 'http://127.0.0.1:8787'
  return ''
}

const apiBaseUrl = getApiBaseUrl()

export interface BootstrapPayload {
  restaurant: Restaurant
  staff: StaffMember[]
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  const payload = (await response.json().catch(() => ({}))) as { error?: string }

  if (!response.ok) {
    throw new ApiError(payload.error ?? 'Erro na API', response.status)
  }

  return payload as T
}

export function getBootstrap(restaurantSlug = defaultRestaurantSlug) {
  return request<BootstrapPayload>(`/api/bootstrap?restaurant=${encodeURIComponent(restaurantSlug)}`)
}

export function login(staffId: string, pin: string, restaurantSlug = defaultRestaurantSlug) {
  return request<ApiSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ staffId, pin, restaurantSlug }),
  })
}

export function setupInitialAdmin(name: string, pin: string, restaurantSlug = defaultRestaurantSlug) {
  return request<ApiSession>('/api/setup/admin', {
    method: 'POST',
    body: JSON.stringify({ name, pin, restaurantSlug }),
  })
}

export function logout(token: string) {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, token)
}

export function getAppState(token: string) {
  return request<AppState>('/api/state', undefined, token)
}

export function saveAppState(token: string, state: AppState, expectedVersion?: number) {
  return request<{ ok: boolean; updatedAt: number }>(
    '/api/state',
    {
      method: 'PUT',
      body: JSON.stringify({ state, expectedVersion }),
    },
    token,
  )
}

export function performOperation(token: string, operation: StateOperation) {
  return request<AppState>(
    '/api/operations',
    {
      method: 'POST',
      body: JSON.stringify(operation),
    },
    token,
  )
}

export function getReportSummary(token: string) {
  return request<ReportSummary>('/api/reports/summary', undefined, token)
}

export function getIntegrations(token: string) {
  return request<IntegrationSettings>('/api/integrations', undefined, token)
}

export function saveIntegrations(token: string, settings: IntegrationSettings) {
  return request<IntegrationSettings>(
    '/api/integrations',
    {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    },
    token,
  )
}

export function testIntegration(token: string, type: 'printer' | 'payments' | 'kds') {
  return request<{ ok: boolean; configured: boolean; message: string; status?: number }>(
    '/api/integrations/test',
    {
      method: 'POST',
      body: JSON.stringify({ type }),
    },
    token,
  )
}

export function getFiscalSettings(token: string) {
  return request<FiscalSettings>('/api/fiscal', undefined, token)
}

export function saveFiscalSettings(token: string, settings: FiscalSettings) {
  return request<FiscalSettings>(
    '/api/fiscal',
    {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    },
    token,
  )
}

export function testFiscalSettings(token: string) {
  return request<{ ok: boolean; configured: boolean; message: string; status?: number }>(
    '/api/fiscal/test',
    { method: 'POST', body: JSON.stringify({}) },
    token,
  )
}

export function createStaff(token: string, staff: { name: string; role: string; pin: string }) {
  return request<AppState>(
    '/api/staff',
    {
      method: 'POST',
      body: JSON.stringify(staff),
    },
    token,
  )
}

export function updateStaff(token: string, staffId: string, patch: { name?: string; role?: string; active?: boolean }) {
  return request<AppState>(
    `/api/staff/${encodeURIComponent(staffId)}`,
    {
      method: 'POST',
      body: JSON.stringify(patch),
    },
    token,
  )
}

export function resetStaffPin(token: string, staffId: string, pin: string) {
  return request<AppState>(
    `/api/staff/${encodeURIComponent(staffId)}/pin`,
    {
      method: 'POST',
      body: JSON.stringify({ pin }),
    },
    token,
  )
}
