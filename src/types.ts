export type Role = string

export type ViewKey =
  | 'floor'
  | 'order'
  | 'kitchen'
  | 'checkout'
  | 'manager'
  | 'menu'
  | 'integrations'

export type TableStatus =
  | 'free'
  | 'seated'
  | 'ordering'
  | 'preparing'
  | 'served'
  | 'checkout'
  | 'attention'

export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled'

export type Station = 'bar' | 'grill' | 'cold' | 'dessert' | 'pass'

export type PaymentMethod = 'pix' | 'credit' | 'debit' | 'cash' | 'voucher'

export type ActionPermission =
  | 'manageTables'
  | 'manageAccessProfiles'
  | 'manageProducts'
  | 'manageIntegrations'
  | 'viewReports'
  | 'cancelOrders'
  | 'updateKitchenStatus'
  | 'registerPayments'
  | 'closeTables'
  | 'resetOperationalData'

export interface StaffMember {
  id: string
  name: string
  role: Role
  pin?: string
}

export interface AccessProfile {
  id: string
  name: string
  permissions: ViewKey[]
  actions?: ActionPermission[]
  system?: boolean
}

export interface Restaurant {
  id: string
  name: string
  slug: string
}

export interface ModifierGroup {
  name: string
  required?: boolean
  options: string[]
}

export interface MenuItem {
  id: string
  name: string
  category: string
  description: string
  price: number
  prepMinutes: number
  station: Station
  tags: string[]
  allergens: string[]
  favorite: boolean
  available: boolean
  pairingIds: string[]
  modifierGroups: ModifierGroup[]
}

export interface ServiceRequest {
  id: string
  tableId: string
  label: string
  createdAt: number
  priority: 'normal' | 'high'
  resolved: boolean
}

export interface RestaurantTable {
  id: string
  number: number
  seats: number
  guestCount: number
  zone: string
  status: TableStatus
  serverId?: string
  openedAt?: number
  lastActivityAt: number
}

export interface OrderItem {
  id: string
  tableId: string
  menuItemId: string
  name: string
  category: string
  station: Station
  quantity: number
  unitPrice: number
  seat: string
  notes: string
  modifiers: string[]
  status: OrderStatus
  createdAt: number
  sentAt?: number
  readyAt?: number
  servedAt?: number
  cancelledAt?: number
  cancelledBy?: string
  cancelReason?: string
}

export interface Payment {
  id: string
  tableId: string
  amount: number
  method: PaymentMethod
  createdAt: number
}

export interface AuditEvent {
  id: string
  action: string
  label: string
  actorId?: string
  actorName?: string
  tableId?: string
  orderId?: string
  createdAt: number
  metadata?: Record<string, string | number | boolean | undefined>
}

export interface AppState {
  staff: StaffMember[]
  activeUserId?: string
  _version?: number
  accessProfiles: AccessProfile[]
  tables: RestaurantTable[]
  menu: MenuItem[]
  orders: OrderItem[]
  serviceRequests: ServiceRequest[]
  payments: Payment[]
  auditEvents: AuditEvent[]
}

export interface ApiSession {
  token: string
  restaurantId: string
  user: StaffMember
  restaurant: Restaurant
}

export interface IntegrationSettings {
  printerEndpoint: string
  paymentsProvider: string
  paymentsPublicKey: string
  kdsWebhook: string
  enablePrinter: boolean
  enablePayments: boolean
  enableKdsWebhook: boolean
  updatedAt: number
}

export interface FiscalSettings {
  provider: string
  providerEndpoint: string
  stateCode: string
  cityCode: string
  enableFiscal: boolean
  updatedAt: number
}

export type StateOperationType =
  | 'table.create'
  | 'table.open'
  | 'table.guests'
  | 'table.checkout'
  | 'table.sendToKitchen'
  | 'table.close'
  | 'order.create'
  | 'order.quantity'
  | 'order.notes'
  | 'order.status'
  | 'order.cancel'
  | 'request.create'
  | 'request.resolve'
  | 'payment.create'
  | 'menu.create'
  | 'menu.update'
  | 'menu.availability'
  | 'access.create'
  | 'access.update'
  | 'access.delete'

export interface StateOperation {
  type: StateOperationType
  payload: Record<string, unknown>
}

export interface ReportSummary {
  generatedAt: number
  activeTables: number
  revenue: number
  payments: number
  avgTicket: number
  readyOrders: number
  delayedOrders: number
  openRequests: number
  topItems: Array<{
    id: string
    name: string
    quantity: number
    revenue: number
  }>
  paymentsByMethod: Record<string, number>
}
