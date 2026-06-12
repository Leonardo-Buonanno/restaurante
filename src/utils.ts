import type { AccessProfile, AppState, OrderItem, Payment, RestaurantTable } from './types'

export const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function timestamp() {
  return Date.now()
}

export function minutesSince(timestamp?: number) {
  if (!timestamp) return 0
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
}

export function tableOrders(state: AppState, tableId: string) {
  return state.orders.filter((order) => order.tableId === tableId && order.status !== 'cancelled')
}

export function orderSubtotal(orders: OrderItem[]) {
  return orders.reduce((total, order) => total + order.unitPrice * order.quantity, 0)
}

export function tableSubtotal(state: AppState, tableId: string) {
  return orderSubtotal(tableOrders(state, tableId))
}

export function serviceFee(subtotal: number) {
  return subtotal * 0.1
}

export function tableTotal(state: AppState, tableId: string) {
  const subtotal = tableSubtotal(state, tableId)
  return subtotal + serviceFee(subtotal)
}

export function tablePaid(payments: Payment[], tableId: string) {
  return payments
    .filter((payment) => payment.tableId === tableId)
    .reduce((total, payment) => total + payment.amount, 0)
}

export function unreadRequests(state: AppState, tableId?: string) {
  return state.serviceRequests.filter(
    (request) => !request.resolved && (!tableId || request.tableId === tableId),
  )
}

export function getTableAlert(state: AppState, table: RestaurantTable) {
  const requests = unreadRequests(state, table.id)
  if (requests.some((request) => request.priority === 'high')) return 'Chamado urgente'

  const hasReady = state.orders.some(
    (order) => order.tableId === table.id && order.status === 'ready',
  )
  if (hasReady) return 'Pedido pronto'

  const pendingMinutes = Math.max(
    0,
    ...state.orders
      .filter((order) => order.tableId === table.id && ['sent', 'preparing'].includes(order.status))
      .map((order) => minutesSince(order.sentAt ?? order.createdAt)),
  )
  if (pendingMinutes >= 20) return 'Cozinha atrasada'

  if (table.status !== 'free' && minutesSince(table.lastActivityAt) >= 18) return 'Sem contato recente'

  return ''
}

export function statusLabel(status: RestaurantTable['status']) {
  const labels: Record<RestaurantTable['status'], string> = {
    free: 'Livre',
    seated: 'Ocupada',
    ordering: 'Pedido',
    preparing: 'Preparo',
    served: 'Servida',
    checkout: 'Conta',
    attention: 'Atencao',
  }

  return labels[status]
}

export function roleLabel(role: string, accessProfiles: AccessProfile[] = []) {
  const profile = accessProfiles.find((item) => item.id === role)
  if (profile) return profile.name

  const labels: Record<string, string> = {
    admin: 'Admin',
    manager: 'Gerente',
    waiter: 'Garcom',
    kitchen: 'Cozinha',
    cashier: 'Caixa',
  }

  return labels[role] ?? role
}
