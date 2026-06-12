import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Building2,
  ChefHat,
  Check,
  CreditCard,
  DoorOpen,
  Download,
  Eye,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Minus,
  Pencil,
  Plug,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Server,
  Sparkles,
  Table2,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingUp,
  Utensils,
  WalletCards,
  Webhook,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './App.css'
import {
  getAppState,
  getBootstrap,
  getFiscalSettings,
  getIntegrations,
  getReportSummary,
  login as apiLogin,
  logout as apiLogout,
  saveIntegrations,
  saveFiscalSettings,
  createStaff,
  performOperation,
  resetStaffPin,
  setupInitialAdmin,
  testFiscalSettings,
  testIntegration,
  updateStaff,
} from './api'
import { defaultAccessProfiles, initialState } from './data'
import {
  flushOfflineQueue,
  getOfflineQueueSnapshot,
  queueOperation,
  shouldQueueOperation,
  type OfflineQueueSnapshot,
} from './offlineQueue'
import type {
  AccessProfile,
  ActionPermission,
  ApiSession,
  AppState,
  AuditEvent,
  FiscalSettings,
  IntegrationSettings,
  MenuItem,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  ReportSummary,
  RestaurantTable,
  StaffMember,
  StateOperation,
  Station,
  ViewKey,
} from './types'
import {
  currency,
  getTableAlert,
  minutesSince,
  orderSubtotal,
  roleLabel,
  serviceFee,
  statusLabel,
  tableOrders,
  tablePaid,
  tableSubtotal,
  tableTotal,
  timestamp,
  uid,
  unreadRequests,
} from './utils'

const storageKey = 'mesa-pro-state-v2'
const sessionKey = 'mesa-pro-session-v2'

const viewConfig: Record<ViewKey, { label: string; icon: typeof Table2 }> = {
  floor: {
    label: 'Salao',
    icon: Table2,
  },
  order: {
    label: 'Pedido',
    icon: Utensils,
  },
  kitchen: {
    label: 'Cozinha',
    icon: ChefHat,
  },
  checkout: {
    label: 'Conta',
    icon: ReceiptText,
  },
  manager: {
    label: 'Gestao',
    icon: LayoutDashboard,
  },
  menu: {
    label: 'Cardapio',
    icon: ToggleRight,
  },
  integrations: {
    label: 'Integracoes',
    icon: Plug,
  },
}

const paymentLabels: Record<PaymentMethod, string> = {
  pix: 'Pix',
  credit: 'Credito',
  debit: 'Debito',
  cash: 'Dinheiro',
  voucher: 'Voucher',
}

const actionPermissionConfig: Record<ActionPermission, { label: string; description: string }> = {
  manageTables: {
    label: 'Cadastrar mesas',
    description: 'Criar mesas e setores do salao.',
  },
  manageAccessProfiles: {
    label: 'Tipos de acesso',
    description: 'Criar, editar e excluir perfis de permissao.',
  },
  manageProducts: {
    label: 'Produtos do cardapio',
    description: 'Cadastrar e editar produtos.',
  },
  manageIntegrations: {
    label: 'Integracoes',
    description: 'Configurar impressora, pagamento e KDS externo.',
  },
  viewReports: {
    label: 'Relatorios',
    description: 'Ver indicadores, riscos e historico operacional.',
  },
  cancelOrders: {
    label: 'Cancelar pedidos',
    description: 'Cancelar itens com motivo obrigatorio.',
  },
  updateKitchenStatus: {
    label: 'Status da cozinha',
    description: 'Mover itens entre recebido, preparo, pronto e entregue.',
  },
  registerPayments: {
    label: 'Registrar pagamentos',
    description: 'Lancar pagamentos na conta da mesa.',
  },
  closeTables: {
    label: 'Liberar mesa',
    description: 'Fechar a conta e liberar a mesa.',
  },
  resetOperationalData: {
    label: 'Reiniciar operacao',
    description: 'Limpar dados operacionais do app.',
  },
}

const allActionPermissions = Object.keys(actionPermissionConfig) as ActionPermission[]

const dishNotePresets = [
  'Sem cebola',
  'Sem molho',
  'Sem sal',
  'Sem pimenta',
  'Ponto mal passado',
  'Ponto ao ponto',
  'Ponto bem passado',
]

const stationOptions: Array<{ value: Station; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'cold', label: 'Cozinha fria' },
  { value: 'grill', label: 'Grelha' },
  { value: 'pass', label: 'Passe' },
  { value: 'dessert', label: 'Sobremesa' },
]

interface TrainingStep {
  view: ViewKey
  target: string
  title: string
  body: string
}

interface AppInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const trainingUser: StaffMember = {
  id: 'training-user',
  name: 'Treinamento',
  role: 'admin',
}

const trainingSteps: TrainingStep[] = [
  {
    view: 'manager',
    target: 'nav-manager',
    title: 'Comece pela Gestao',
    body: 'A ordem real de configuracao comeca por tipos de acesso. Primeiro defina quem pode ver cada aba, depois cadastre mesas e cardapio.',
  },
  {
    view: 'manager',
    target: 'access-name',
    title: 'Nome do tipo de acesso',
    body: 'Use nomes claros, como Garcom, Caixa, Bar ou Supervisor. Cada operador recebera um desses perfis.',
  },
  {
    view: 'manager',
    target: 'permission-grid',
    title: 'Permissoes por aba',
    body: 'Marque somente as abas que esse tipo de acesso deve usar. Exemplo: caixa precisa de Conta; cozinha precisa de Cozinha.',
  },
  {
    view: 'manager',
    target: 'action-permission-grid',
    title: 'Permissoes por acao',
    body: 'Depois das abas, defina acoes sensiveis: cancelar pedido, liberar mesa, cadastrar produto, configurar integracoes e ver relatorios.',
  },
  {
    view: 'manager',
    target: 'access-save',
    title: 'Criar ou salvar acesso',
    body: 'Depois de revisar as permissoes, salve. Perfis personalizados podem ser editados ou excluidos individualmente.',
  },
  {
    view: 'manager',
    target: 'access-list',
    title: 'Lista de tipos de acesso',
    body: 'Aqui ficam os perfis padrao e os personalizados. Perfis em uso por operadores nao devem ser removidos sem reorganizar a equipe.',
  },
  {
    view: 'manager',
    target: 'audit-log',
    title: 'Historico operacional',
    body: 'Administradores e perfis com relatorios veem a trilha de acoes: aberturas de mesa, pedidos enviados, cancelamentos, pagamentos e alteracoes.',
  },
  {
    view: 'floor',
    target: 'nav-floor',
    title: 'Depois cadastre o salao',
    body: 'A segunda etapa e cadastrar mesas reais. Sem mesas, Pedido e Conta nao tem onde operar.',
  },
  {
    view: 'floor',
    target: 'table-create',
    title: 'Cadastro de mesa',
    body: 'Use este bloco para inserir cada mesa do restaurante. Cadastre todos os setores antes do primeiro turno.',
  },
  {
    view: 'floor',
    target: 'table-number',
    title: 'Numero da mesa',
    body: 'Informe o numero fisico usado pela equipe no salao. Ele deve ser unico.',
  },
  {
    view: 'floor',
    target: 'table-seats',
    title: 'Capacidade da mesa',
    body: 'A capacidade e uma referencia operacional. No pedido, voce ainda pode informar quantas pessoas forem necessarias.',
  },
  {
    view: 'floor',
    target: 'table-zone',
    title: 'Setor da mesa',
    body: 'Setores organizam o mapa: Salao principal, Varanda, Area externa, Mezanino ou qualquer divisao real do restaurante.',
  },
  {
    view: 'floor',
    target: 'table-save',
    title: 'Cadastrar mesa',
    body: 'Salve a mesa para ela aparecer no mapa do salao. Repita ate cadastrar todas as mesas reais.',
  },
  {
    view: 'menu',
    target: 'nav-menu',
    title: 'Depois cadastre o cardapio',
    body: 'Com acessos e mesas prontos, cadastre produtos reais para que o garcom possa vender.',
  },
  {
    view: 'menu',
    target: 'product-name',
    title: 'Nome do produto',
    body: 'Use o nome que a equipe reconhece rapidamente na operacao.',
  },
  {
    view: 'menu',
    target: 'product-category',
    title: 'Categoria',
    body: 'Agrupe itens por categoria, como Pratos, Bebidas, Sobremesas ou Entradas. Isso alimenta os filtros do pedido.',
  },
  {
    view: 'menu',
    target: 'product-station',
    title: 'Praca de preparo',
    body: 'Escolha para onde o item deve ir: Bar, Cozinha fria, Grelha, Passe ou Sobremesa.',
  },
  {
    view: 'menu',
    target: 'product-description',
    title: 'Descricao',
    body: 'Registre ingredientes ou detalhes comerciais. Isso ajuda o garcom a conferir o item correto.',
  },
  {
    view: 'menu',
    target: 'product-price',
    title: 'Preco',
    body: 'Informe o preco final de venda. Esse valor entra direto na comanda e na conta.',
  },
  {
    view: 'menu',
    target: 'product-prep',
    title: 'Tempo de preparo',
    body: 'Use minutos realistas para acompanhar atrasos e expectativa da cozinha.',
  },
  {
    view: 'menu',
    target: 'product-tags',
    title: 'Tags',
    body: 'Tags ajudam na busca. Exemplos: vegetariano, promocao, apimentado, especial.',
  },
  {
    view: 'menu',
    target: 'product-allergens',
    title: 'Alergenicos',
    body: 'Preencha alergênicos reais, como leite, castanhas ou gluten. Isso reduz risco no atendimento.',
  },
  {
    view: 'menu',
    target: 'product-switches',
    title: 'Favorito e disponibilidade',
    body: 'Favorito aparece no filtro inicial do pedido. Disponivel para venda controla se o garcom consegue adicionar o produto.',
  },
  {
    view: 'menu',
    target: 'product-save',
    title: 'Cadastrar produto',
    body: 'Depois de preencher todos os campos, salve o produto. Ele passa a aparecer no cardapio operacional.',
  },
  {
    view: 'menu',
    target: 'availability-list',
    title: 'Cardapio operacional',
    body: 'Use esta lista para editar produtos existentes ou pausar venda de itens indisponiveis no turno.',
  },
  {
    view: 'integrations',
    target: 'nav-integrations',
    title: 'Configure integracoes antes da operacao',
    body: 'Se o restaurante usar impressora, pagamentos ou KDS externo, configure e teste antes do turno.',
  },
  {
    view: 'integrations',
    target: 'printer-card',
    title: 'Impressora de producao',
    body: 'Ative, informe o endpoint e teste a impressora antes de depender dela em producao.',
  },
  {
    view: 'integrations',
    target: 'payments-card',
    title: 'Pagamentos',
    body: 'Escolha o provedor e configure a chave publica quando houver integracao real de pagamento.',
  },
  {
    view: 'integrations',
    target: 'kds-card',
    title: 'KDS externo',
    body: 'Configure o webhook se a cozinha usar um painel externo para receber pedidos.',
  },
  {
    view: 'floor',
    target: 'table-card',
    title: 'Inicio do uso real',
    body: 'No turno real, o fluxo comeca no Salao. O garcom abre a mesa, acompanha status e vai para Pedido ou Conta.',
  },
  {
    view: 'floor',
    target: 'table-open',
    title: 'Abrir mesa',
    body: 'Clique em Abrir quando clientes sentarem. A mesa passa a ter garcom, horario e status operacional.',
  },
  {
    view: 'order',
    target: 'guest-count',
    title: 'Quantidade de pessoas',
    body: 'Ajuste com +, - ou digitando o numero. O app aceita a quantidade real, mesmo acima da capacidade de referencia.',
  },
  {
    view: 'order',
    target: 'seat-selector',
    title: 'Pessoa ou mesa',
    body: 'Selecione se o item vai para a mesa inteira ou para uma pessoa especifica. Isso ajuda na divisao da conta.',
  },
  {
    view: 'order',
    target: 'menu-search',
    title: 'Busca do cardapio',
    body: 'Busque por nome, tag ou descricao para lancar pedidos rapidamente.',
  },
  {
    view: 'order',
    target: 'category-filter',
    title: 'Filtro de categorias',
    body: 'Use categorias para navegar pelo cardapio: Favoritos, Pratos, Bebidas e outras categorias cadastradas.',
  },
  {
    view: 'order',
    target: 'dish-notes',
    title: 'Observacoes por prato',
    body: 'Registre pedidos como sem cebola, sem molho, alergia ou ponto da carne. A observacao fica presa ao item.',
  },
  {
    view: 'order',
    target: 'dish-note-presets',
    title: 'Atalhos de observacao',
    body: 'Use atalhos para acelerar o atendimento e reduzir erro de digitacao.',
  },
  {
    view: 'order',
    target: 'dish-add',
    title: 'Adicionar item',
    body: 'Depois de escolher pessoa e observacoes, adicione o produto na comanda.',
  },
  {
    view: 'order',
    target: 'order-ticket',
    title: 'Comanda',
    body: 'Confira itens, quantidade, status e observacoes antes de enviar para a cozinha.',
  },
  {
    view: 'order',
    target: 'send-kitchen',
    title: 'Enviar para cozinha',
    body: 'Itens em rascunho so chegam na producao depois de clicar em Enviar.',
  },
  {
    view: 'kitchen',
    target: 'kitchen-board',
    title: 'Fila da cozinha',
    body: 'A cozinha visualiza pedidos por praca e acompanha tempo de espera.',
  },
  {
    view: 'kitchen',
    target: 'kitchen-ticket',
    title: 'Ticket de preparo',
    body: 'Cada ticket mostra mesa, tempo, quantidade, item, pessoa e observacoes.',
  },
  {
    view: 'kitchen',
    target: 'kitchen-status',
    title: 'Status da producao',
    body: 'Use Iniciar e Pronto para manter o salao informado e reduzir atrasos.',
  },
  {
    view: 'checkout',
    target: 'split-mode',
    title: 'Modo da conta',
    body: 'No fechamento, escolha visualizar a conta por total, por pessoa ou por item.',
  },
  {
    view: 'checkout',
    target: 'payment-method',
    title: 'Metodo de pagamento',
    body: 'Selecione Pix, credito, debito, dinheiro ou voucher antes de registrar pagamento.',
  },
  {
    view: 'checkout',
    target: 'payment-value',
    title: 'Valor pago',
    body: 'Informe valor total ou parcial. O sistema acompanha o saldo restante.',
  },
  {
    view: 'checkout',
    target: 'add-payment',
    title: 'Registrar pagamento',
    body: 'Registre cada pagamento recebido. A mesa so deve ser liberada quando estiver quitada.',
  },
  {
    view: 'checkout',
    target: 'release-table',
    title: 'Liberar mesa',
    body: 'Use este botao somente depois da conta quitada. A mesa volta ao status livre.',
  },
  {
    view: 'floor',
    target: 'offline-sync',
    title: 'Modo offline e sincronizacao',
    body: 'Se a internet cair, continue operando. O topo mostra pendencias e sincroniza automaticamente quando a conexao voltar.',
  },
  {
    view: 'manager',
    target: 'manager-metrics',
    title: 'Acompanhar gestao',
    body: 'Durante o turno, gerente e admin acompanham mesas ativas, ticket medio, prontos e atrasos.',
  },
  {
    view: 'manager',
    target: 'risk-list',
    title: 'Risco operacional',
    body: 'Priorize mesas com atraso, chamado urgente ou pedido pronto para manter o atendimento fluido.',
  },
  {
    view: 'manager',
    target: 'top-items',
    title: 'Mais vendidos',
    body: 'Use essa informacao para orientar equipe, reposicao e decisoes de cardapio.',
  },
]

function buildTrainingState(state: AppState, profiles: AccessProfile[]): AppState {
  const table = state.tables[0] ?? {
    id: 'training-table',
    number: 1,
    seats: 4,
    guestCount: 2,
    zone: 'Salao principal',
    status: 'preparing',
    serverId: trainingUser.id,
    openedAt: timestamp() - 18 * 60_000,
    lastActivityAt: timestamp() - 4 * 60_000,
  }

  const menu = state.menu.length
    ? state.menu
    : [
        {
          id: 'training-menu-main',
          name: 'Prato de treinamento',
          category: 'Pratos',
          description: 'Produto usado somente para explicar o fluxo de pedido.',
          price: 49.9,
          prepMinutes: 18,
          station: 'grill' as Station,
          tags: ['treinamento'],
          allergens: ['gluten'],
          favorite: true,
          available: true,
          pairingIds: [],
          modifierGroups: [],
        },
        {
          id: 'training-menu-drink',
          name: 'Bebida de treinamento',
          category: 'Bebidas',
          description: 'Item de apoio para demonstrar categorias e busca.',
          price: 12,
          prepMinutes: 3,
          station: 'bar' as Station,
          tags: ['rapido'],
          allergens: [],
          favorite: true,
          available: true,
          pairingIds: [],
          modifierGroups: [],
        },
      ]

  const order = state.orders[0] ?? {
    id: 'training-order',
    tableId: table.id,
    menuItemId: menu[0].id,
    name: menu[0].name,
    category: menu[0].category,
    station: menu[0].station,
    quantity: 1,
    unitPrice: menu[0].price,
    seat: 'Pessoa 1',
    notes: 'Sem cebola; ponto ao ponto',
    modifiers: [],
    status: 'sent' as OrderStatus,
    createdAt: timestamp() - 10 * 60_000,
    sentAt: timestamp() - 8 * 60_000,
  }

  return {
    ...state,
    staff: state.staff.length ? state.staff : [trainingUser],
    activeUserId: trainingUser.id,
    accessProfiles: profiles,
    tables: state.tables.length ? state.tables : [table],
    menu,
    orders: state.orders.some((item) => item.tableId === table.id) ? state.orders : [order, ...state.orders],
    serviceRequests: state.serviceRequests,
    payments: state.payments,
    auditEvents: state.auditEvents,
  }
}

function loadState(): AppState {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored ? normalizeState(JSON.parse(stored) as AppState) : initialState
  } catch {
    return initialState
  }
}

function loadSession(): ApiSession | null {
  try {
    const stored = localStorage.getItem(sessionKey)
    return stored ? (JSON.parse(stored) as ApiSession) : null
  } catch {
    return null
  }
}

function defaultIntegrations(): IntegrationSettings {
  return {
    printerEndpoint: '',
    paymentsProvider: 'manual',
    paymentsPublicKey: '',
    kdsWebhook: '',
    enablePrinter: false,
    enablePayments: false,
    enableKdsWebhook: false,
    updatedAt: 0,
  }
}

function defaultFiscalSettings(): FiscalSettings {
  return {
    provider: 'manual',
    providerEndpoint: '',
    stateCode: '',
    cityCode: '',
    enableFiscal: false,
    updatedAt: 0,
  }
}

function normalizeAccessProfiles(profiles?: AccessProfile[]) {
  const validViews = Object.keys(viewConfig) as ViewKey[]
  const customProfiles = Array.isArray(profiles)
    ? profiles
        .filter((profile) => !defaultAccessProfiles.some((item) => item.id === profile.id))
        .map((profile) => {
          const permissions = profile.permissions.filter((permission) => validViews.includes(permission))
          return {
            ...profile,
            permissions,
            actions: normalizeActionPermissions(profile.actions, permissions),
            system: false,
          }
        })
        .filter((profile) => profile.name.trim() && profile.permissions.length > 0)
    : []

  return [...defaultAccessProfiles, ...customProfiles]
}

function normalizeActionPermissions(actions: AccessProfile['actions'], permissions: ViewKey[]) {
  if (Array.isArray(actions)) {
    return actions.filter((action) => allActionPermissions.includes(action))
  }

  const inferred: ActionPermission[] = []
  if (permissions.includes('manager')) inferred.push('viewReports')
  if (permissions.includes('manager') && permissions.includes('floor')) inferred.push('manageTables')
  if (permissions.includes('manager')) inferred.push('manageAccessProfiles')
  if (permissions.includes('menu')) inferred.push('manageProducts')
  if (permissions.includes('integrations')) inferred.push('manageIntegrations')
  if (permissions.includes('kitchen')) inferred.push('updateKitchenStatus')
  if (permissions.includes('checkout')) inferred.push('registerPayments', 'closeTables')
  return inferred.filter((action, index, list) => list.indexOf(action) === index)
}

function normalizeState(state: AppState): AppState {
  return {
    ...initialState,
    ...state,
    accessProfiles: normalizeAccessProfiles(state.accessProfiles),
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.slice(0, 300) : [],
  }
}

function permissionsForRole(role: string, profiles: AccessProfile[]) {
  return profiles.find((profile) => profile.id === role)?.permissions ?? []
}

function actionsForRole(role: string, profiles: AccessProfile[]) {
  return profiles.find((profile) => profile.id === role)?.actions ?? []
}

function normalizeGuestCount(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function statusClass(status: RestaurantTable['status']) {
  return `status status-${status}`
}

function orderStatusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    draft: 'Rascunho',
    sent: 'Enviado',
    preparing: 'Preparo',
    ready: 'Pronto',
    served: 'Entregue',
    cancelled: 'Cancelado',
  }

  return labels[status]
}

function stationLabel(station: string) {
  const labels: Record<string, string> = {
    bar: 'Bar',
    grill: 'Grelha',
    cold: 'Fria',
    dessert: 'Sobremesa',
    pass: 'Passe',
  }

  return labels[station] ?? station
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [session, setSession] = useState<ApiSession | null>(() => loadSession())
  const [backendReady, setBackendReady] = useState(false)
  const [integrations, setIntegrations] = useState<IntegrationSettings>(() => defaultIntegrations())
  const [fiscal, setFiscal] = useState<FiscalSettings>(() => defaultFiscalSettings())
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [integrationMessage, setIntegrationMessage] = useState('')
  const [systemMessage, setSystemMessage] = useState('')
  const [view, setView] = useState<ViewKey>('floor')
  const [selectedTableId, setSelectedTableId] = useState('')
  const [category, setCategory] = useState('Favoritos')
  const [search, setSearch] = useState('')
  const [selectedSeat, setSelectedSeat] = useState('Mesa')
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({})
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentInput, setPaymentInput] = useState('')
  const [splitMode, setSplitMode] = useState<'total' | 'person' | 'items'>('total')
  const [pin, setPin] = useState('')
  const [loginUserId, setLoginUserId] = useState('s2')
  const [loginError, setLoginError] = useState('')
  const [setupName, setSetupName] = useState('')
  const [setupPin, setSetupPin] = useState('')
  const [setupPinConfirm, setSetupPinConfirm] = useState('')
  const [trainingMode, setTrainingMode] = useState(false)
  const [trainingStepIndex, setTrainingStepIndex] = useState(0)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [queueSnapshot, setQueueSnapshot] = useState<OfflineQueueSnapshot>(() => getOfflineQueueSnapshot())
  const [installPrompt, setInstallPrompt] = useState<AppInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(() => window.matchMedia('(display-mode: standalone)').matches)

  const syncNow = useCallback(async () => {
    if (!session) return

    if (!navigator.onLine) {
      setIsOnline(false)
      setSyncMessage('Sem conexao. As alteracoes continuam salvas neste aparelho.')
      setQueueSnapshot(getOfflineQueueSnapshot())
      return
    }

    const snapshot = getOfflineQueueSnapshot()
    if (snapshot.pendingCount === 0) {
      setSyncMessage('Tudo sincronizado.')
      setQueueSnapshot(snapshot)
      return
    }

    setSyncing(true)
    setSyncMessage('Sincronizando alteracoes offline...')
    try {
      const nextSnapshot = await flushOfflineQueue(session.token)
      if (nextSnapshot.state) {
        setState(normalizeState({ ...nextSnapshot.state, activeUserId: session.user.id }))
      }
      setQueueSnapshot(nextSnapshot)
      setBackendReady(true)
      setSyncMessage(
        nextSnapshot.flushed > 0
          ? `${nextSnapshot.flushed} alteracao offline sincronizada.`
          : 'Tudo sincronizado.',
      )
    } catch (error) {
      setQueueSnapshot(getOfflineQueueSnapshot())
      setSyncMessage(error instanceof Error ? `Sincronizacao pendente: ${error.message}` : 'Sincronizacao pendente.')
    } finally {
      setSyncing(false)
    }
  }, [session])

  async function installApp() {
    if (!installPrompt) return

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallPrompt(null)
    if (choice.outcome === 'accepted') setIsStandalone(true)
  }

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      setSyncMessage('Conexao restaurada. Verificando pendencias...')
      setQueueSnapshot(getOfflineQueueSnapshot())
    }

    function handleOffline() {
      setIsOnline(false)
      setSyncMessage('Modo offline ativo. As alteracoes serao sincronizadas depois.')
      setQueueSnapshot(getOfflineQueueSnapshot())
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as AppInstallPromptEvent)
    }

    function handleInstalled() {
      setInstallPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    if (!session || !isOnline) return
    if (getOfflineQueueSnapshot().pendingCount === 0) return
    const timer = window.setTimeout(() => {
      void syncNow()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [isOnline, session, syncNow])

  useEffect(() => {
    if (session) return

    void getBootstrap()
      .then((payload) => {
        setState((current) => ({ ...current, staff: payload.staff }))
        setLoginUserId(payload.staff[0]?.id || '')
        setSystemMessage(
          payload.staff.length
            ? `Restaurante: ${payload.restaurant.name}`
            : 'Nenhum operador cadastrado. Crie o primeiro administrador para iniciar.',
        )
      })
      .catch((error: Error) => {
        setLoginError(`API indisponivel: ${error.message}`)
      })
  }, [session])

  useEffect(() => {
    if (!session) {
      localStorage.removeItem(sessionKey)
      return
    }

    localStorage.setItem(sessionKey, JSON.stringify(session))
    void Promise.all([
      getAppState(session.token),
      ['admin', 'manager'].includes(session.user.role) ? getIntegrations(session.token) : Promise.resolve(defaultIntegrations()),
      ['admin', 'manager'].includes(session.user.role) ? getFiscalSettings(session.token) : Promise.resolve(defaultFiscalSettings()),
      ['admin', 'manager'].includes(session.user.role) ? getReportSummary(session.token) : Promise.resolve(null),
    ])
      .then(([remoteState, remoteIntegrations, remoteFiscal, remoteReport]) => {
        setState(normalizeState({ ...remoteState, activeUserId: session.user.id }))
        setIntegrations(remoteIntegrations)
        setFiscal(remoteFiscal)
        setReport(remoteReport)
        setBackendReady(true)
        setSystemMessage(`Banco conectado: ${session.restaurant.name}`)
      })
      .catch((error: Error) => {
        setSystemMessage(`Falha de sincronizacao: ${error.message}`)
        setSyncMessage('Operando com dados salvos neste aparelho.')
      })
  }, [session])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!session || !backendReady || !['admin', 'manager'].includes(session.user.role)) return

    void getReportSummary(session.token)
      .then(setReport)
      .catch((error: Error) => console.error('Falha ao atualizar relatorio', error))
  }, [backendReady, session, state])

  const accessProfiles = useMemo(() => normalizeAccessProfiles(state.accessProfiles), [state.accessProfiles])
  const displayState = useMemo(
    () => (trainingMode ? buildTrainingState(state, accessProfiles) : state),
    [accessProfiles, state, trainingMode],
  )
  const activeUser = trainingMode
    ? trainingUser
    : session?.user ?? displayState.staff.find((staffMember) => staffMember.id === displayState.activeUserId)
  const selectedTable = displayState.tables.find((table) => table.id === selectedTableId) ?? displayState.tables[0]
  const selectedOrders = useMemo(
    () => tableOrders(displayState, selectedTable?.id ?? ''),
    [displayState, selectedTable?.id],
  )
  const selectedPending = selectedOrders.filter((order) => order.status === 'draft')
  const selectedSubtotal = selectedTable ? tableSubtotal(displayState, selectedTable.id) : 0
  const selectedTotal = selectedTable ? tableTotal(displayState, selectedTable.id) : 0
  const selectedPaid = selectedTable ? tablePaid(displayState.payments, selectedTable.id) : 0
  const selectedRemaining = Math.max(0, selectedTotal - selectedPaid)
  const categories = useMemo(
    () => ['Favoritos', ...Array.from(new Set(displayState.menu.map((item) => item.category)))],
    [displayState.menu],
  )

  const accessibleViews = useMemo(
    () => (activeUser ? permissionsForRole(activeUser.role, accessProfiles) : []),
    [accessProfiles, activeUser],
  )
  const activeActions = useMemo(
    () => (activeUser ? actionsForRole(activeUser.role, accessProfiles) : []),
    [accessProfiles, activeUser],
  )
  const canPerform = (action: ActionPermission) => trainingMode || activeActions.includes(action)
  const safeView = accessibleViews.includes(view) ? view : accessibleViews[0] ?? 'floor'

  const filteredMenu = displayState.menu.filter((item) => {
    const categoryMatch = category === 'Favoritos' ? item.favorite : item.category === category
    const searchText = `${item.name} ${item.description} ${item.tags.join(' ')}`.toLowerCase()
    return categoryMatch && searchText.includes(search.toLowerCase())
  })

  const suggestions = useMemo(() => {
    const recentIds = selectedOrders.slice(-3).flatMap((order) => {
      const item = displayState.menu.find((menuItem) => menuItem.id === order.menuItemId)
      return item?.pairingIds ?? []
    })

    return displayState.menu
      .filter((item) => item.available && recentIds.includes(item.id))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 4)
  }, [displayState.menu, selectedOrders])

  function mutateState(updater: (current: AppState) => AppState) {
    setState((current) => updater(current))
  }

  function applyRemoteState(remoteState: AppState) {
    setState(normalizeState({ ...remoteState, activeUserId: session?.user.id }))
    setBackendReady(true)
    setQueueSnapshot(getOfflineQueueSnapshot())
  }

  function commitOperation(operation: StateOperation, updater: (current: AppState) => AppState) {
    mutateState(updater)
    if (!session || trainingMode) return

    if (!navigator.onLine || !isOnline) {
      setQueueSnapshot(queueOperation(operation))
      setSyncMessage('Alteracao salva neste aparelho. Sincronize quando a internet voltar.')
      return
    }

    void performOperation(session.token, operation)
      .then((remoteState) => {
        applyRemoteState(remoteState)
        setSyncMessage('Alteracao sincronizada.')
      })
      .catch((error: Error) => {
        if (shouldQueueOperation(error)) {
          setBackendReady(false)
          setQueueSnapshot(queueOperation(operation))
          setSyncMessage('API indisponivel. Alteracao ficou na fila offline.')
          return
        }

        setSystemMessage(error.message)
        void getAppState(session.token)
          .then((remoteState) => applyRemoteState(remoteState))
          .catch(() => undefined)
      })
  }

  function createAuditEvent(
    action: string,
    label: string,
    metadata: AuditEvent['metadata'] = {},
  ): AuditEvent {
    return {
      id: uid('audit'),
      action,
      label,
      actorId: activeUser?.id,
      actorName: activeUser?.name,
      tableId: typeof metadata.tableId === 'string' ? metadata.tableId : undefined,
      orderId: typeof metadata.orderId === 'string' ? metadata.orderId : undefined,
      createdAt: timestamp(),
      metadata,
    }
  }

  function appendAudit(current: AppState, event: AuditEvent): AppState {
    return {
      ...current,
      auditEvents: [event, ...(current.auditEvents ?? [])].slice(0, 300),
    }
  }

  async function login() {
    try {
      const nextSession = await apiLogin(loginUserId, pin)
      setLoginError('')
      setPin('')
      setBackendReady(false)
      setSession(nextSession)
      mutateState((current) => ({ ...current, activeUserId: nextSession.user.id }))
      if (nextSession.user.role === 'kitchen') setView('kitchen')
      if (nextSession.user.role === 'cashier') setView('checkout')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Falha ao entrar')
    }
  }

  async function createFirstAdmin() {
    if (!/^\d{4,12}$/.test(setupPin)) {
      setLoginError('O PIN deve ter de 4 a 12 digitos numericos')
      return
    }

    if (setupPin !== setupPinConfirm) {
      setLoginError('Os PINs informados nao conferem')
      return
    }

    try {
      const nextSession = await setupInitialAdmin(setupName, setupPin)
      setLoginError('')
      setSetupName('')
      setSetupPin('')
      setSetupPinConfirm('')
      setBackendReady(false)
      setSession(nextSession)
      mutateState((current) => ({ ...current, staff: [nextSession.user], activeUserId: nextSession.user.id }))
      setView('floor')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Falha ao criar administrador')
    }
  }

  function startTraining() {
    setTrainingMode(true)
    setTrainingStepIndex(0)
    setView(trainingSteps[0]?.view ?? 'manager')
  }

  function finishTraining() {
    setTrainingMode(false)
    setTrainingStepIndex(0)
    setView('floor')
  }

  function logout() {
    if (trainingMode) {
      finishTraining()
      return
    }

    if (session) {
      void apiLogout(session.token).catch((error: Error) => {
        console.error('Falha ao encerrar sessao', error)
      })
    }
    setSession(null)
    setBackendReady(false)
    mutateState((current) => ({ ...current, activeUserId: undefined }))
  }

  function resetDemo() {
    localStorage.removeItem(storageKey)
    setState({
      ...initialState,
      accessProfiles,
      staff: state.staff,
      activeUserId: session?.user.id,
    })
    setSelectedTableId(state.tables[0]?.id ?? '')
    setView('floor')
  }

  function selectTable(tableId: string, nextView: ViewKey = 'order') {
    setSelectedTableId(tableId)
    setView(nextView)
    setSelectedSeat('Mesa')
  }

  function openTable(tableId: string, guests = 2) {
    const table = displayState.tables.find((item) => item.id === tableId)
    const auditEvent = createAuditEvent('table.open', `Mesa ${table?.number ?? ''} aberta`, { tableId })

    commitOperation({ type: 'table.open', payload: { tableId, guests } }, (current) => ({
      ...appendAudit(current, auditEvent),
      tables: current.tables.map((tableItem) =>
        tableItem.id === tableId
          ? {
              ...tableItem,
              status: tableItem.status === 'free' ? 'seated' : tableItem.status,
              guestCount: tableItem.guestCount || Math.max(1, guests),
              serverId: activeUser?.id ?? tableItem.serverId,
              openedAt: tableItem.openedAt ?? timestamp(),
              lastActivityAt: timestamp(),
            }
          : tableItem,
      ),
    }))
    selectTable(tableId)
  }

  function setGuestCount(tableId: string, delta: number) {
    const table = displayState.tables.find((item) => item.id === tableId)
    const nextGuestCount = normalizeGuestCount((Number.isFinite(table?.guestCount) ? table?.guestCount ?? 1 : 1) + delta)
    commitOperation({ type: 'table.guests', payload: { tableId, guestCount: nextGuestCount } }, (current) => ({
      ...current,
      tables: current.tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              guestCount: normalizeGuestCount((Number.isFinite(table.guestCount) ? table.guestCount : 1) + delta),
              lastActivityAt: timestamp(),
            }
          : table,
      ),
    }))
  }

  function setGuestCountValue(tableId: string, value: number) {
    const guestCount = normalizeGuestCount(value)

    commitOperation({ type: 'table.guests', payload: { tableId, guestCount } }, (current) => ({
      ...current,
      tables: current.tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              guestCount,
              lastActivityAt: timestamp(),
            }
          : table,
      ),
    }))
  }

  function updateMenuItemNote(itemId: string, value: string) {
    setItemNotes((current) => ({ ...current, [itemId]: value }))
  }

  function appendMenuItemNote(itemId: string, value: string) {
    setItemNotes((current) => ({
      ...current,
      [itemId]: current[itemId]?.trim() ? `${current[itemId].trim()}; ${value}` : value,
    }))
  }

  function updateOrderNotes(orderId: string, value: string) {
    commitOperation({ type: 'order.notes', payload: { orderId, notes: value } }, (current) => ({
      ...current,
      orders: current.orders.map((order) =>
        order.id === orderId && order.status === 'draft'
          ? { ...order, notes: value, createdAt: order.createdAt }
          : order,
      ),
    }))
  }

  function addOrderItem(item: MenuItem, dishNotes = '') {
    if (!selectedTable || !item.available) return

    const auditEvent = createAuditEvent('order.add_item', `${item.name} adicionado a mesa ${selectedTable.number}`, {
      tableId: selectedTable.id,
      menuItemId: item.id,
      itemName: item.name,
    })
    const modifiers = item.modifierGroups.map((group) => `${group.name}: ${group.options[0]}`)
    const order: OrderItem = {
      id: uid('order'),
      tableId: selectedTable.id,
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      station: item.station,
      quantity: 1,
      unitPrice: item.price,
      seat: selectedSeat,
      notes: dishNotes.trim(),
      modifiers,
      status: 'draft',
      createdAt: timestamp(),
    }

    commitOperation(
      {
        type: 'order.create',
        payload: {
          id: order.id,
          tableId: selectedTable.id,
          menuItemId: item.id,
          seat: selectedSeat,
          notes: dishNotes.trim(),
          modifiers,
        },
      },
      (current) => ({
        ...appendAudit(current, auditEvent),
        tables: current.tables.map((table) =>
          table.id === selectedTable.id
            ? {
                ...table,
                status: 'ordering',
                guestCount: table.guestCount || 1,
                serverId: activeUser?.id ?? table.serverId,
                openedAt: table.openedAt ?? timestamp(),
                lastActivityAt: timestamp(),
              }
            : table,
        ),
        orders: [...current.orders, order],
      }),
    )
    setItemNotes((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
  }

  function updateQuantity(orderId: string, delta: number) {
    const order = displayState.orders.find((item) => item.id === orderId)
    const quantity = Math.max(0, (order?.quantity ?? 0) + delta)
    commitOperation({ type: 'order.quantity', payload: { orderId, quantity } }, (current) => ({
      ...current,
      orders: current.orders
        .map((order) =>
          order.id === orderId
            ? { ...order, quantity: Math.max(0, order.quantity + delta) }
            : order,
        )
        .filter((order) => order.quantity > 0),
    }))
  }

  function sendToKitchen() {
    if (!selectedTable || selectedPending.length === 0) return

    const auditEvent = createAuditEvent('order.send_kitchen', `Pedido enviado para cozinha na mesa ${selectedTable.number}`, {
      tableId: selectedTable.id,
      items: selectedPending.length,
    })
    commitOperation({ type: 'table.sendToKitchen', payload: { tableId: selectedTable.id } }, (current) => ({
      ...appendAudit(current, auditEvent),
      tables: current.tables.map((table) =>
        table.id === selectedTable.id ? { ...table, status: 'preparing', lastActivityAt: timestamp() } : table,
      ),
      orders: current.orders.map((order) =>
        order.tableId === selectedTable.id && order.status === 'draft'
          ? { ...order, status: 'sent', sentAt: timestamp() }
          : order,
      ),
    }))
    setView('kitchen')
  }

  function updateOrderStatus(orderId: string, status: OrderStatus) {
    const currentOrder = displayState.orders.find((item) => item.id === orderId)
    const currentTable = currentOrder
      ? displayState.tables.find((table) => table.id === currentOrder.tableId)
      : undefined
    const auditEvent = currentOrder
      ? createAuditEvent(
          'order.status',
          `${currentOrder.name} alterado para ${orderStatusLabel(status)}`,
          {
            tableId: currentOrder.tableId,
            orderId,
            tableNumber: currentTable?.number,
            itemName: currentOrder.name,
            status,
          },
        )
      : null

    commitOperation({ type: 'order.status', payload: { orderId, status } }, (current) => {
      const order = current.orders.find((item) => item.id === orderId)
      const timestampPatch =
        status === 'ready'
          ? { readyAt: timestamp() }
          : status === 'served'
            ? { servedAt: timestamp() }
            : {}

      const orders = current.orders.map((item) =>
        item.id === orderId ? { ...item, ...timestampPatch, status } : item,
      )

      const tableOrdersAfter = order ? orders.filter((item) => item.tableId === order.tableId) : []
      const allServed =
        tableOrdersAfter.length > 0 &&
        tableOrdersAfter.every((item) => ['served', 'cancelled'].includes(item.status))
      const anyReady = tableOrdersAfter.some((item) => item.status === 'ready')

      return {
        ...(auditEvent ? appendAudit(current, auditEvent) : current),
        orders,
        tables: current.tables.map((table) => {
          if (!order || table.id !== order.tableId) return table
          return {
            ...table,
            status: allServed ? 'served' : anyReady ? 'attention' : table.status,
            lastActivityAt: timestamp(),
          }
        }),
      }
    })
  }

  function cancelOrder(orderId: string) {
    if (!canPerform('cancelOrders')) return

    const order = displayState.orders.find((item) => item.id === orderId)
    if (!order) return

    const reason = window.prompt(`Motivo do cancelamento de "${order.name}"`)
    if (!reason?.trim()) return

    const table = displayState.tables.find((item) => item.id === order.tableId)
    const auditEvent = createAuditEvent('order.cancel', `${order.name} cancelado`, {
      tableId: order.tableId,
      orderId,
      tableNumber: table?.number,
      itemName: order.name,
      reason: reason.trim(),
    })

    commitOperation({ type: 'order.cancel', payload: { orderId, reason: reason.trim() } }, (current) => {
      const orders = current.orders.map((item) =>
        item.id === orderId
          ? {
              ...item,
              status: 'cancelled' as OrderStatus,
              cancelledAt: timestamp(),
              cancelledBy: activeUser?.id,
              cancelReason: reason.trim(),
            }
          : item,
      )
      const tableOrdersAfter = orders.filter((item) => item.tableId === order.tableId)
      const activeOrders = tableOrdersAfter.filter((item) => item.status !== 'cancelled')
      const allServed =
        activeOrders.length > 0 && activeOrders.every((item) => item.status === 'served')
      const anyReady = activeOrders.some((item) => item.status === 'ready')
      const anyPreparing = activeOrders.some((item) => ['sent', 'preparing'].includes(item.status))
      const anyDraft = activeOrders.some((item) => item.status === 'draft')

      return {
        ...appendAudit(current, auditEvent),
        orders,
        tables: current.tables.map((tableItem) => {
          if (tableItem.id !== order.tableId) return tableItem
          return {
            ...tableItem,
            status: allServed
              ? 'served'
              : anyReady
                ? 'attention'
                : anyPreparing
                  ? 'preparing'
                  : anyDraft
                    ? 'ordering'
                    : tableItem.status,
            lastActivityAt: timestamp(),
          }
        }),
      }
    })
  }

  function addServiceRequest(tableId: string, label: string, priority: 'normal' | 'high') {
    commitOperation({ type: 'request.create', payload: { tableId, label, priority } }, (current) => ({
      ...current,
      tables: current.tables.map((table) =>
        table.id === tableId ? { ...table, status: 'attention', lastActivityAt: timestamp() } : table,
      ),
      serviceRequests: [
        ...current.serviceRequests,
        {
          id: uid('request'),
          tableId,
          label,
          priority,
          resolved: false,
          createdAt: timestamp(),
        },
      ],
    }))
  }

  function resolveRequest(requestId: string) {
    commitOperation({ type: 'request.resolve', payload: { requestId } }, (current) => ({
      ...current,
      serviceRequests: current.serviceRequests.map((request) =>
        request.id === requestId ? { ...request, resolved: true } : request,
      ),
    }))
  }

  function moveToCheckout() {
    if (!selectedTable) return
    commitOperation({ type: 'table.checkout', payload: { tableId: selectedTable.id } }, (current) => ({
      ...current,
      tables: current.tables.map((table) =>
        table.id === selectedTable.id ? { ...table, status: 'checkout', lastActivityAt: timestamp() } : table,
      ),
    }))
    setView('checkout')
  }

  function addPayment() {
    if (!selectedTable) return
    if (!canPerform('registerPayments')) return
    const amount = paymentInput.trim() ? Number(paymentInput.replace(',', '.')) : selectedRemaining
    if (!Number.isFinite(amount) || amount <= 0) return

    const auditEvent = createAuditEvent('payment.add', `Pagamento registrado na mesa ${selectedTable.number}`, {
      tableId: selectedTable.id,
      amount: Math.min(amount, selectedRemaining || amount),
      method: paymentMethod,
    })
    commitOperation(
      {
        type: 'payment.create',
        payload: {
          tableId: selectedTable.id,
          amount: Math.min(amount, selectedRemaining || amount),
          method: paymentMethod,
        },
      },
      (current) => ({
        ...appendAudit(current, auditEvent),
        payments: [
          ...current.payments,
          {
            id: uid('pay'),
            tableId: selectedTable.id,
            amount: Math.min(amount, selectedRemaining || amount),
            method: paymentMethod,
            createdAt: timestamp(),
          },
        ],
      }),
    )
    setPaymentInput('')
  }

  function closeTable(tableId: string) {
    if (!canPerform('closeTables')) return
    const table = displayState.tables.find((item) => item.id === tableId)
    const auditEvent = createAuditEvent('table.close', `Mesa ${table?.number ?? ''} liberada`, { tableId })

    commitOperation({ type: 'table.close', payload: { tableId } }, (current) => ({
      ...appendAudit(current, auditEvent),
      tables: current.tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              status: 'free',
              guestCount: 0,
              serverId: undefined,
              openedAt: undefined,
              lastActivityAt: timestamp(),
            }
          : table,
      ),
      orders: current.orders.filter((order) => order.tableId !== tableId),
      payments: current.payments.filter((payment) => payment.tableId !== tableId),
      serviceRequests: current.serviceRequests.map((request) =>
        request.tableId === tableId ? { ...request, resolved: true } : request,
      ),
    }))
    setView('floor')
  }

  function addTable(table: RestaurantTable) {
    if (!canPerform('manageTables')) return

    const auditEvent = createAuditEvent('table.create', `Mesa ${table.number} cadastrada`, {
      tableId: table.id,
      tableNumber: table.number,
      zone: table.zone,
    })
    commitOperation({ type: 'table.create', payload: { table } }, (current) => ({
      ...appendAudit(current, auditEvent),
      tables: [...current.tables, table],
    }))
    setSelectedTableId(table.id)
  }

  function toggleAvailability(itemId: string) {
    if (!canPerform('manageProducts')) return

    const item = displayState.menu.find((menuItem) => menuItem.id === itemId)
    const auditEvent = createAuditEvent('menu.availability', `${item?.name ?? 'Produto'} alterado no cardapio`, {
      menuItemId: itemId,
      itemName: item?.name,
      available: item ? !item.available : undefined,
    })

    commitOperation({ type: 'menu.availability', payload: { itemId, available: item ? !item.available : undefined } }, (current) => ({
      ...appendAudit(current, auditEvent),
      menu: current.menu.map((item) =>
        item.id === itemId ? { ...item, available: !item.available } : item,
      ),
    }))
  }

  function addMenuItem(item: MenuItem) {
    if (!canPerform('manageProducts')) return

    const auditEvent = createAuditEvent('menu.create', `${item.name} cadastrado no cardapio`, {
      menuItemId: item.id,
      itemName: item.name,
      price: item.price,
    })
    commitOperation({ type: 'menu.create', payload: { item } }, (current) => ({
      ...appendAudit(current, auditEvent),
      menu: [...current.menu, item],
    }))
  }

  function updateMenuItem(itemId: string, nextItem: MenuItem) {
    if (!canPerform('manageProducts')) return

    const auditEvent = createAuditEvent('menu.update', `${nextItem.name} atualizado no cardapio`, {
      menuItemId: itemId,
      itemName: nextItem.name,
      price: nextItem.price,
    })
    commitOperation({ type: 'menu.update', payload: { itemId, item: nextItem } }, (current) => ({
      ...appendAudit(current, auditEvent),
      menu: current.menu.map((item) =>
        item.id === itemId
          ? {
              ...nextItem,
              id: item.id,
              pairingIds: item.pairingIds,
              modifierGroups: item.modifierGroups,
            }
          : item,
      ),
    }))
  }

  function addAccessProfile(profile: AccessProfile) {
    if (!canPerform('manageAccessProfiles')) return

    const auditEvent = createAuditEvent('access.create', `Tipo de acesso ${profile.name} criado`, {
      profileId: profile.id,
      profileName: profile.name,
    })
    commitOperation({ type: 'access.create', payload: { profile } }, (current) => ({
      ...appendAudit(current, auditEvent),
      accessProfiles: normalizeAccessProfiles([...(current.accessProfiles ?? []), profile]),
    }))
  }

  function updateAccessProfile(profileId: string, nextProfile: AccessProfile) {
    if (!canPerform('manageAccessProfiles')) return

    const auditEvent = createAuditEvent('access.update', `Tipo de acesso ${nextProfile.name} atualizado`, {
      profileId,
      profileName: nextProfile.name,
    })
    commitOperation({ type: 'access.update', payload: { profileId, profile: nextProfile } }, (current) => ({
      ...appendAudit(current, auditEvent),
      accessProfiles: normalizeAccessProfiles(current.accessProfiles).map((profile) =>
        profile.id === profileId && !profile.system
          ? {
              ...nextProfile,
              id: profile.id,
              system: false,
            }
          : profile,
      ),
    }))
  }

  function deleteAccessProfile(profileId: string) {
    if (!canPerform('manageAccessProfiles')) return

    const profile = accessProfiles.find((item) => item.id === profileId)
    const auditEvent = createAuditEvent('access.delete', `Tipo de acesso ${profile?.name ?? ''} excluido`, {
      profileId,
      profileName: profile?.name,
    })
    commitOperation({ type: 'access.delete', payload: { profileId } }, (current) => ({
      ...appendAudit(current, auditEvent),
      accessProfiles: normalizeAccessProfiles(current.accessProfiles).filter(
        (profile) => profile.system || profile.id !== profileId,
      ),
    }))
  }

  function updateIntegrationDraft(patch: Partial<IntegrationSettings>) {
    setIntegrations((current) => ({ ...current, ...patch }))
    setIntegrationMessage('')
  }

  function updateFiscalDraft(patch: Partial<FiscalSettings>) {
    setFiscal((current) => ({ ...current, ...patch }))
    setIntegrationMessage('')
  }

  async function persistIntegrations() {
    if (!session) return
    if (!canPerform('manageIntegrations')) return

    try {
      const saved = await saveIntegrations(session.token, integrations)
      setIntegrations(saved)
      setIntegrationMessage('Integracoes salvas no banco')
      const auditEvent = createAuditEvent('integrations.update', 'Integracoes atualizadas', {})
      mutateState((current) => appendAudit(current, auditEvent))
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : 'Falha ao salvar integracoes')
    }
  }

  async function runIntegrationTest(type: 'printer' | 'payments' | 'kds') {
    if (!session) return
    if (!canPerform('manageIntegrations')) return

    try {
      const result = await testIntegration(session.token, type)
      setIntegrationMessage(result.message)
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : 'Falha ao testar integracao')
    }
  }

  async function persistFiscal() {
    if (!session) return
    if (!canPerform('manageIntegrations')) return

    try {
      const saved = await saveFiscalSettings(session.token, fiscal)
      setFiscal(saved)
      setIntegrationMessage('Fiscal salvo no banco')
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : 'Falha ao salvar fiscal')
    }
  }

  async function runFiscalTest() {
    if (!session) return
    if (!canPerform('manageIntegrations')) return

    try {
      const result = await testFiscalSettings(session.token)
      setIntegrationMessage(result.message)
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : 'Falha ao testar fiscal')
    }
  }

  async function addStaffMember(input: { name: string; role: string; pin: string }) {
    if (!session) return
    try {
      const remoteState = await createStaff(session.token, input)
      applyRemoteState(remoteState)
      setSystemMessage('Operador criado.')
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : 'Falha ao criar operador')
    }
  }

  async function editStaffMember(staffId: string, patch: { name?: string; role?: string; active?: boolean }) {
    if (!session) return
    try {
      const remoteState = await updateStaff(session.token, staffId, patch)
      applyRemoteState(remoteState)
      setSystemMessage('Operador atualizado.')
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : 'Falha ao atualizar operador')
    }
  }

  async function changeStaffPin(staffId: string, pin: string) {
    if (!session) return
    try {
      const remoteState = await resetStaffPin(session.token, staffId, pin)
      applyRemoteState(remoteState)
      setSystemMessage('PIN atualizado.')
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : 'Falha ao atualizar PIN')
    }
  }

  if (!activeUser) {
    return (
      <LoginScreen
        staff={state.staff}
        accessProfiles={accessProfiles}
        selectedUserId={loginUserId}
        pin={pin}
        setupName={setupName}
        setupPin={setupPin}
        setupPinConfirm={setupPinConfirm}
        error={loginError}
        systemMessage={systemMessage}
        onSelectUser={setLoginUserId}
        onPin={setPin}
        onSetupName={setSetupName}
        onSetupPin={setSetupPin}
        onSetupPinConfirm={setSetupPinConfirm}
        onLogin={login}
        onCreateFirstAdmin={createFirstAdmin}
        onStartTraining={startTraining}
        onReset={resetDemo}
        canLogin={Boolean(loginUserId && pin)}
        canCreateFirstAdmin={Boolean(setupName.trim() && /^\d{4,12}$/.test(setupPin) && setupPin === setupPinConfirm)}
      />
    )
  }

  return (
    <div className={trainingMode ? 'app-shell training-active' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Utensils size={22} />
          </div>
          <div>
            <strong>MesaPro</strong>
            <span>Operacao de salao</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Navegacao principal">
          {accessibleViews.map((key) => {
            const config = viewConfig[key]
            const Icon = config.icon
            return (
              <button
                key={key}
                data-tour={`nav-${key}`}
                className={safeView === key ? 'nav-item active' : 'nav-item'}
                type="button"
                onClick={() => setView(key)}
              >
                <Icon size={18} />
                {config.label}
              </button>
            )
          })}
        </nav>

        <div className="operator">
          <div>
            <span>Operador</span>
            <strong>{activeUser.name}</strong>
            <small>{roleLabel(activeUser.role, accessProfiles)}</small>
          </div>
          <button className="icon-button" type="button" onClick={logout} title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <TopBar
          state={displayState}
          activeUser={activeUser}
          backendReady={backendReady}
          systemMessage={systemMessage}
          canReset={canPerform('resetOperationalData')}
          isOnline={isOnline}
          pendingSyncCount={queueSnapshot.pendingCount}
          syncMessage={syncMessage}
          syncing={syncing}
          canInstall={Boolean(installPrompt && !isStandalone)}
          onInstall={installApp}
          onSyncNow={syncNow}
          onReset={resetDemo}
        />

        {safeView === 'floor' && (
          <FloorView
            state={displayState}
            activeUser={activeUser}
            canManageTables={canPerform('manageTables')}
            selectedTableId={selectedTable?.id}
            onSelectTable={selectTable}
            onOpenTable={openTable}
            onCheckout={(tableId) => selectTable(tableId, 'checkout')}
            onAddTable={addTable}
            onResolveRequest={resolveRequest}
          />
        )}

        {safeView === 'order' && (
          selectedTable ? (
            <OrderView
              table={selectedTable}
              orders={selectedOrders}
              categories={categories}
              category={category}
              search={search}
              selectedSeat={selectedSeat}
              itemNotes={itemNotes}
              filteredMenu={filteredMenu}
              hasMenuProducts={displayState.menu.length > 0}
              suggestions={suggestions}
              onCategory={setCategory}
              onSearch={setSearch}
              onSeat={setSelectedSeat}
              onItemNote={updateMenuItemNote}
              onItemNotePreset={appendMenuItemNote}
              onAdd={addOrderItem}
              onQuantity={updateQuantity}
              onOrderNotes={updateOrderNotes}
              onGuestCount={setGuestCount}
              onGuestCountValue={setGuestCountValue}
              onSend={sendToKitchen}
              onStatus={updateOrderStatus}
              onCancel={cancelOrder}
              canCancelOrders={canPerform('cancelOrders')}
              canUpdateKitchenStatus={canPerform('updateKitchenStatus')}
              onRequest={addServiceRequest}
              onCheckout={moveToCheckout}
            />
          ) : (
            <WorkspaceEmpty
              icon={Utensils}
              title="Pedido sem mesa selecionada"
              meta="nenhuma mesa disponivel"
              description="Cadastre ou abra uma mesa no salao antes de lancar pedidos."
              actionLabel="Ir para o salao"
              onAction={() => setView('floor')}
            />
          )
        )}

        {safeView === 'kitchen' && (
          <KitchenView
            state={displayState}
            onStatus={updateOrderStatus}
            onCancel={cancelOrder}
            canCancelOrders={canPerform('cancelOrders')}
            canUpdateKitchenStatus={canPerform('updateKitchenStatus')}
            onSelectTable={selectTable}
          />
        )}

        {safeView === 'checkout' && (
          selectedTable ? (
            <CheckoutView
              state={displayState}
              table={selectedTable}
              orders={selectedOrders}
              paid={selectedPaid}
              remaining={selectedRemaining}
              subtotal={selectedSubtotal}
              total={selectedTotal}
              splitMode={splitMode}
              method={paymentMethod}
              paymentInput={paymentInput}
              canRegisterPayments={canPerform('registerPayments')}
              canCloseTables={canPerform('closeTables')}
              onSplitMode={setSplitMode}
              onMethod={setPaymentMethod}
              onPaymentInput={setPaymentInput}
              onAddPayment={addPayment}
              onCloseTable={closeTable}
            />
          ) : (
            <WorkspaceEmpty
              icon={ReceiptText}
              title="Conta sem mesa selecionada"
              meta="nenhuma mesa disponivel"
              description="Abra uma mesa no salao para registrar pagamentos e fechar a conta."
              actionLabel="Ir para o salao"
              onAction={() => setView('floor')}
            />
          )
        )}

        {safeView === 'manager' && (
          <ManagerView
            state={displayState}
            report={report}
            canManageAccessProfiles={canPerform('manageAccessProfiles')}
            canViewReports={canPerform('viewReports')}
            accessProfiles={accessProfiles}
            onSelectTable={selectTable}
            onAddAccessProfile={addAccessProfile}
            onUpdateAccessProfile={updateAccessProfile}
            onDeleteAccessProfile={deleteAccessProfile}
            onAddStaff={addStaffMember}
            onUpdateStaff={editStaffMember}
            onResetStaffPin={changeStaffPin}
          />
        )}

        {safeView === 'menu' && (
          <MenuView
            state={displayState}
            canManageProducts={canPerform('manageProducts')}
            onToggle={toggleAvailability}
            onAddProduct={addMenuItem}
            onUpdateProduct={updateMenuItem}
          />
        )}

        {safeView === 'integrations' && (
          <IntegrationsView
            settings={integrations}
            fiscal={fiscal}
            message={integrationMessage}
            canManageIntegrations={canPerform('manageIntegrations')}
            onChange={updateIntegrationDraft}
            onFiscalChange={updateFiscalDraft}
            onSave={persistIntegrations}
            onSaveFiscal={persistFiscal}
            onTest={runIntegrationTest}
            onTestFiscal={runFiscalTest}
          />
        )}
      </main>

      {trainingMode && (
        <TrainingOverlay
          currentIndex={trainingStepIndex}
          steps={trainingSteps}
          onBack={() => {
            const nextIndex = Math.max(0, trainingStepIndex - 1)
            setTrainingStepIndex(nextIndex)
            setView(trainingSteps[nextIndex]?.view ?? 'floor')
          }}
          onNext={() => {
            if (trainingStepIndex >= trainingSteps.length - 1) finishTraining()
            else {
              const nextIndex = trainingStepIndex + 1
              setTrainingStepIndex(nextIndex)
              setView(trainingSteps[nextIndex]?.view ?? 'floor')
            }
          }}
          onSkip={finishTraining}
        />
      )}
    </div>
  )
}

interface LoginScreenProps {
  staff: StaffMember[]
  accessProfiles: AccessProfile[]
  selectedUserId: string
  pin: string
  setupName: string
  setupPin: string
  setupPinConfirm: string
  error: string
  systemMessage: string
  onSelectUser: (id: string) => void
  onPin: (pin: string) => void
  onSetupName: (name: string) => void
  onSetupPin: (pin: string) => void
  onSetupPinConfirm: (pin: string) => void
  onLogin: () => void
  onCreateFirstAdmin: () => void
  onStartTraining: () => void
  onReset: () => void
  canLogin: boolean
  canCreateFirstAdmin: boolean
}

function LoginScreen({
  staff,
  accessProfiles,
  selectedUserId,
  pin,
  setupName,
  setupPin,
  setupPinConfirm,
  error,
  systemMessage,
  onSelectUser,
  onPin,
  onSetupName,
  onSetupPin,
  onSetupPinConfirm,
  onLogin,
  onCreateFirstAdmin,
  onStartTraining,
  onReset,
  canLogin,
  canCreateFirstAdmin,
}: LoginScreenProps) {
  const setupMode = staff.length === 0

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="brand large">
          <div className="brand-mark">
            <Utensils size={26} />
          </div>
          <div>
            <strong>MesaPro</strong>
            <span>Restaurante em tempo real</span>
          </div>
        </div>

        {setupMode ? (
          <div className="setup-card">
            <div>
              <strong>Primeiro acesso</strong>
              <span>Crie o administrador principal deste restaurante.</span>
            </div>

            <label className="field-label" htmlFor="setup-name">
              Nome do administrador
            </label>
            <input
              id="setup-name"
              className="full-input"
              value={setupName}
              onChange={(event) => onSetupName(event.target.value)}
              placeholder="Ex: Gerente responsavel"
            />

            <label className="field-label" htmlFor="setup-pin">
              PIN de acesso
            </label>
            <div className="login-row">
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  id="setup-pin"
                  type="password"
                  inputMode="numeric"
                  value={setupPin}
                  onChange={(event) => onSetupPin(event.target.value)}
                  placeholder="4 a 12 digitos"
                />
              </div>
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  type="password"
                  inputMode="numeric"
                  value={setupPinConfirm}
                  onChange={(event) => onSetupPinConfirm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canCreateFirstAdmin) onCreateFirstAdmin()
                  }}
                  placeholder="Confirmar PIN"
                />
              </div>
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={onCreateFirstAdmin}
              disabled={!canCreateFirstAdmin}
            >
              Criar administrador
            </button>
            <button className="secondary-button" type="button" onClick={onStartTraining}>
              Treinamento
            </button>
          </div>
        ) : (
          <>
            <div className="login-grid">
              {staff.map((member) => (
                <button
                  key={member.id}
                  className={selectedUserId === member.id ? 'staff-card active' : 'staff-card'}
                  type="button"
                  onClick={() => onSelectUser(member.id)}
                >
                  <strong>{member.name}</strong>
                  <span>{roleLabel(member.role, accessProfiles)}</span>
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="pin">
              PIN
            </label>
            <div className="login-row">
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(event) => onPin(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canLogin) onLogin()
                  }}
                  placeholder="Digite o PIN"
                />
              </div>
              <button className="primary-button" type="button" onClick={onLogin} disabled={!canLogin}>
                Entrar
              </button>
            </div>
            <button className="secondary-button" type="button" onClick={onStartTraining}>
              Treinamento
            </button>
          </>
        )}

        {error && <p className="form-error">{error}</p>}
        {systemMessage && <p className="system-note">{systemMessage}</p>}

        {!setupMode && (
          <button className="ghost-button" type="button" onClick={onReset}>
            Reiniciar dados
          </button>
        )}
      </section>
    </main>
  )
}

interface TopBarProps {
  state: AppState
  activeUser: StaffMember
  backendReady: boolean
  systemMessage: string
  canReset: boolean
  isOnline: boolean
  pendingSyncCount: number
  syncMessage: string
  syncing: boolean
  canInstall: boolean
  onInstall: () => void
  onSyncNow: () => void
  onReset: () => void
}

function TopBar({
  state,
  activeUser,
  backendReady,
  systemMessage,
  canReset,
  isOnline,
  pendingSyncCount,
  syncMessage,
  syncing,
  canInstall,
  onInstall,
  onSyncNow,
  onReset,
}: TopBarProps) {
  const activeTables = state.tables.filter((table) => table.status !== 'free').length
  const readyOrders = state.orders.filter((order) => order.status === 'ready').length
  const alerts = unreadRequests(state).length
  const syncLabel = !isOnline
    ? `Offline${pendingSyncCount ? `: ${pendingSyncCount}` : ''}`
    : pendingSyncCount
      ? `${pendingSyncCount} pendente`
      : 'Sincronizado'

  return (
    <header className="topbar">
      <div>
        <span className="eyebrow">Turno ativo</span>
        <h1>{activeUser.role === 'kitchen' ? 'Fila da cozinha' : 'Controle de mesas'}</h1>
      </div>
      <div className="topbar-actions">
        <StatusPill icon={Table2} label={`${activeTables} mesas`} />
        <StatusPill icon={ChefHat} label={`${readyOrders} prontos`} />
        <StatusPill icon={Bell} label={`${alerts} chamados`} tone={alerts ? 'danger' : undefined} />
        <StatusPill
          icon={Server}
          label={backendReady ? 'Banco online' : systemMessage || 'Conectando'}
          tone={!backendReady ? 'danger' : undefined}
        />
        <div className="sync-status" data-tour="offline-sync">
          <StatusPill
            icon={isOnline ? Wifi : WifiOff}
            label={syncing ? 'Sincronizando' : syncLabel}
            tone={!isOnline || pendingSyncCount ? 'danger' : undefined}
          />
          {syncMessage && <span className="sync-note">{syncMessage}</span>}
          {pendingSyncCount > 0 && isOnline && (
            <button className="ghost-button compact" type="button" onClick={onSyncNow} disabled={syncing}>
              <RefreshCw size={16} />
              Sincronizar
            </button>
          )}
        </div>
        {canInstall && (
          <button className="ghost-button compact" type="button" onClick={onInstall}>
            <Download size={16} />
            Instalar
          </button>
        )}
        {canReset && (
          <button className="ghost-button compact" type="button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </header>
  )
}

function StatusPill({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Table2
  label: string
  tone?: 'danger'
}) {
  return (
    <span className={tone === 'danger' ? 'status-pill danger' : 'status-pill'}>
      <Icon size={16} />
      {label}
    </span>
  )
}

interface FloorViewProps {
  state: AppState
  activeUser: StaffMember
  canManageTables: boolean
  selectedTableId?: string
  onSelectTable: (tableId: string, view?: ViewKey) => void
  onOpenTable: (tableId: string) => void
  onCheckout: (tableId: string) => void
  onAddTable: (table: RestaurantTable) => void
  onResolveRequest: (requestId: string) => void
}

interface TableDraft {
  number: string
  zone: string
  seats: string
}

function nextTableNumber(tables: RestaurantTable[]) {
  return String(tables.reduce((highest, table) => Math.max(highest, table.number), 0) + 1)
}

function FloorView({
  state,
  activeUser,
  canManageTables,
  selectedTableId,
  onSelectTable,
  onOpenTable,
  onCheckout,
  onAddTable,
  onResolveRequest,
}: FloorViewProps) {
  const [draft, setDraft] = useState<TableDraft>(() => ({
    number: nextTableNumber(state.tables),
    zone: 'Salao principal',
    seats: '4',
  }))
  const [formMessage, setFormMessage] = useState('')
  const zones = Array.from(new Set(state.tables.map((table) => table.zone)))
  const requests = unreadRequests(state)

  function updateDraft(patch: Partial<TableDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setFormMessage('')
  }

  function submitTable() {
    const number = Number(draft.number)
    const seats = Number(draft.seats)
    const zone = draft.zone.trim()

    if (!Number.isInteger(number) || number <= 0) {
      setFormMessage('Informe um numero de mesa valido')
      return
    }

    if (!zone) {
      setFormMessage('Informe o setor da mesa')
      return
    }

    if (!Number.isInteger(seats) || seats <= 0) {
      setFormMessage('Informe a capacidade da mesa')
      return
    }

    if (state.tables.some((table) => table.number === number)) {
      setFormMessage('Ja existe uma mesa com este numero')
      return
    }

    onAddTable({
      id: uid('table'),
      number,
      seats,
      guestCount: 0,
      zone,
      status: 'free',
      lastActivityAt: timestamp(),
    })

    setDraft({
      number: String(number + 1),
      zone,
      seats: String(seats),
    })
    setFormMessage('Mesa cadastrada no salao')
  }

  return (
    <div className="content-grid floor-layout">
      <section className="main-panel" data-tour="floor-map">
        <PanelHeader
          title="Mapa do salao"
          meta={`${state.tables.length} mesas cadastradas`}
          icon={Table2}
        />
        <div className="zone-stack">
          {zones.length === 0 && <EmptyState icon={Table2} title="Nenhuma mesa cadastrada" />}
          {zones.map((zone) => (
            <div className="zone-section" key={zone}>
              <div className="zone-title">{zone}</div>
              <div className="table-grid">
                {state.tables
                  .filter((table) => table.zone === zone)
                  .map((table) => (
                    <TableCard
                      key={table.id}
                      table={table}
                      state={state}
                      selected={selectedTableId === table.id}
                      onOpen={() => onOpenTable(table.id)}
                      onOrder={() => onSelectTable(table.id, 'order')}
                      onCheckout={() => onCheckout(table.id)}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="side-panel">
        {canManageTables && (
          <div className="table-setup-card" data-tour="table-create">
            <PanelHeader title="Cadastrar mesa" meta="salao" icon={Table2} />
            <div className="table-setup-form">
              <div className="form-grid two">
                <div>
                  <label className="field-label" htmlFor="table-number">
                    Numero
                  </label>
                  <input
                    id="table-number"
                    data-tour="table-number"
                    className="full-input"
                    value={draft.number}
                    onChange={(event) => updateDraft({ number: event.target.value })}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="table-seats">
                    Capacidade
                  </label>
                  <input
                    id="table-seats"
                    data-tour="table-seats"
                    className="full-input"
                    value={draft.seats}
                    onChange={(event) => updateDraft({ seats: event.target.value })}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <label className="field-label" htmlFor="table-zone">
                Setor
              </label>
              <input
                id="table-zone"
                data-tour="table-zone"
                className="full-input"
                value={draft.zone}
                onChange={(event) => updateDraft({ zone: event.target.value })}
                placeholder="Ex: Salao principal, Varanda, Area externa"
              />

              {formMessage && <p className="system-note">{formMessage}</p>}
              <button className="primary-button" type="button" onClick={submitTable} data-tour="table-save">
                <Plus size={17} />
                Cadastrar mesa
              </button>
            </div>
          </div>
        )}

        <PanelHeader title="Fila de atencao" meta={activeUser.name} icon={Bell} />
        <div className="request-list">
          {requests.length === 0 && <EmptyState icon={BadgeCheck} title="Nenhum chamado aberto" />}
          {requests.map((request) => {
            const table = state.tables.find((item) => item.id === request.tableId)
            return (
              <div className="request-item" key={request.id}>
                <div>
                  <span className={request.priority === 'high' ? 'priority high' : 'priority'}>
                    Mesa {table?.number}
                  </span>
                  <strong>{request.label}</strong>
                  <small>{minutesSince(request.createdAt)} min</small>
                </div>
                <button className="icon-button" type="button" onClick={() => onResolveRequest(request.id)}>
                  <Check size={17} />
                </button>
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

function TableCard({
  table,
  state,
  selected,
  onOpen,
  onOrder,
  onCheckout,
}: {
  table: RestaurantTable
  state: AppState
  selected: boolean
  onOpen: () => void
  onOrder: () => void
  onCheckout: () => void
}) {
  const subtotal = tableSubtotal(state, table.id)
  const alert = getTableAlert(state, table)
  const server = state.staff.find((staffMember) => staffMember.id === table.serverId)
  const pending = tableOrders(state, table.id).filter((order) =>
    ['draft', 'sent', 'preparing', 'ready'].includes(order.status),
  ).length

  return (
    <article className={selected ? 'table-card selected' : 'table-card'} data-tour="table-card">
      <div className="table-head">
        <div>
          <span className="table-number">Mesa {table.number}</span>
          <span className={statusClass(table.status)}>{statusLabel(table.status)}</span>
        </div>
        {alert && <AlertTriangle className="alert-icon" size={19} />}
      </div>
      <div className="table-body">
        <div>
          <span>Pessoas</span>
          <strong>{table.guestCount || 0}</strong>
        </div>
        <div>
          <span>Tempo</span>
          <strong>{table.openedAt ? `${minutesSince(table.openedAt)} min` : '-'}</strong>
        </div>
        <div>
          <span>Conta</span>
          <strong>{currency.format(subtotal)}</strong>
        </div>
        <div>
          <span>Itens</span>
          <strong>{pending}</strong>
        </div>
      </div>
      <div className="table-meta">
        <span>{server?.name ?? 'Sem garcom'}</span>
        {alert && <strong>{alert}</strong>}
      </div>
      <div className="button-row">
        {table.status === 'free' ? (
          <button className="primary-button small" type="button" onClick={onOpen} data-tour="table-open">
            <Plus size={16} />
            Abrir
          </button>
        ) : (
          <>
            <button className="secondary-button small" type="button" onClick={onOrder}>
              <Utensils size={16} />
              Pedido
            </button>
            <button className="ghost-button small" type="button" onClick={onCheckout}>
              <ReceiptText size={16} />
              Conta
            </button>
          </>
        )}
      </div>
    </article>
  )
}

interface OrderViewProps {
  table: RestaurantTable
  orders: OrderItem[]
  categories: string[]
  category: string
  search: string
  selectedSeat: string
  itemNotes: Record<string, string>
  filteredMenu: MenuItem[]
  hasMenuProducts: boolean
  suggestions: MenuItem[]
  onCategory: (category: string) => void
  onSearch: (search: string) => void
  onSeat: (seat: string) => void
  onItemNote: (itemId: string, value: string) => void
  onItemNotePreset: (itemId: string, value: string) => void
  onAdd: (item: MenuItem, dishNotes?: string) => void
  onQuantity: (orderId: string, delta: number) => void
  onOrderNotes: (orderId: string, value: string) => void
  onGuestCount: (tableId: string, delta: number) => void
  onGuestCountValue: (tableId: string, value: number) => void
  onSend: () => void
  onStatus: (orderId: string, status: OrderStatus) => void
  onCancel: (orderId: string) => void
  canCancelOrders: boolean
  canUpdateKitchenStatus: boolean
  onRequest: (tableId: string, label: string, priority: 'normal' | 'high') => void
  onCheckout: () => void
}

function OrderView({
  table,
  orders,
  categories,
  category,
  search,
  selectedSeat,
  itemNotes,
  filteredMenu,
  hasMenuProducts,
  suggestions,
  onCategory,
  onSearch,
  onSeat,
  onItemNote,
  onItemNotePreset,
  onAdd,
  onQuantity,
  onOrderNotes,
  onGuestCount,
  onGuestCountValue,
  onSend,
  onStatus,
  onCancel,
  canCancelOrders,
  canUpdateKitchenStatus,
  onRequest,
  onCheckout,
}: OrderViewProps) {
  const seats = ['Mesa', ...Array.from({ length: Math.max(table.guestCount, 1) }, (_, index) => `Pessoa ${index + 1}`)]
  const pending = orders.filter((order) => order.status === 'draft')
  const subtotal = orderSubtotal(orders)

  return (
    <div className="content-grid order-layout">
      <section className="main-panel">
        <PanelHeader
          title={`Mesa ${table.number}`}
          meta={`${table.zone} - ${statusLabel(table.status)}`}
          icon={Utensils}
        >
          <div className="stepper" data-tour="guest-count">
            <button type="button" onClick={() => onGuestCount(table.id, -1)} title="Reduzir pessoas">
              <Minus size={16} />
            </button>
            <input
              aria-label="Quantidade de pessoas"
              min={1}
              type="number"
              inputMode="numeric"
              value={table.guestCount || 1}
              onChange={(event) => onGuestCountValue(table.id, Number(event.target.value))}
            />
            <span>pessoas</span>
            <button type="button" onClick={() => onGuestCount(table.id, 1)} title="Aumentar pessoas">
              <Plus size={16} />
            </button>
          </div>
        </PanelHeader>

        <div className="order-controls">
          <div className="input-with-icon" data-tour="menu-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Buscar item, tag ou descricao"
            />
          </div>
          <div className="segmented" data-tour="category-filter">
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? 'active' : ''}
                type="button"
                onClick={() => onCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="seat-row" data-tour="seat-selector">
          {seats.map((seat) => (
            <button
              key={seat}
              className={selectedSeat === seat ? 'seat-chip active' : 'seat-chip'}
              type="button"
              onClick={() => onSeat(seat)}
            >
              {seat}
            </button>
          ))}
        </div>

        {suggestions.length > 0 && (
          <section className="upsell-strip" aria-label="Sugestoes">
            <div>
              <Sparkles size={18} />
              <strong>Sugestoes para vender mais</strong>
            </div>
            {suggestions.map((item) => (
              <button key={item.id} type="button" onClick={() => onAdd(item)}>
                {item.name}
                <span>{currency.format(item.price)}</span>
              </button>
            ))}
          </section>
        )}

        <div className="menu-grid">
          {filteredMenu.length === 0 && (
            <EmptyState
              icon={Search}
              title={hasMenuProducts ? 'Nenhum produto nesta busca' : 'Nenhum produto cadastrado no cardapio'}
            />
          )}
          {filteredMenu.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              note={itemNotes[item.id] ?? ''}
              onNote={onItemNote}
              onNotePreset={onItemNotePreset}
              onAdd={onAdd}
            />
          ))}
        </div>
      </section>

      <aside className="side-panel order-ticket" data-tour="order-ticket">
        <PanelHeader title="Comanda" meta={currency.format(subtotal)} icon={ReceiptText} />
        <div className="order-list">
          {orders.length === 0 && <EmptyState icon={Utensils} title="Sem itens na mesa" />}
          {orders.map((order) => (
            <div className="order-row" key={order.id}>
              <div>
                <strong>{order.name}</strong>
                <span>
                  {order.seat} - {stationLabel(order.station)}
                </span>
                {order.modifiers.length > 0 && <small>{order.modifiers.join(' | ')}</small>}
                {order.status === 'draft' ? (
                  <textarea
                    aria-label={`Observacao de ${order.name}`}
                    className="order-note-input"
                    value={order.notes}
                    onChange={(event) => onOrderNotes(order.id, event.target.value)}
                    placeholder="Observacao deste item"
                  />
                ) : (
                  order.notes && <small>Obs: {order.notes}</small>
                )}
              </div>
              <div className="order-actions">
                <span className={`order-status status-${order.status}`}>{orderStatusLabel(order.status)}</span>
                {order.status === 'draft' ? (
                  <div className="quantity">
                    <button type="button" onClick={() => onQuantity(order.id, -1)}>
                      <Minus size={14} />
                    </button>
                    <strong>{order.quantity}</strong>
                    <button type="button" onClick={() => onQuantity(order.id, 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="line-total">{currency.format(order.quantity * order.unitPrice)}</span>
                )}
                {order.status === 'ready' && canUpdateKitchenStatus && (
                  <button className="secondary-button small" type="button" onClick={() => onStatus(order.id, 'served')}>
                    Entregar
                  </button>
                )}
                {canCancelOrders && !['served', 'cancelled'].includes(order.status) && (
                  <button className="danger-button small" type="button" onClick={() => onCancel(order.id)}>
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="quick-actions" data-tour="quick-actions">
          <button type="button" onClick={() => onRequest(table.id, 'Cliente pediu atendimento', 'high')}>
            <Bell size={16} />
            Chamada
          </button>
          <button type="button" onClick={() => onRequest(table.id, 'Agua na mesa', 'normal')}>
            <WalletCards size={16} />
            Agua
          </button>
          <button type="button" onClick={() => onRequest(table.id, 'Solicitar conta', 'normal')}>
            <ReceiptText size={16} />
            Conta
          </button>
        </div>

        <div className="ticket-footer">
          <button className="primary-button" type="button" onClick={onSend} disabled={pending.length === 0} data-tour="send-kitchen">
            <Send size={17} />
            Enviar {pending.length ? `(${pending.length})` : ''}
          </button>
          <button className="secondary-button" type="button" onClick={onCheckout}>
            <CreditCard size={17} />
            Fechar conta
          </button>
        </div>
      </aside>
    </div>
  )
}

function MenuItemCard({
  item,
  note,
  onNote,
  onNotePreset,
  onAdd,
}: {
  item: MenuItem
  note: string
  onNote: (itemId: string, value: string) => void
  onNotePreset: (itemId: string, value: string) => void
  onAdd: (item: MenuItem, dishNotes?: string) => void
}) {
  return (
    <article className={item.available ? 'menu-item' : 'menu-item unavailable'}>
      <div className="menu-item-top">
        <div>
          <strong>{item.name}</strong>
          <span>{item.description}</span>
        </div>
        <b>{currency.format(item.price)}</b>
      </div>
      <div className="tag-row">
        <span>{stationLabel(item.station)}</span>
        <span>{item.prepMinutes} min</span>
        {item.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {item.allergens.length > 0 && (
        <div className="allergen">
          <AlertTriangle size={14} />
          {item.allergens.join(', ')}
        </div>
      )}
      <label className="field-label compact" htmlFor={`note-${item.id}`}>
        Observacoes do prato
      </label>
      <textarea
        id={`note-${item.id}`}
        data-tour="dish-notes"
        className="dish-note-input"
        value={note}
        onChange={(event) => onNote(item.id, event.target.value)}
        placeholder="Ex: sem cebola, sem molho, ponto da carne"
        disabled={!item.available}
      />
      <div className="note-presets" data-tour="dish-note-presets">
        {dishNotePresets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onNotePreset(item.id, preset)}
            disabled={!item.available}
          >
            {preset}
          </button>
        ))}
      </div>
      <button
        className="primary-button small"
        type="button"
        onClick={() => onAdd(item, note)}
        disabled={!item.available}
        data-tour="dish-add"
      >
        <Plus size={16} />
        Adicionar
      </button>
    </article>
  )
}

function KitchenView({
  state,
  onStatus,
  onCancel,
  canCancelOrders,
  canUpdateKitchenStatus,
  onSelectTable,
}: {
  state: AppState
  onStatus: (orderId: string, status: OrderStatus) => void
  onCancel: (orderId: string) => void
  canCancelOrders: boolean
  canUpdateKitchenStatus: boolean
  onSelectTable: (tableId: string, view?: ViewKey) => void
}) {
  const tickets = state.orders.filter((order) => ['sent', 'preparing', 'ready'].includes(order.status))
  const grouped = ['bar', 'cold', 'grill', 'pass', 'dessert'].map((station) => ({
    station,
    orders: tickets.filter((order) => order.station === station),
  }))

  return (
    <section className="main-panel full">
      <PanelHeader title="KDS cozinha" meta={`${tickets.length} itens ativos`} icon={ChefHat} />
      <div className="kitchen-board" data-tour="kitchen-board">
        {grouped.map((group) => (
          <div className="kitchen-lane" key={group.station}>
            <h2>{stationLabel(group.station)}</h2>
            {group.orders.length === 0 && <EmptyState icon={BadgeCheck} title="Fila limpa" compact />}
            {group.orders.map((order) => {
              const table = state.tables.find((item) => item.id === order.tableId)
              const elapsed = minutesSince(order.sentAt ?? order.createdAt)
              return (
                <article className={`ticket-card status-${order.status}`} key={order.id} data-tour="kitchen-ticket">
                  <div className="ticket-head">
                    <strong>Mesa {table?.number}</strong>
                    <span>{elapsed} min</span>
                  </div>
                  <h3>{order.quantity}x {order.name}</h3>
                  <p>{order.seat}</p>
                  {order.modifiers.length > 0 && <small>{order.modifiers.join(' | ')}</small>}
                  {order.notes && <small>{order.notes}</small>}
                  <div className="button-row">
                    {order.status === 'sent' && canUpdateKitchenStatus && (
                      <button className="secondary-button small" type="button" onClick={() => onStatus(order.id, 'preparing')} data-tour="kitchen-status">
                        Iniciar
                      </button>
                    )}
                    {order.status !== 'ready' && canUpdateKitchenStatus && (
                      <button className="primary-button small" type="button" onClick={() => onStatus(order.id, 'ready')} data-tour="kitchen-status">
                        Pronto
                      </button>
                    )}
                    {order.status === 'ready' && canUpdateKitchenStatus && (
                      <button className="primary-button small" type="button" onClick={() => onStatus(order.id, 'served')}>
                        Saiu
                      </button>
                    )}
                    {canCancelOrders && (
                      <button className="danger-button small" type="button" onClick={() => onCancel(order.id)}>
                        Cancelar
                      </button>
                    )}
                    <button className="icon-button" type="button" onClick={() => onSelectTable(order.tableId, 'order')} title="Ver mesa">
                      <Eye size={16} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

interface CheckoutViewProps {
  state: AppState
  table: RestaurantTable
  orders: OrderItem[]
  paid: number
  remaining: number
  subtotal: number
  total: number
  splitMode: 'total' | 'person' | 'items'
  method: PaymentMethod
  paymentInput: string
  canRegisterPayments: boolean
  canCloseTables: boolean
  onSplitMode: (mode: 'total' | 'person' | 'items') => void
  onMethod: (method: PaymentMethod) => void
  onPaymentInput: (value: string) => void
  onAddPayment: () => void
  onCloseTable: (tableId: string) => void
}

function CheckoutView({
  state,
  table,
  orders,
  paid,
  remaining,
  subtotal,
  total,
  splitMode,
  method,
  paymentInput,
  canRegisterPayments,
  canCloseTables,
  onSplitMode,
  onMethod,
  onPaymentInput,
  onAddPayment,
  onCloseTable,
}: CheckoutViewProps) {
  const seats = Array.from(new Set(orders.map((order) => order.seat)))
  const canClose = remaining <= 0.01 && orders.length > 0

  return (
    <div className="content-grid checkout-layout">
      <section className="main-panel">
        <PanelHeader title={`Conta mesa ${table.number}`} meta={`${orders.length} itens`} icon={ReceiptText} />
        <div className="segmented fit" data-tour="split-mode">
          <button className={splitMode === 'total' ? 'active' : ''} type="button" onClick={() => onSplitMode('total')}>
            Total
          </button>
          <button className={splitMode === 'person' ? 'active' : ''} type="button" onClick={() => onSplitMode('person')}>
            Por pessoa
          </button>
          <button className={splitMode === 'items' ? 'active' : ''} type="button" onClick={() => onSplitMode('items')}>
            Por item
          </button>
        </div>

        {splitMode === 'total' && (
          <div className="bill-list">
            {orders.map((order) => (
              <BillLine key={order.id} order={order} />
            ))}
          </div>
        )}

        {splitMode === 'person' && (
          <div className="split-grid">
            {seats.map((seat) => {
              const seatOrders = orders.filter((order) => order.seat === seat)
              const seatSubtotal = orderSubtotal(seatOrders)
              return (
                <article className="split-card" key={seat}>
                  <strong>{seat}</strong>
                  <span>{seatOrders.length} itens</span>
                  <b>{currency.format(seatSubtotal + serviceFee(seatSubtotal))}</b>
                </article>
              )
            })}
          </div>
        )}

        {splitMode === 'items' && (
          <div className="bill-list compact-lines">
            {orders.map((order) => (
              <BillLine key={order.id} order={order} showSeat />
            ))}
          </div>
        )}
      </section>

      <aside className="side-panel">
        <PanelHeader title="Pagamento" meta={currency.format(remaining)} icon={CreditCard} />
        <div className="total-box">
          <div>
            <span>Subtotal</span>
            <strong>{currency.format(subtotal)}</strong>
          </div>
          <div>
            <span>Servico 10%</span>
            <strong>{currency.format(serviceFee(subtotal))}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{currency.format(total)}</strong>
          </div>
          <div>
            <span>Pago</span>
            <strong>{currency.format(paid)}</strong>
          </div>
        </div>

        <div className="payment-methods" data-tour="payment-method">
          {(Object.keys(paymentLabels) as PaymentMethod[]).map((key) => (
            <button
              key={key}
              className={method === key ? 'active' : ''}
              type="button"
              onClick={() => onMethod(key)}
            >
              {paymentLabels[key]}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="payment">
          Valor
        </label>
        <input
          id="payment"
          data-tour="payment-value"
          className="full-input"
          value={paymentInput}
          onChange={(event) => onPaymentInput(event.target.value)}
          inputMode="decimal"
        />

        <button
          className="primary-button"
          type="button"
          onClick={onAddPayment}
          disabled={!canRegisterPayments || remaining <= 0}
          data-tour="add-payment"
        >
          <CreditCard size={17} />
          Registrar pagamento
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onCloseTable(table.id)}
          disabled={!canCloseTables || !canClose}
          data-tour="release-table"
        >
          <DoorOpen size={17} />
          Liberar mesa
        </button>

        <div className="payment-history">
          {state.payments
            .filter((payment) => payment.tableId === table.id)
            .map((payment) => (
              <div key={payment.id}>
                <span>{paymentLabels[payment.method]}</span>
                <strong>{currency.format(payment.amount)}</strong>
              </div>
            ))}
        </div>
      </aside>
    </div>
  )
}

function BillLine({ order, showSeat }: { order: OrderItem; showSeat?: boolean }) {
  return (
    <div className="bill-line">
      <div>
        <strong>{order.quantity}x {order.name}</strong>
        <span>{showSeat ? order.seat : orderStatusLabel(order.status)}</span>
      </div>
      <b>{currency.format(order.quantity * order.unitPrice)}</b>
    </div>
  )
}

interface StaffDraft {
  name: string
  role: string
  pin: string
}

interface AccessProfileDraft {
  name: string
  permissions: ViewKey[]
  actions: ActionPermission[]
}

function ManagerView({
  state,
  report,
  canManageAccessProfiles,
  canViewReports,
  accessProfiles,
  onSelectTable,
  onAddAccessProfile,
  onUpdateAccessProfile,
  onDeleteAccessProfile,
  onAddStaff,
  onUpdateStaff,
  onResetStaffPin,
}: {
  state: AppState
  report: ReportSummary | null
  canManageAccessProfiles: boolean
  canViewReports: boolean
  accessProfiles: AccessProfile[]
  onSelectTable: (tableId: string, view?: ViewKey) => void
  onAddAccessProfile: (profile: AccessProfile) => void
  onUpdateAccessProfile: (profileId: string, profile: AccessProfile) => void
  onDeleteAccessProfile: (profileId: string) => void
  onAddStaff: (input: { name: string; role: string; pin: string }) => void
  onUpdateStaff: (staffId: string, patch: { name?: string; role?: string; active?: boolean }) => void
  onResetStaffPin: (staffId: string, pin: string) => void
}) {
  const [accessDraft, setAccessDraft] = useState<AccessProfileDraft>({
    name: '',
    permissions: ['floor'],
    actions: [],
  })
  const [staffDraft, setStaffDraft] = useState<StaffDraft>({
    name: '',
    role: 'waiter',
    pin: '',
  })
  const [staffMessage, setStaffMessage] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [accessMessage, setAccessMessage] = useState('')
  const editingProfile = accessProfiles.find((profile) => profile.id === editingProfileId)
  const activeTables = state.tables.filter((table) => table.status !== 'free')
  const revenue = state.tables.reduce((total, table) => total + tableSubtotal(state, table.id), 0)
  const avgTicket = activeTables.length ? revenue / activeTables.length : 0
  const ready = state.orders.filter((order) => order.status === 'ready').length
  const delayed = state.orders.filter(
    (order) => ['sent', 'preparing'].includes(order.status) && minutesSince(order.sentAt ?? order.createdAt) > 20,
  ).length
  const topItems = Array.from(new Set(state.orders.map((order) => order.menuItemId)))
    .map((id) => {
      const itemOrders = state.orders.filter((order) => order.menuItemId === id)
      return {
        name: itemOrders[0]?.name ?? 'Item',
        quantity: itemOrders.reduce((total, order) => total + order.quantity, 0),
        revenue: itemOrders.reduce((total, order) => total + order.quantity * order.unitPrice, 0),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  function updateAccessDraft(patch: Partial<AccessProfileDraft>) {
    setAccessDraft((current) => ({ ...current, ...patch }))
    setAccessMessage('')
  }

  function updateStaffDraft(patch: Partial<StaffDraft>) {
    setStaffDraft((current) => ({ ...current, ...patch }))
    setStaffMessage('')
  }

  function submitStaff() {
    const name = staffDraft.name.trim()
    const pin = staffDraft.pin.trim()
    if (!name) {
      setStaffMessage('Informe o nome do operador')
      return
    }
    if (!/^\d{4,12}$/.test(pin)) {
      setStaffMessage('PIN deve ter de 4 a 12 digitos')
      return
    }
    onAddStaff({ name, role: staffDraft.role, pin })
    setStaffDraft({ name: '', role: staffDraft.role, pin: '' })
    setStaffMessage('Operador enviado para cadastro')
  }

  function resetOperatorPin(member: StaffMember) {
    const pin = window.prompt(`Novo PIN para ${member.name}`)
    if (!pin) return
    if (!/^\d{4,12}$/.test(pin)) {
      setStaffMessage('PIN deve ter de 4 a 12 digitos')
      return
    }
    onResetStaffPin(member.id, pin)
    setStaffMessage('PIN enviado para atualizacao')
  }

  function toggleDraftPermission(permission: ViewKey) {
    setAccessDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }))
    setAccessMessage('')
  }

  function toggleDraftAction(action: ActionPermission) {
    setAccessDraft((current) => ({
      ...current,
      actions: current.actions.includes(action)
        ? current.actions.filter((item) => item !== action)
        : [...current.actions, action],
    }))
    setAccessMessage('')
  }

  function resetAccessForm(message = '') {
    setAccessDraft({ name: '', permissions: ['floor'], actions: [] })
    setEditingProfileId(null)
    setAccessMessage(message)
  }

  function startEditingAccessProfile(profile: AccessProfile) {
    if (profile.system) return
    setEditingProfileId(profile.id)
    setAccessDraft({
      name: profile.name,
      permissions: profile.permissions,
      actions: profile.actions ?? [],
    })
    setAccessMessage('')
  }

  function submitAccessProfile() {
    const name = accessDraft.name.trim()
    if (!name) {
      setAccessMessage('Informe o nome do tipo de acesso')
      return
    }

    if (accessDraft.permissions.length === 0) {
      setAccessMessage('Selecione pelo menos uma permissao')
      return
    }

    const duplicate = accessProfiles.some(
      (profile) =>
        profile.id !== editingProfileId &&
        profile.name.trim().toLowerCase() === name.toLowerCase(),
    )

    if (duplicate) {
      setAccessMessage('Ja existe um tipo de acesso com este nome')
      return
    }

    const nextProfile: AccessProfile = {
      id: editingProfile?.id ?? uid('access'),
      name,
      permissions: accessDraft.permissions,
      actions: accessDraft.actions,
      system: false,
    }

    if (editingProfileId) {
      onUpdateAccessProfile(editingProfileId, nextProfile)
      resetAccessForm('Tipo de acesso atualizado')
      return
    }

    onAddAccessProfile(nextProfile)
    resetAccessForm('Tipo de acesso criado')
  }

  function deleteProfile(profile: AccessProfile) {
    if (profile.system) {
      setAccessMessage('Perfis padrao do sistema nao podem ser excluidos')
      return
    }

    if (state.staff.some((member) => member.role === profile.id)) {
      setAccessMessage('Este tipo de acesso esta em uso por um operador')
      return
    }

    if (!window.confirm(`Excluir o tipo de acesso "${profile.name}"?`)) return

    onDeleteAccessProfile(profile.id)
    if (editingProfileId === profile.id) resetAccessForm('Tipo de acesso excluido')
    else setAccessMessage('Tipo de acesso excluido')
  }

  return (
    <div className="manager-view">
      {canViewReports ? (
        <>
          <div className="metric-grid" data-tour="manager-metrics">
            <Metric icon={Table2} label="Mesas ativas" value={String(report?.activeTables ?? activeTables.length)} />
            <Metric icon={TrendingUp} label="Ticket medio" value={currency.format(report?.avgTicket ?? avgTicket)} />
            <Metric icon={ChefHat} label="Prontos" value={String(report?.readyOrders ?? ready)} />
            <Metric
              icon={AlertTriangle}
              label="Atrasos"
              value={String(report?.delayedOrders ?? delayed)}
              tone={(report?.delayedOrders ?? delayed) ? 'danger' : undefined}
            />
          </div>

          <div className="content-grid">
            <section className="main-panel">
              <PanelHeader title="Risco operacional" meta="tempo e chamados" icon={AlertTriangle} />
              <div className="risk-list" data-tour="risk-list">
                {activeTables.length === 0 && <EmptyState icon={BadgeCheck} title="Nenhuma mesa ativa" />}
                {state.tables
                  .filter((table) => table.status !== 'free')
                  .map((table) => ({
                    table,
                    alert: getTableAlert(state, table),
                    total: tableSubtotal(state, table.id),
                  }))
                  .sort((a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)))
                  .map(({ table, alert, total }) => (
                    <button
                      className="risk-row"
                      key={table.id}
                      type="button"
                      onClick={() => onSelectTable(table.id, 'order')}
                    >
                      <span>Mesa {table.number}</span>
                      <strong>{alert || statusLabel(table.status)}</strong>
                      <b>{currency.format(total)}</b>
                    </button>
                  ))}
              </div>
            </section>

            <aside className="side-panel">
              <PanelHeader
                title="Mais vendidos"
                meta={report ? 'relatorio persistente' : 'turno atual'}
                icon={Sparkles}
              />
              <div className="top-items" data-tour="top-items">
                {(report?.topItems ?? topItems).length === 0 && (
                  <EmptyState icon={Sparkles} title="Nenhum item vendido ainda" compact />
                )}
                {(report?.topItems ?? topItems).map((item) => (
                  <div key={item.name}>
                    <span>{item.quantity}x</span>
                    <strong>{item.name}</strong>
                    <b>{currency.format(item.revenue)}</b>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </>
      ) : (
        <section className="main-panel">
          <EmptyState icon={LockKeyhole} title="Relatorios bloqueados para este acesso" />
        </section>
      )}

      {canViewReports && (
        <section className="main-panel" data-tour="audit-log">
          <PanelHeader title="Historico operacional" meta={`${state.auditEvents.length} eventos`} icon={ReceiptText} />
          <div className="audit-list">
            {state.auditEvents.length === 0 && (
              <EmptyState icon={ReceiptText} title="Nenhuma acao registrada ainda" compact />
            )}
            {state.auditEvents.slice(0, 12).map((event) => (
              <article className="audit-row" key={event.id}>
                <div>
                  <strong>{event.label}</strong>
                  <span>{event.actorName ?? 'Sistema'} - {formatDateTime(event.createdAt)}</span>
                  {event.metadata?.reason && <small>Motivo: {event.metadata.reason}</small>}
                </div>
                <code>{event.action}</code>
              </article>
            ))}
          </div>
        </section>
      )}

      {canManageAccessProfiles && (
        <section className="main-panel">
          <PanelHeader title="Operadores" meta={`${state.staff.length} ativos`} icon={BadgeCheck} />
          <div className="staff-management">
            <div className="staff-form">
              <label className="field-label" htmlFor="staff-name">
                Nome do operador
              </label>
              <input
                id="staff-name"
                className="full-input"
                value={staffDraft.name}
                onChange={(event) => updateStaffDraft({ name: event.target.value })}
                placeholder="Ex: Ana Silva"
              />
              <div className="form-grid two">
                <div>
                  <label className="field-label" htmlFor="staff-role">
                    Tipo de acesso
                  </label>
                  <select
                    id="staff-role"
                    className="full-input"
                    value={staffDraft.role}
                    onChange={(event) => updateStaffDraft({ role: event.target.value })}
                  >
                    {accessProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="staff-pin">
                    PIN inicial
                  </label>
                  <input
                    id="staff-pin"
                    className="full-input"
                    type="password"
                    inputMode="numeric"
                    value={staffDraft.pin}
                    onChange={(event) => updateStaffDraft({ pin: event.target.value })}
                    placeholder="4 a 12 digitos"
                  />
                </div>
              </div>
              {staffMessage && <p className="system-note">{staffMessage}</p>}
              <button className="primary-button" type="button" onClick={submitStaff}>
                <Plus size={17} />
                Criar operador
              </button>
            </div>
            <div className="staff-list">
              {state.staff.map((member) => (
                <article className="staff-row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{roleLabel(member.role, accessProfiles)}</span>
                  </div>
                  <div className="access-card-actions">
                    <select
                      className="compact-select"
                      value={member.role}
                      onChange={(event) => onUpdateStaff(member.id, { role: event.target.value })}
                    >
                      {accessProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <button className="secondary-button small" type="button" onClick={() => resetOperatorPin(member)}>
                      <LockKeyhole size={16} />
                      PIN
                    </button>
                    <button className="danger-button small" type="button" onClick={() => onUpdateStaff(member.id, { active: false })}>
                      <Trash2 size={16} />
                      Desativar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {canManageAccessProfiles && (
        <section className="main-panel">
          <PanelHeader
            title={editingProfileId ? 'Editar tipo de acesso' : 'Tipos de acesso'}
            meta="permissoes por aba"
            icon={LockKeyhole}
          >
            {editingProfileId && (
              <button className="ghost-button compact" type="button" onClick={() => resetAccessForm()}>
                <X size={16} />
                Cancelar
              </button>
            )}
          </PanelHeader>

          <div className="access-management">
            <div className="access-form">
              <label className="field-label" htmlFor="access-name">
                Nome do tipo de acesso
              </label>
              <input
                id="access-name"
                data-tour="access-name"
                className="full-input"
                value={accessDraft.name}
                onChange={(event) => updateAccessDraft({ name: event.target.value })}
                placeholder="Ex: Supervisor, Bar, Financeiro"
              />

              <div className="permission-grid" data-tour="permission-grid">
                {(Object.keys(viewConfig) as ViewKey[]).map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={accessDraft.permissions.includes(key)}
                      onChange={() => toggleDraftPermission(key)}
                    />
                    {viewConfig[key].label}
                  </label>
                ))}
              </div>

              <label className="field-label">
                Acoes permitidas
              </label>
              <div className="permission-grid action-permissions" data-tour="action-permission-grid">
                {allActionPermissions.map((action) => (
                  <label key={action}>
                    <input
                      type="checkbox"
                      checked={accessDraft.actions.includes(action)}
                      onChange={() => toggleDraftAction(action)}
                    />
                    <span>
                      <strong>{actionPermissionConfig[action].label}</strong>
                      <small>{actionPermissionConfig[action].description}</small>
                    </span>
                  </label>
                ))}
              </div>

              {accessMessage && <p className="system-note">{accessMessage}</p>}
              <button className="primary-button" type="button" onClick={submitAccessProfile} data-tour="access-save">
                {editingProfileId ? <Pencil size={17} /> : <Plus size={17} />}
                {editingProfileId ? 'Salvar tipo de acesso' : 'Criar tipo de acesso'}
              </button>
            </div>

            <div className="access-profile-list" data-tour="access-list">
              {accessProfiles.map((profile) => (
                <article className="access-profile-card" key={profile.id}>
                  <div>
                    <strong>{profile.name}</strong>
                    <span>{profile.permissions.map((key) => viewConfig[key]?.label ?? key).join(', ')}</span>
                    <small>
                      {(profile.actions ?? []).length
                        ? (profile.actions ?? []).map((action) => actionPermissionConfig[action]?.label ?? action).join(', ')
                        : 'Sem acoes sensiveis liberadas'}
                    </small>
                    {profile.system && <small>Perfil padrao do sistema</small>}
                  </div>
                  {!profile.system && (
                    <div className="access-card-actions">
                      <button className="secondary-button small" type="button" onClick={() => startEditingAccessProfile(profile)}>
                        <Pencil size={16} />
                        Editar
                      </button>
                      <button className="danger-button small" type="button" onClick={() => deleteProfile(profile)}>
                        <Trash2 size={16} />
                        Excluir
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

interface MenuProductDraft {
  name: string
  category: string
  description: string
  price: string
  prepMinutes: string
  station: Station
  tags: string
  allergens: string
  favorite: boolean
  available: boolean
}

function emptyMenuProductDraft(): MenuProductDraft {
  return {
    name: '',
    category: '',
    description: '',
    price: '',
    prepMinutes: '10',
    station: 'pass',
    tags: '',
    allergens: '',
    favorite: false,
    available: true,
  }
}

function menuProductToDraft(item: MenuItem): MenuProductDraft {
  return {
    name: item.name,
    category: item.category,
    description: item.description,
    price: item.price.toFixed(2).replace('.', ','),
    prepMinutes: String(item.prepMinutes),
    station: item.station,
    tags: item.tags.join(', '),
    allergens: item.allergens.join(', '),
    favorite: item.favorite,
    available: item.available,
  }
}

function parseCommaList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function MenuView({
  state,
  canManageProducts,
  onToggle,
  onAddProduct,
  onUpdateProduct,
}: {
  state: AppState
  canManageProducts: boolean
  onToggle: (itemId: string) => void
  onAddProduct: (item: MenuItem) => void
  onUpdateProduct: (itemId: string, item: MenuItem) => void
}) {
  const [draft, setDraft] = useState<MenuProductDraft>(() => emptyMenuProductDraft())
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState('')
  const editingProduct = state.menu.find((item) => item.id === editingProductId)
  const grouped = Array.from(new Set(state.menu.map((item) => item.category))).map((category) => ({
    category,
    items: state.menu.filter((item) => item.category === category),
  }))

  function updateDraft(patch: Partial<MenuProductDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setFormMessage('')
  }

  function resetProductForm(message = '') {
    setDraft(emptyMenuProductDraft())
    setEditingProductId(null)
    setFormMessage(message)
  }

  function startEditingProduct(item: MenuItem) {
    setEditingProductId(item.id)
    setDraft(menuProductToDraft(item))
    setFormMessage('')
  }

  function submitProduct() {
    const name = draft.name.trim()
    const category = draft.category.trim()
    const description = draft.description.trim()
    const price = Number(draft.price.replace(',', '.'))
    const prepMinutes = Number(draft.prepMinutes)

    if (!canManageProducts) {
      setFormMessage('Este acesso nao pode alterar produtos')
      return
    }

    if (!name || !category) {
      setFormMessage('Preencha nome e categoria')
      return
    }

    if (!Number.isFinite(price) || price <= 0) {
      setFormMessage('Informe um preco valido')
      return
    }

    if (!Number.isFinite(prepMinutes) || prepMinutes < 0) {
      setFormMessage('Informe um tempo de preparo valido')
      return
    }

    const alreadyExists = state.menu.some(
      (item) =>
        item.id !== editingProductId &&
        item.name.trim().toLowerCase() === name.toLowerCase() &&
        item.category.trim().toLowerCase() === category.toLowerCase(),
    )

    if (alreadyExists) {
      setFormMessage('Ja existe um produto com esse nome nesta categoria')
      return
    }

    const nextProduct: MenuItem = {
      id: editingProduct?.id ?? uid('menu'),
      name,
      category,
      description,
      price,
      prepMinutes: Math.floor(prepMinutes),
      station: draft.station,
      tags: parseCommaList(draft.tags),
      allergens: parseCommaList(draft.allergens),
      favorite: draft.favorite,
      available: draft.available,
      pairingIds: editingProduct?.pairingIds ?? [],
      modifierGroups: editingProduct?.modifierGroups ?? [],
    }

    if (editingProductId) {
      onUpdateProduct(editingProductId, nextProduct)
      resetProductForm('Produto atualizado no cardapio')
      return
    }

    onAddProduct(nextProduct)
    resetProductForm('Produto cadastrado no cardapio')
  }

  return (
    <div className="menu-management">
      {canManageProducts && (
        <section className="main-panel">
          <PanelHeader
            title={editingProductId ? 'Editar produto' : 'Novo produto'}
            meta={editingProductId ? editingProduct?.name ?? 'produto selecionado' : 'cadastro do cardapio'}
            icon={editingProductId ? Pencil : Plus}
          >
            {editingProductId && (
              <button className="ghost-button compact" type="button" onClick={() => resetProductForm()}>
                <X size={16} />
                Cancelar
              </button>
            )}
          </PanelHeader>
          <div className="product-form">
            <label className="field-label" htmlFor="product-name">
              Nome
            </label>
            <input
              id="product-name"
              data-tour="product-name"
              className="full-input"
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
              placeholder="Nome do produto"
            />

            <div className="form-grid two">
              <div>
                <label className="field-label" htmlFor="product-category">
                  Categoria
                </label>
                <input
                  id="product-category"
                  data-tour="product-category"
                  className="full-input"
                  value={draft.category}
                  onChange={(event) => updateDraft({ category: event.target.value })}
                  placeholder="Ex: Pratos, Bebidas, Sobremesas"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="product-station">
                  Praca
                </label>
                <select
                  id="product-station"
                  data-tour="product-station"
                  className="full-input"
                  value={draft.station}
                  onChange={(event) => updateDraft({ station: event.target.value as Station })}
                >
                  {stationOptions.map((station) => (
                    <option key={station.value} value={station.value}>
                      {station.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="field-label" htmlFor="product-description">
              Descricao
            </label>
            <textarea
              id="product-description"
              data-tour="product-description"
              className="product-textarea"
              value={draft.description}
              onChange={(event) => updateDraft({ description: event.target.value })}
              placeholder="Ingredientes, preparo ou informacao comercial"
            />

            <div className="form-grid two">
              <div>
                <label className="field-label" htmlFor="product-price">
                  Preco
                </label>
                <input
                  id="product-price"
                  data-tour="product-price"
                  className="full-input"
                  value={draft.price}
                  onChange={(event) => updateDraft({ price: event.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="product-prep">
                  Tempo de preparo
                </label>
                <input
                  id="product-prep"
                  data-tour="product-prep"
                  className="full-input"
                  value={draft.prepMinutes}
                  onChange={(event) => updateDraft({ prepMinutes: event.target.value })}
                  inputMode="numeric"
                  placeholder="Minutos"
                />
              </div>
            </div>

            <div className="form-grid two">
              <div>
                <label className="field-label" htmlFor="product-tags">
                  Tags
                </label>
                <input
                  id="product-tags"
                  data-tour="product-tags"
                  className="full-input"
                  value={draft.tags}
                  onChange={(event) => updateDraft({ tags: event.target.value })}
                  placeholder="Separadas por virgula"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="product-allergens">
                  Alergenicos
                </label>
                <input
                  id="product-allergens"
                  data-tour="product-allergens"
                  className="full-input"
                  value={draft.allergens}
                  onChange={(event) => updateDraft({ allergens: event.target.value })}
                  placeholder="Separados por virgula"
                />
              </div>
            </div>

            <div className="form-switches" data-tour="product-switches">
              <label>
                <input
                  type="checkbox"
                  checked={draft.favorite}
                  onChange={(event) => updateDraft({ favorite: event.target.checked })}
                />
                Favorito
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.available}
                  onChange={(event) => updateDraft({ available: event.target.checked })}
                />
                Disponivel para venda
              </label>
            </div>

            {formMessage && <p className="system-note">{formMessage}</p>}
            <button className="primary-button" type="button" onClick={submitProduct} data-tour="product-save">
              {editingProductId ? <Pencil size={17} /> : <Plus size={17} />}
              {editingProductId ? 'Salvar alteracoes' : 'Cadastrar produto'}
            </button>
          </div>
        </section>
      )}

      <section className="main-panel full">
        <PanelHeader title="Cardapio operacional" meta={`${state.menu.length} produtos`} icon={ToggleRight} />
        <div className="availability-list" data-tour="availability-list">
          {grouped.length === 0 && <EmptyState icon={Utensils} title="Nenhum produto cadastrado" />}
          {grouped.map((group) => (
            <div className="availability-group" key={group.category}>
              <h2>{group.category}</h2>
              {group.items.map((item) => (
                <div className="availability-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {currency.format(item.price)} - {stationLabel(item.station)} - {item.prepMinutes} min
                    </span>
                    {item.description && <small>{item.description}</small>}
                    {(item.tags.length > 0 || item.allergens.length > 0) && (
                      <small>
                        {[...item.tags, ...item.allergens.map((allergen) => `Alergenico: ${allergen}`)].join(' | ')}
                      </small>
                    )}
                  </div>
                  <div className="availability-actions">
                    <button
                      className={item.available ? 'toggle-button on' : 'toggle-button'}
                      type="button"
                      onClick={() => onToggle(item.id)}
                      disabled={!canManageProducts}
                    >
                      {item.available ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                      {item.available ? 'Disponivel' : 'Indisponivel'}
                    </button>
                    {canManageProducts && (
                      <button
                        className="secondary-button small"
                        type="button"
                        onClick={() => startEditingProduct(item)}
                      >
                        <Pencil size={16} />
                        Editar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function IntegrationsView({
  settings,
  fiscal,
  message,
  canManageIntegrations,
  onChange,
  onFiscalChange,
  onSave,
  onSaveFiscal,
  onTest,
  onTestFiscal,
}: {
  settings: IntegrationSettings
  fiscal: FiscalSettings
  message: string
  canManageIntegrations: boolean
  onChange: (patch: Partial<IntegrationSettings>) => void
  onFiscalChange: (patch: Partial<FiscalSettings>) => void
  onSave: () => void
  onSaveFiscal: () => void
  onTest: (type: 'printer' | 'payments' | 'kds') => void
  onTestFiscal: () => void
}) {
  return (
    <div className="content-grid integrations-layout">
      <section className="main-panel">
        <PanelHeader title="Integracoes comerciais" meta="impressora, pagamento e cozinha" icon={Plug} />

        <div className="integration-grid">
          <IntegrationCard
            icon={Printer}
            title="Impressora de producao"
            enabled={settings.enablePrinter}
            disabled={!canManageIntegrations}
            onEnabled={(enabled) => onChange({ enablePrinter: enabled })}
            onTest={() => onTest('printer')}
            tourId="printer-card"
          >
            <label className="field-label" htmlFor="printer-endpoint">
              Endpoint da impressora
            </label>
            <input
              id="printer-endpoint"
              className="full-input"
              value={settings.printerEndpoint}
              onChange={(event) => onChange({ printerEndpoint: event.target.value })}
              placeholder="https://print.local/jobs"
              disabled={!canManageIntegrations}
            />
          </IntegrationCard>

          <IntegrationCard
            icon={CreditCard}
            title="Pagamentos"
            enabled={settings.enablePayments}
            disabled={!canManageIntegrations}
            onEnabled={(enabled) => onChange({ enablePayments: enabled })}
            onTest={() => onTest('payments')}
            tourId="payments-card"
          >
            <label className="field-label" htmlFor="payment-provider">
              Provedor
            </label>
            <select
              id="payment-provider"
              className="full-input"
              value={settings.paymentsProvider}
              onChange={(event) => onChange({ paymentsProvider: event.target.value })}
              disabled={!canManageIntegrations}
            >
              <option value="manual">Manual</option>
              <option value="stone">Stone</option>
              <option value="cielo">Cielo</option>
              <option value="mercado-pago">Mercado Pago</option>
            </select>
            <label className="field-label" htmlFor="payment-key">
              Chave publica
            </label>
            <input
              id="payment-key"
              className="full-input"
              value={settings.paymentsPublicKey}
              onChange={(event) => onChange({ paymentsPublicKey: event.target.value })}
              placeholder="pk_live_..."
              disabled={!canManageIntegrations}
            />
          </IntegrationCard>

          <IntegrationCard
            icon={ReceiptText}
            title="Fiscal NFC-e/SAT"
            enabled={fiscal.enableFiscal}
            disabled={!canManageIntegrations}
            onEnabled={(enabled) => onFiscalChange({ enableFiscal: enabled })}
            onTest={onTestFiscal}
            tourId="fiscal-card"
          >
            <label className="field-label" htmlFor="fiscal-provider">
              Provedor fiscal
            </label>
            <input
              id="fiscal-provider"
              className="full-input"
              value={fiscal.provider}
              onChange={(event) => onFiscalChange({ provider: event.target.value })}
              placeholder="Provedor homologado"
              disabled={!canManageIntegrations}
            />
            <label className="field-label" htmlFor="fiscal-endpoint">
              Endpoint de emissao
            </label>
            <input
              id="fiscal-endpoint"
              className="full-input"
              value={fiscal.providerEndpoint}
              onChange={(event) => onFiscalChange({ providerEndpoint: event.target.value })}
              placeholder="https://fiscal.exemplo.com/nfce"
              disabled={!canManageIntegrations}
            />
            <div className="form-grid two">
              <div>
                <label className="field-label" htmlFor="fiscal-state">
                  UF
                </label>
                <input
                  id="fiscal-state"
                  className="full-input"
                  value={fiscal.stateCode}
                  onChange={(event) => onFiscalChange({ stateCode: event.target.value.toUpperCase() })}
                  placeholder="SP"
                  disabled={!canManageIntegrations}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="fiscal-city">
                  Codigo municipio
                </label>
                <input
                  id="fiscal-city"
                  className="full-input"
                  value={fiscal.cityCode}
                  onChange={(event) => onFiscalChange({ cityCode: event.target.value })}
                  placeholder="IBGE"
                  disabled={!canManageIntegrations}
                />
              </div>
            </div>
            <button className="secondary-button small" type="button" onClick={onSaveFiscal} disabled={!canManageIntegrations}>
              <Check size={16} />
              Salvar fiscal
            </button>
          </IntegrationCard>

          <IntegrationCard
            icon={Webhook}
            title="KDS externo"
            enabled={settings.enableKdsWebhook}
            disabled={!canManageIntegrations}
            onEnabled={(enabled) => onChange({ enableKdsWebhook: enabled })}
            onTest={() => onTest('kds')}
            tourId="kds-card"
          >
            <label className="field-label" htmlFor="kds-webhook">
              Webhook da cozinha
            </label>
            <input
              id="kds-webhook"
              className="full-input"
              value={settings.kdsWebhook}
              onChange={(event) => onChange({ kdsWebhook: event.target.value })}
              placeholder="https://kds.local/orders"
              disabled={!canManageIntegrations}
            />
          </IntegrationCard>
        </div>
      </section>

      <aside className="side-panel">
        <PanelHeader title="Pronto para venda" meta="controles de produto" icon={Building2} />
        <div className="deployment-list">
          <div>
            <Server size={18} />
            <span>API com SQLite local e rotas protegidas por token</span>
          </div>
          <div>
            <LockKeyhole size={18} />
            <span>Credenciais com PBKDF2 e sessoes expiraveis</span>
          </div>
          <div>
            <LayoutDashboard size={18} />
            <span>Relatorios lidos do backend por restaurante</span>
          </div>
        </div>

        {message && <p className="system-note strong">{message}</p>}

        <button className="primary-button" type="button" onClick={onSave} disabled={!canManageIntegrations}>
          <Check size={17} />
          Salvar configuracoes
        </button>
      </aside>
    </div>
  )
}

function IntegrationCard({
  icon: Icon,
  title,
  enabled,
  disabled = false,
  children,
  onEnabled,
  onTest,
  tourId,
}: {
  icon: typeof Table2
  title: string
  enabled: boolean
  disabled?: boolean
  children: ReactNode
  onEnabled: (enabled: boolean) => void
  onTest: () => void
  tourId?: string
}) {
  return (
    <article className="integration-card" data-tour={tourId}>
      <div className="integration-card-head">
        <div>
          <span className="panel-icon">
            <Icon size={18} />
          </span>
          <strong>{title}</strong>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabled(event.target.checked)}
            disabled={disabled}
          />
          <span>{enabled ? 'Ativo' : 'Inativo'}</span>
        </label>
      </div>
      {children}
      <button className="secondary-button small" type="button" onClick={onTest} disabled={disabled}>
        <RefreshCw size={15} />
        Testar
      </button>
    </article>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Table2
  label: string
  value: string
  tone?: 'danger'
}) {
  return (
    <article className={tone === 'danger' ? 'metric danger' : 'metric'}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function TrainingOverlay({
  steps,
  currentIndex,
  onBack,
  onNext,
  onSkip,
}: {
  steps: TrainingStep[]
  currentIndex: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  const step = steps[currentIndex]
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!step) return undefined

    const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
    if (!target) {
      const timer = window.setTimeout(() => setTargetRect(null), 0)
      return () => window.clearTimeout(timer)
    }

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    target.classList.add('tour-focus-target')

    const updateTargetRect = () => {
      setTargetRect(target.getBoundingClientRect())
    }

    const firstTimer = window.setTimeout(updateTargetRect, 120)
    const secondTimer = window.setTimeout(updateTargetRect, 520)
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)

    return () => {
      window.clearTimeout(firstTimer)
      window.clearTimeout(secondTimer)
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
      target.classList.remove('tour-focus-target')
    }
  }, [step])

  if (!step) return null

  const focusPadding = 10
  const spotlightStyle: CSSProperties | undefined = targetRect
    ? {
        top: targetRect.top - focusPadding,
        left: targetRect.left - focusPadding,
        width: targetRect.width + focusPadding * 2,
        height: targetRect.height + focusPadding * 2,
      }
    : undefined

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const edge = 18
  const gap = 18
  const tooltipWidth = Math.min(430, viewportWidth - edge * 2)
  const tooltipHeight = 250
  const clamp = (value: number, min: number, max: number) =>
    max < min ? min : Math.min(Math.max(value, min), max)
  const tooltipStyle: CSSProperties = targetRect
    ? (() => {
        const spaceBelow = viewportHeight - targetRect.bottom
        const spaceAbove = targetRect.top
        const spaceRight = viewportWidth - targetRect.right
        const spaceLeft = targetRect.left
        const centeredLeft = clamp(
          targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
          edge,
          viewportWidth - tooltipWidth - edge,
        )
        const centeredTop = clamp(
          targetRect.top + targetRect.height / 2 - tooltipHeight / 2,
          edge,
          viewportHeight - tooltipHeight - edge,
        )

        if (spaceBelow >= tooltipHeight + gap) {
          return {
            top: targetRect.bottom + gap,
            left: centeredLeft,
            width: tooltipWidth,
          }
        }

        if (spaceAbove >= tooltipHeight + gap) {
          return {
            top: targetRect.top - tooltipHeight - gap,
            left: centeredLeft,
            width: tooltipWidth,
          }
        }

        if (spaceRight >= tooltipWidth + gap) {
          return {
            top: centeredTop,
            left: targetRect.right + gap,
            width: tooltipWidth,
          }
        }

        if (spaceLeft >= tooltipWidth + gap) {
          return {
            top: centeredTop,
            left: targetRect.left - tooltipWidth - gap,
            width: tooltipWidth,
          }
        }

        return {
          top: clamp(targetRect.bottom + gap, edge, viewportHeight - tooltipHeight - edge),
          left: centeredLeft,
          width: tooltipWidth,
        }
      })()
    : {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: tooltipWidth,
      }
  const progressPercent = Math.round(((currentIndex + 1) / steps.length) * 100)

  return (
    <>
      <div className="tour-backdrop" />
      {spotlightStyle && <div className="tour-spotlight" style={spotlightStyle} />}
      <section className="tour-tooltip" style={tooltipStyle} aria-live="polite">
        <div className="tour-progress-row">
          <span className="tour-progress">
            Passo {currentIndex + 1} de {steps.length}
          </span>
          <span>{progressPercent}%</span>
        </div>
        <div className="tour-progress-track" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="ghost-button small" type="button" onClick={onSkip}>
            Pular
          </button>
          <div>
            <button className="secondary-button small" type="button" onClick={onBack} disabled={currentIndex === 0}>
              Voltar
            </button>
            <button className="primary-button small" type="button" onClick={onNext}>
              {currentIndex === steps.length - 1 ? 'Concluir' : 'Proximo'}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}

function PanelHeader({
  title,
  meta,
  icon: Icon,
  children,
}: {
  title: string
  meta: string
  icon: typeof Table2
  children?: ReactNode
}) {
  return (
    <div className="panel-header">
      <div>
        <span className="panel-icon">
          <Icon size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <span>{meta}</span>
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  compact,
}: {
  icon: typeof Table2
  title: string
  compact?: boolean
}) {
  return (
    <div className={compact ? 'empty-state compact' : 'empty-state'}>
      <Icon size={22} />
      <span>{title}</span>
    </div>
  )
}

function WorkspaceEmpty({
  icon: Icon,
  title,
  meta,
  description,
  actionLabel,
  onAction,
}: {
  icon: typeof Table2
  title: string
  meta: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <section className="main-panel full">
      <PanelHeader title={title} meta={meta} icon={Icon} />
      <div className="empty-state action">
        <Icon size={28} />
        <span>{title}</span>
        <p>{description}</p>
        <button className="primary-button small" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </section>
  )
}

export default App
