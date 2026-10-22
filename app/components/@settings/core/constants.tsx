import {
  CircleUserRound,
  User,
  Settings,
  Bell,
  Star,
  Database,
  Cloud,
  Laptop,
  GitBranch,
  Wrench,
  List,
  Plug,
  Blocks,
  Mic,
  KeyRound,
  Sparkles,
} from 'lucide-react';
import type { TabType } from './types';

// GitLab icon component
const GitLabIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path
      fill="currentColor"
      d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"
    />
  </svg>
);

// Vercel icon component
const VercelIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path fill="currentColor" d="M12 2L2 19.777h20L12 2z" />
  </svg>
);

// Netlify icon component
const NetlifyIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path
      fill="currentColor"
      d="M16.934 8.519a1.044 1.044 0 0 1 .303-.23l2.349-1.045a.983.983 0 0 1 .905 0c.264.12.49.328.651.599l.518 1.065c.17.35.17.761 0 1.11l-.518 1.065a1.119 1.119 0 0 1-.651.599l-2.35 1.045a1.013 1.013 0 0 1-.904 0l-2.35-1.045a1.119 1.119 0 0 1-.651-.599L13.718 9.02a1.2 1.2 0 0 1 0-1.11l.518-1.065a1.119 1.119 0 0 1 .651-.599l2.35-1.045a.983.983 0 0 1 .697-.061zm-6.051 5.751a1.044 1.044 0 0 1 .303-.23l2.349-1.045a.983.983 0 0 1 .905 0c.264.12.49.328.651.599l.518 1.065c.17.35.17.761 0 1.11l-.518 1.065a1.119 1.119 0 0 1-.651.599l-2.35 1.045a1.013 1.013 0 0 1-.904 0l-2.35-1.045a1.119 1.119 0 0 1-.651-.599l-.518-1.065a1.2 1.2 0 0 1 0-1.11l.518-1.065a1.119 1.119 0 0 1 .651-.599l2.35-1.045a.983.983 0 0 1 .697-.061z"
    />
  </svg>
);

// Supabase icon component
const SupabaseIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4">
    <path
      fill="currentColor"
      d="M21.362 9.354H12V.396a.396.396 0 0 0-.716-.233L2.203 12.424l-.401.562a1.04 1.04 0 0 0 .836 1.659H12V21.6a.396.396 0 0 0 .716.233l9.081-12.261.401-.562a1.04 1.04 0 0 0-.836-1.656z"
    />
  </svg>
);

export const TAB_ICONS: Record<TabType, React.ComponentType<{ className?: string }>> = {
  account: CircleUserRound,
  profile: User,
  settings: Settings,
  notifications: Bell,
  features: Star,
  data: Database,
  'cloud-providers': Cloud,
  'local-providers': Laptop,
  connectors: Plug,
  github: GitBranch,
  gitlab: () => <GitLabIcon />,
  netlify: () => <NetlifyIcon />,
  vercel: () => <VercelIcon />,
  supabase: () => <SupabaseIcon />,
  'event-logs': List,
  mcp: Wrench,
  voice: Mic,
  plugins: Blocks,
  'admin-keys': KeyRound,
  'ia-access': Sparkles,
};

export const TAB_LABELS: Record<TabType, string> = {
  account: 'Mon compte',
  profile: 'Profil',
  settings: 'Préférences',
  notifications: 'Notifications',
  features: 'Fonctionnalités',
  data: 'Gestion des données',
  'cloud-providers': 'Fournisseurs cloud',
  'local-providers': 'Fournisseurs locaux',
  connectors: 'Connecteurs',
  github: 'GitHub',
  gitlab: 'GitLab',
  netlify: 'Netlify',
  vercel: 'Vercel',
  supabase: 'Supabase',
  'event-logs': 'Journaux d’événements',
  mcp: 'Serveurs MCP',
  voice: 'Voix',
  plugins: 'Extensions',
  'admin-keys': "Clés API de l'instance",
  'ia-access': 'Mon accès IA',
};

export const TAB_DESCRIPTIONS: Record<TabType, string> = {
  account: 'Profil, email, mot de passe, appareils connectés et suppression du compte',
  profile: 'Gérez votre profil et les paramètres de votre compte',
  settings: 'Personnalisez l’application et vos préférences',
  notifications: 'Consultez et gérez vos notifications',
  features: 'Découvrez les nouvelles fonctionnalités',
  data: 'Gérez vos données et votre stockage',
  'cloud-providers': 'Configurez les fournisseurs IA cloud et leurs modèles',
  'local-providers': 'Configurez les fournisseurs IA locaux et leurs modèles',
  connectors: 'Connectez et gérez vos outils et services de développement',
  github: 'Connectez et gérez l’intégration GitHub',
  gitlab: 'Connectez et gérez l’intégration GitLab',
  netlify: 'Configurez les paramètres de déploiement Netlify',
  vercel: 'Gérez les projets et déploiements Vercel',
  supabase: 'Configurez la connexion à la base de données Supabase',
  'event-logs': 'Consultez les événements système et les journaux',
  mcp: 'Configurez les serveurs MCP (Model Context Protocol)',
  voice: 'Dictée au micro et synthèse vocale',
  plugins: 'Découvrez, installez et gérez les extensions',
  'admin-keys': "Clés API configurees pour toute l'instance (administrateurs uniquement)",
  'ia-access': "Les modèles et les fournisseurs que l'administrateur vous a ouverts",
};

export const DEFAULT_TAB_CONFIG = [
  // User Window Tabs (Always visible by default)
  { id: 'account', visible: true, window: 'user' as const, order: 0 },
  { id: 'settings', visible: true, window: 'user' as const, order: 1 },
  { id: 'features', visible: true, window: 'user' as const, order: 1 },
  { id: 'data', visible: true, window: 'user' as const, order: 2 },
  { id: 'cloud-providers', visible: true, window: 'user' as const, order: 3 },
  { id: 'local-providers', visible: true, window: 'user' as const, order: 4 },
  { id: 'connectors', visible: true, window: 'user' as const, order: 5 },
  { id: 'notifications', visible: true, window: 'user' as const, order: 6 },
  { id: 'event-logs', visible: true, window: 'user' as const, order: 7 },
  { id: 'mcp', visible: true, window: 'user' as const, order: 8 },
  { id: 'voice', visible: true, window: 'user' as const, order: 9 },
  { id: 'plugins', visible: true, window: 'user' as const, order: 10 },

  /*
   * Administration lives in the SIDEBAR (see NAV_GROUPS), not as a grid tile: the operator asked
   * for it there, and a tile at the bottom of a two-column grid was below the fold. `visible:
   * false` keeps the id in the catalogue — the sidebar group needs it, and `getTabComponent`
   * resolves it — while removing it from the grid, which renders only `visible` tabs.
   * The role gate is `isAdminOnly`, applied in ControlPanel against /api/auth/me.
   */
  { id: 'admin-keys', visible: false, window: 'user' as const, order: -1, isAdminOnly: true },

  /*
   * The user-facing counterpart of the admin policy: what the administrator opened to this
   * account. It is a read-only view, so everybody gets the tile, and it is where a locked
   * setting explains itself instead of simply being missing.
   */
  { id: 'ia-access', visible: true, window: 'user' as const, order: 2, isAdminOnly: false },

  // Legacy individual connector tabs (hidden by default, kept for backward compatibility)
  { id: 'github', visible: false, window: 'user' as const, order: 10 },
  { id: 'gitlab', visible: false, window: 'user' as const, order: 11 },
  { id: 'netlify', visible: false, window: 'user' as const, order: 12 },
  { id: 'vercel', visible: false, window: 'user' as const, order: 13 },
  { id: 'supabase', visible: false, window: 'user' as const, order: 14 },

  // User Window Tabs (In dropdown, initially hidden)
];
