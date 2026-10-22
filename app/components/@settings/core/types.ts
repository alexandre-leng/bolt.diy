import { User, Folder, Wifi, Settings, Box, Sliders } from 'lucide-react';
import type { ReactNode } from 'react';

export type SettingCategory = 'profile' | 'file_sharing' | 'connectivity' | 'system' | 'services' | 'preferences';

export type TabType =
  | 'profile'
  | 'account'
  | 'settings'
  | 'notifications'
  | 'features'
  | 'data'
  | 'cloud-providers'
  | 'local-providers'
  | 'connectors'
  | 'github'
  | 'gitlab'
  | 'netlify'
  | 'vercel'
  | 'supabase'
  | 'event-logs'
  | 'mcp'
  | 'voice'
  | 'plugins'
  | 'admin-keys'
  | 'ia-access';

export type WindowType = 'user' | 'developer';

export interface UserProfile {
  nickname: any;
  name: string;
  email: string;
  avatar?: string;
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  password?: string;
  bio?: string;
  language: string;
  timezone: string;
}

export interface SettingItem {
  id: TabType;
  label: string;
  icon: string;
  category: SettingCategory;
  description?: string;
  component: () => ReactNode;
  badge?: string;
  keywords?: string[];
}

export interface TabVisibilityConfig {
  id: TabType;
  visible: boolean;
  window: WindowType;
  order: number;
  isExtraDevTab?: boolean;
  locked?: boolean;

  /** Only rendered for an administrator (`/api/auth/me` reports isAdmin). */
  isAdminOnly?: boolean;
}

export interface DevTabConfig extends TabVisibilityConfig {
  window: 'developer';
}

export interface UserTabConfig extends TabVisibilityConfig {
  window: 'user';
}

export interface TabWindowConfig {
  userTabs: UserTabConfig[];
}

export { TAB_LABELS } from './constants';

export const categoryLabels: Record<SettingCategory, string> = {
  profile: 'Profil et compte',
  file_sharing: 'Partage de fichiers',
  connectivity: 'Connectivité',
  system: 'Système',
  services: 'Services',
  preferences: 'Préférences',
};

export const categoryIcons: Record<SettingCategory, React.ComponentType<{ className?: string }>> = {
  profile: User,
  file_sharing: Folder,
  connectivity: Wifi,
  system: Settings,
  services: Box,
  preferences: Sliders,
};

export interface Profile {
  username?: string;
  bio?: string;
  avatar?: string;
  preferences?: {
    notifications?: boolean;
    theme?: 'light' | 'dark' | 'system';
    language?: string;
    timezone?: string;
  };
}
