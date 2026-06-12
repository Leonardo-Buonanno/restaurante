const now = Date.now()

export const restaurant = {
  id: process.env.RESTAURANT_ID || 'restaurant-main',
  name: process.env.RESTAURANT_NAME || 'Restaurante',
  slug: process.env.RESTAURANT_SLUG || 'principal',
}

export const staffSeed =
  process.env.INITIAL_ADMIN_PIN
    ? [
        {
          id: process.env.INITIAL_ADMIN_ID || 'admin-main',
          name: process.env.INITIAL_ADMIN_NAME || 'Administrador',
          role: 'admin',
          pin: process.env.INITIAL_ADMIN_PIN,
        },
      ]
    : []

export const initialAppState = {
  staff: [],
  accessProfiles: [
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
  ],
  tables: [],
  menu: [],
  activeUserId: undefined,
  orders: [],
  serviceRequests: [],
  payments: [],
  auditEvents: [],
}

export const defaultIntegrationSettings = {
  printerEndpoint: '',
  paymentsProvider: 'manual',
  paymentsPublicKey: '',
  kdsWebhook: '',
  enablePrinter: false,
  enablePayments: false,
  enableKdsWebhook: false,
  updatedAt: now,
}
