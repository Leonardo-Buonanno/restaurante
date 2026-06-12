import type { AccessProfile, AppState } from './types'

export const defaultAccessProfiles: AccessProfile[] = [
  {
    id: 'admin',
    name: 'Admin',
    permissions: ['floor', 'order', 'kitchen', 'checkout', 'manager', 'menu', 'integrations'],
    actions: [
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
    ],
    system: true,
  },
  {
    id: 'manager',
    name: 'Gerente',
    permissions: ['floor', 'order', 'kitchen', 'checkout', 'manager', 'menu', 'integrations'],
    actions: [
      'manageTables',
      'manageProducts',
      'manageIntegrations',
      'viewReports',
      'cancelOrders',
      'updateKitchenStatus',
      'registerPayments',
      'closeTables',
    ],
    system: true,
  },
  {
    id: 'waiter',
    name: 'Garcom',
    permissions: ['floor', 'order', 'checkout'],
    actions: ['registerPayments'],
    system: true,
  },
  {
    id: 'kitchen',
    name: 'Cozinha',
    permissions: ['kitchen'],
    actions: ['updateKitchenStatus'],
    system: true,
  },
  {
    id: 'cashier',
    name: 'Caixa',
    permissions: ['floor', 'checkout'],
    actions: ['registerPayments', 'closeTables'],
    system: true,
  },
]

export const initialState: AppState = {
  staff: [],
  accessProfiles: [...defaultAccessProfiles],
  tables: [],
  menu: [],
  activeUserId: undefined,
  orders: [],
  serviceRequests: [],
  payments: [],
  auditEvents: [],
}
