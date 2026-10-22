import { useStore } from '@nanostores/react';
import { motion } from 'framer-motion';
import Cookies from 'js-cookie';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ConnectorActionPermissions,
  getConnectorPermissionKey,
} from '~/components/@settings/shared/ConnectorActionPermissions';
import { ServiceHeader, ConnectionTestIndicator } from '~/components/@settings/shared/service-integration';
import { Button } from '~/components/ui/Button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '~/components/ui/Collapsible';
import { useConfirmDialog, actionConfirmOptions, type ConfirmOptions } from '~/components/ui/useConfirmDialog';
import { useConnectionTest } from '~/lib/hooks';
import { logStore } from '~/lib/stores/logs';
import { useMCPStore } from '~/lib/stores/mcp';
import {
  vercelConnection,
  isConnecting,
  isFetchingStats,
  updateVercelConnection,
  fetchVercelStats,
  fetchVercelStatsViaAPI,
  initializeVercelConnection,
} from '~/lib/stores/vercel';
import { toast } from '~/lib/toastify';
import type { VercelUserResponse } from '~/types/vercel';
import { classNames } from '~/utils/classNames';

interface ProjectAction {
  name: string;
  permissionId: string;
  icon: string;
  action: (projectId: string) => Promise<void>;
  requiresConfirmation?: boolean;
  variant?: 'default' | 'destructive' | 'outline';
  confirmation?: Partial<ConfirmOptions>;
}

const DEPLOYMENT_STATE_LABELS: Record<string, string> = {
  READY: 'Prêt',
  BUILDING: 'En construction',
  QUEUED: 'En file d’attente',
  INITIALIZING: 'Initialisation',
  ERROR: 'Erreur',
  CANCELED: 'Annulé',
};

// Vercel logo SVG component
const VercelLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path fill="currentColor" d="m12 2 10 18H2z" />
  </svg>
);

export default function VercelTab() {
  const toolEnabled = useMCPStore((state) => state.settings.toolEnabled);
  const permissionsInitialized = useMCPStore((state) => state.isInitialized);
  const connection = useStore(vercelConnection);
  const connecting = useStore(isConnecting);
  const fetchingStats = useStore(isFetchingStats);
  const [isProjectsExpanded, setIsProjectsExpanded] = useState(false);
  const [isProjectActionLoading, setIsProjectActionLoading] = useState(false);
  const { askConfirmation, confirmDialog } = useConfirmDialog();

  // Use shared connection test hook
  const {
    testResult: connectionTest,
    testConnection,
    isTestingConnection,
  } = useConnectionTest({
    testEndpoint: '/api/vercel-user',
    serviceName: 'Vercel',
    getUserIdentifier: (data: VercelUserResponse) =>
      data.username || data.user?.username || data.email || data.user?.email || 'Vercel User',
  });

  // Memoize project actions to prevent unnecessary re-renders
  const projectActions: ProjectAction[] = useMemo(
    () => [
      {
        name: 'Redéployer',
        permissionId: 'redeploy',
        icon: 'i-ph:arrows-clockwise',
        action: async (projectId: string) => {
          try {
            const response = await fetch(`https://api.vercel.com/v1/deployments`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${connection.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: projectId,
                target: 'production',
              }),
            });

            if (!response.ok) {
              throw new Error('Échec du redéploiement du projet');
            }

            toast.success('Redéploiement du projet lancé');
            await fetchVercelStats(connection.token);
          } catch (err: unknown) {
            const error = err instanceof Error ? err.message : 'Erreur inconnue';
            toast.error(`Impossible de redéployer le projet : ${error}`);
          }
        },
      },
      {
        name: 'Voir le tableau de bord',
        permissionId: 'view_dashboard',
        icon: 'i-ph:layout',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}`, '_blank');
        },
      },
      {
        name: 'Voir les déploiements',
        permissionId: 'view_deployments',
        icon: 'i-ph:rocket',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}/deployments`, '_blank');
        },
      },
      {
        name: 'Voir les fonctions',
        permissionId: 'view_functions',
        icon: 'i-ph:code',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}/functions`, '_blank');
        },
      },
      {
        name: 'Voir les analyses',
        permissionId: 'view_analytics',
        icon: 'i-ph:chart-bar',
        action: async (projectId: string) => {
          const project = connection.stats?.projects.find((p) => p.id === projectId);

          if (project) {
            window.open(`https://vercel.com/${connection.user?.username}/${project.name}/analytics`, '_blank');
          }
        },
      },
      {
        name: 'Voir les domaines',
        permissionId: 'view_domains',
        icon: 'i-ph:globe',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}/domains`, '_blank');
        },
      },
      {
        name: 'Voir les réglages',
        permissionId: 'view_settings',
        icon: 'i-ph:gear',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}/settings`, '_blank');
        },
      },
      {
        name: 'Voir les journaux',
        permissionId: 'view_logs',
        icon: 'i-ph:scroll',
        action: async (projectId: string) => {
          window.open(`https://vercel.com/dashboard/${projectId}/logs`, '_blank');
        },
      },
      {
        name: 'Supprimer le projet',
        permissionId: 'delete_project',
        icon: 'i-ph:trash',
        action: async (projectId: string) => {
          try {
            const response = await fetch(`https://api.vercel.com/v1/projects/${projectId}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${connection.token}`,
              },
            });

            if (!response.ok) {
              throw new Error('Échec de la suppression du projet');
            }

            toast.success('Projet supprimé');
            await fetchVercelStats(connection.token);
          } catch (err: unknown) {
            const error = err instanceof Error ? err.message : 'Erreur inconnue';
            toast.error(`Impossible de supprimer le projet : ${error}`);
          }
        },
        requiresConfirmation: true,
        variant: 'destructive',
        confirmation: {
          title: 'Supprimer ce projet Vercel ?',
          description:
            'Le projet et ses déploiements seront définitivement supprimés de Vercel. Cette action est irréversible.',
          confirmLabel: 'Supprimer le projet',
        },
      },
    ],
    [connection.token],
  ); // Only re-create when token changes

  // Initialize connection on component mount - check server-side token first
  useEffect(() => {
    const initializeConnection = async () => {
      try {
        // First try to initialize using server-side token
        await initializeVercelConnection();

        // If no connection was established, the user will need to manually enter a token
        const currentState = vercelConnection.get();

        if (!currentState.user) {
          console.log('No server-side Vercel token available, manual connection required');
        }
      } catch (error) {
        console.error('Failed to initialize Vercel connection:', error);
      }
    };
    initializeConnection();
  }, []);

  useEffect(() => {
    const fetchProjects = async () => {
      if (connection.user) {
        // Use server-side API if we have a connected user
        try {
          await fetchVercelStatsViaAPI(connection.token);
        } catch {
          // Fallback to direct API if server-side fails and we have a token
          if (connection.token) {
            await fetchVercelStats(connection.token);
          }
        }
      }
    };
    fetchProjects();
  }, [connection.user, connection.token]);

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    isConnecting.set(true);

    try {
      const token = connection.token;

      if (!token.trim()) {
        throw new Error('Un jeton est requis');
      }

      // First test the token directly with Vercel API
      const testResponse = await fetch('https://api.vercel.com/v2/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'bolt.diy-app',
        },
      });

      if (!testResponse.ok) {
        if (testResponse.status === 401) {
          throw new Error('Jeton Vercel invalide');
        }

        throw new Error(`Erreur de l’API Vercel : ${testResponse.status}`);
      }

      const userData = (await testResponse.json()) as VercelUserResponse;

      // Set cookies for server-side API access
      Cookies.set('VITE_VERCEL_ACCESS_TOKEN', token, { expires: 365 });

      // Normalize the user data structure
      const normalizedUser = userData.user || {
        id: userData.id || '',
        username: userData.username || '',
        email: userData.email || '',
        name: userData.name || '',
        avatar: userData.avatar,
      };

      updateVercelConnection({
        user: normalizedUser,
        token,
      });

      await fetchVercelStats(token);
      toast.success('Connecté à Vercel');
    } catch (error) {
      console.error('Auth error:', error);
      logStore.logError('Failed to authenticate with Vercel', { error });

      const errorMessage = error instanceof Error ? error.message : 'Impossible de se connecter à Vercel';
      toast.error(errorMessage);
      updateVercelConnection({ user: null, token: '' });
    } finally {
      isConnecting.set(false);
    }
  };

  const handleDisconnect = () => {
    // Clear Vercel-related cookies
    Cookies.remove('VITE_VERCEL_ACCESS_TOKEN');

    updateVercelConnection({ user: null, token: '' });
    toast.success('Déconnecté de Vercel');
  };

  const handleProjectAction = useCallback(
    async (projectId: string, action: ProjectAction) => {
      if (action.requiresConfirmation) {
        if (!(await askConfirmation(actionConfirmOptions(action)))) {
          return;
        }
      }

      setIsProjectActionLoading(true);
      await action.action(projectId);
      setIsProjectActionLoading(false);
    },
    [askConfirmation],
  );

  const renderProjects = useCallback(() => {
    if (fetchingStats) {
      return (
        <div className="flex items-center gap-2 text-sm text-bolt-elements-textSecondary">
          <div className="i-ph:spinner-gap w-4 h-4 animate-spin" />
          Récupération des projets Vercel…
        </div>
      );
    }

    return (
      <Collapsible open={isProjectsExpanded} onOpenChange={setIsProjectsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 rounded-lg bg-bolt-elements-background dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70 dark:hover:border-bolt-elements-borderColorActive/70 transition-all duration-200 cursor-pointer">
            <div className="flex items-center gap-2">
              <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent" />
              <span className="text-sm font-medium text-bolt-elements-textPrimary">
                Vos projets ({connection.stats?.totalProjects || 0})
              </span>
            </div>
            <div
              className={classNames(
                'i-ph:caret-down w-4 h-4 transform transition-transform duration-200 text-bolt-elements-textSecondary',
                isProjectsExpanded ? 'rotate-180' : '',
              )}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <div className="space-y-4 mt-4">
            {/* Vercel Overview Dashboard */}
            {connection.stats?.projects?.length ? (
              <div className="mb-6 p-4 bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary mb-3">Vue d’ensemble Vercel</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {connection.stats.totalProjects}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Projets au total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {
                        connection.stats.projects.filter(
                          (p) => p.targets?.production?.alias && p.targets.production.alias.length > 0,
                        ).length
                      }
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Projets déployés</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {new Set(connection.stats.projects.map((p) => p.framework).filter(Boolean)).size}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Frameworks utilisés</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {connection.stats.projects.filter((p) => p.latestDeployments?.[0]?.state === 'READY').length}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Déploiements actifs</div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Performance Analytics */}
            {connection.stats?.projects?.length ? (
              <div className="mb-6 space-y-4">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Analyse des performances</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor">
                    <h6 className="text-xs font-medium text-bolt-elements-textPrimary flex items-center gap-2 mb-2">
                      <div className="i-ph:rocket w-4 h-4 text-bolt-elements-item-contentAccent" />
                      Santé des déploiements
                    </h6>
                    <div className="space-y-1">
                      {(() => {
                        const totalDeployments = connection.stats.projects.reduce(
                          (sum, p) => sum + (p.latestDeployments?.length || 0),
                          0,
                        );
                        const readyDeployments = connection.stats.projects.filter(
                          (p) => p.latestDeployments?.[0]?.state === 'READY',
                        ).length;
                        const errorDeployments = connection.stats.projects.filter(
                          (p) => p.latestDeployments?.[0]?.state === 'ERROR',
                        ).length;
                        const successRate =
                          totalDeployments > 0
                            ? Math.round((readyDeployments / connection.stats.projects.length) * 100)
                            : 0;

                        return [
                          { label: 'Taux de réussite', value: `${successRate} %` },
                          { label: 'Actifs', value: readyDeployments },
                          { label: 'Échoués', value: errorDeployments },
                        ];
                      })().map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-bolt-elements-textSecondary">{item.label} :</span>
                          <span className="text-bolt-elements-textPrimary font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor">
                    <h6 className="text-xs font-medium text-bolt-elements-textPrimary flex items-center gap-2 mb-2">
                      <div className="i-ph:chart-bar w-4 h-4 text-bolt-elements-item-contentAccent" />
                      Répartition des frameworks
                    </h6>
                    <div className="space-y-1">
                      {(() => {
                        const frameworks = connection.stats.projects.reduce(
                          (acc, p) => {
                            if (p.framework) {
                              acc[p.framework] = (acc[p.framework] || 0) + 1;
                            }

                            return acc;
                          },
                          {} as Record<string, number>,
                        );

                        return Object.entries(frameworks)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 3)
                          .map(([framework, count]) => ({ label: framework, value: count }));
                      })().map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-bolt-elements-textSecondary">{item.label} :</span>
                          <span className="text-bolt-elements-textPrimary font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor">
                    <h6 className="text-xs font-medium text-bolt-elements-textPrimary flex items-center gap-2 mb-2">
                      <div className="i-ph:activity w-4 h-4 text-bolt-elements-item-contentAccent" />
                      Résumé de l’activité
                    </h6>
                    <div className="space-y-1">
                      {(() => {
                        const now = Date.now();

                        const recentDeployments = connection.stats.projects.filter((p) => {
                          const lastDeploy = p.latestDeployments?.[0]?.created;
                          return lastDeploy && now - new Date(lastDeploy).getTime() < 7 * 24 * 60 * 60 * 1000;
                        }).length;
                        const totalDomains = connection.stats.projects.reduce(
                          (sum, p) => sum + (p.targets?.production?.alias ? p.targets.production.alias.length : 0),
                          0,
                        );
                        const avgDomainsPerProject =
                          connection.stats.projects.length > 0
                            ? Math.round((totalDomains / connection.stats.projects.length) * 10) / 10
                            : 0;

                        return [
                          { label: 'Déploiements récents', value: recentDeployments },
                          { label: 'Domaines au total', value: totalDomains },
                          { label: 'Domaines par projet (moy.)', value: avgDomainsPerProject },
                        ];
                      })().map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-bolt-elements-textSecondary">{item.label} :</span>
                          <span className="text-bolt-elements-textPrimary font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Project Health Overview */}
            {connection.stats?.projects?.length ? (
              <div className="mb-6">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">
                  Vue d’ensemble de la santé des projets
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(() => {
                    const healthyProjects = connection.stats.projects.filter(
                      (p) =>
                        p.latestDeployments?.[0]?.state === 'READY' && (p.targets?.production?.alias?.length ?? 0) > 0,
                    ).length;
                    const needsAttention = connection.stats.projects.filter(
                      (p) =>
                        p.latestDeployments?.[0]?.state === 'ERROR' || p.latestDeployments?.[0]?.state === 'CANCELED',
                    ).length;
                    const withCustomDomain = connection.stats.projects.filter((p) =>
                      p.targets?.production?.alias?.some((alias: string) => !alias.includes('.vercel.app')),
                    ).length;
                    const buildingProjects = connection.stats.projects.filter(
                      (p) => p.latestDeployments?.[0]?.state === 'BUILDING',
                    ).length;

                    return [
                      {
                        label: 'Sains',
                        value: healthyProjects,
                        icon: 'i-ph:check-circle',
                        color: 'text-green-500',
                        bgColor: 'bg-green-100 dark:bg-green-900/20',
                        textColor: 'text-green-800 dark:text-green-400',
                      },
                      {
                        label: 'Domaine personnalisé',
                        value: withCustomDomain,
                        icon: 'i-ph:globe',
                        color: 'text-blue-500',
                        bgColor: 'bg-blue-100 dark:bg-blue-900/20',
                        textColor: 'text-blue-800 dark:text-blue-400',
                      },
                      {
                        label: 'En construction',
                        value: buildingProjects,
                        icon: 'i-ph:gear',
                        color: 'text-yellow-500',
                        bgColor: 'bg-yellow-100 dark:bg-yellow-900/20',
                        textColor: 'text-yellow-800 dark:text-yellow-400',
                      },
                      {
                        label: 'Problèmes',
                        value: needsAttention,
                        icon: 'i-ph:warning',
                        color: 'text-red-500',
                        bgColor: 'bg-red-100 dark:bg-red-900/20',
                        textColor: 'text-red-800 dark:text-red-400',
                      },
                    ];
                  })().map((metric, index) => (
                    <div
                      key={index}
                      className={`flex flex-col p-3 rounded-lg border border-bolt-elements-borderColor ${metric.bgColor}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`${metric.icon} w-4 h-4 ${metric.color}`} />
                        <span className="text-xs text-bolt-elements-textSecondary">{metric.label}</span>
                      </div>
                      <span className={`text-lg font-medium ${metric.textColor}`}>{metric.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {connection.stats?.projects?.length ? (
              <div className="grid gap-3">
                {connection.stats.projects.map((project) => (
                  <div
                    key={project.id}
                    className="p-4 rounded-lg border border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70 transition-colors bg-bolt-elements-background-depth-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h5 className="text-sm font-medium text-bolt-elements-textPrimary flex items-center gap-2">
                          <div className="i-ph:globe w-4 h-4 text-bolt-elements-borderColorActive" />
                          {project.name}
                        </h5>
                        <div className="flex items-center gap-2 mt-2 text-xs text-bolt-elements-textSecondary">
                          {project.targets?.production?.alias && project.targets.production.alias.length > 0 ? (
                            <>
                              <a
                                href={`https://${project.targets.production.alias.find((a: string) => a.endsWith('.vercel.app') && !a.includes('-projects.vercel.app')) || project.targets.production.alias[0]}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-bolt-elements-borderColorActive underline"
                              >
                                {project.targets.production.alias.find(
                                  (a: string) => a.endsWith('.vercel.app') && !a.includes('-projects.vercel.app'),
                                ) || project.targets.production.alias[0]}
                              </a>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <div className="i-ph:clock w-3 h-3" />
                                {new Date(project.createdAt).toLocaleDateString('fr-FR')}
                              </span>
                            </>
                          ) : project.latestDeployments && project.latestDeployments.length > 0 ? (
                            <>
                              <a
                                href={`https://${project.latestDeployments[0].url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-bolt-elements-borderColorActive underline"
                              >
                                {project.latestDeployments[0].url}
                              </a>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <div className="i-ph:clock w-3 h-3" />
                                {new Date(project.latestDeployments[0].created).toLocaleDateString('fr-FR')}
                              </span>
                            </>
                          ) : null}
                        </div>

                        {/* Project Details Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-3 pt-3 border-t border-bolt-elements-borderColor">
                          <div className="text-center">
                            <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                              {/* Deployments - This would be fetched from API */}
                              --
                            </div>
                            <div className="text-xs text-bolt-elements-textSecondary flex items-center justify-center gap-1">
                              <div className="i-ph:rocket w-3 h-3" />
                              Déploiements
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                              {/* Domains - This would be fetched from API */}
                              --
                            </div>
                            <div className="text-xs text-bolt-elements-textSecondary flex items-center justify-center gap-1">
                              <div className="i-ph:globe w-3 h-3" />
                              Domaines
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                              {/* Team Members - This would be fetched from API */}
                              --
                            </div>
                            <div className="text-xs text-bolt-elements-textSecondary flex items-center justify-center gap-1">
                              <div className="i-ph:users w-3 h-3" />
                              Équipe
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                              {/* Bandwidth - This would be fetched from API */}
                              --
                            </div>
                            <div className="text-xs text-bolt-elements-textSecondary flex items-center justify-center gap-1">
                              <div className="i-ph:activity w-3 h-3" />
                              Bande passante
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {project.latestDeployments && project.latestDeployments.length > 0 && (
                          <div
                            className={classNames(
                              'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
                              project.latestDeployments[0].state === 'READY'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                                : project.latestDeployments[0].state === 'ERROR'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                                  : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400',
                            )}
                          >
                            <div
                              className={classNames(
                                'w-2 h-2 rounded-full',
                                project.latestDeployments[0].state === 'READY'
                                  ? 'bg-green-500'
                                  : project.latestDeployments[0].state === 'ERROR'
                                    ? 'bg-red-500'
                                    : 'bg-yellow-500',
                              )}
                            />
                            {DEPLOYMENT_STATE_LABELS[project.latestDeployments[0].state] ||
                              project.latestDeployments[0].state}
                          </div>
                        )}
                        {project.framework && (
                          <div className="text-xs text-bolt-elements-textSecondary px-2 py-1 rounded-md bg-bolt-elements-background-depth-2">
                            <span className="flex items-center gap-1">
                              <div className="i-ph:code w-3 h-3" />
                              {project.framework}
                            </span>
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`https://vercel.com/dashboard/${project.id}`, '_blank')}
                          disabled={
                            !permissionsInitialized ||
                            toolEnabled[getConnectorPermissionKey('vercel', 'view_dashboard')] === false
                          }
                          className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                        >
                          <div className="i-ph:arrow-square-out w-3 h-3" />
                          Voir
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-1 mt-3 pt-3 border-t border-bolt-elements-borderColor">
                      {projectActions
                        .filter(
                          (action) =>
                            permissionsInitialized &&
                            toolEnabled[getConnectorPermissionKey('vercel', action.permissionId)] !== false,
                        )
                        .map((action) => (
                          <Button
                            key={action.name}
                            variant={action.variant || 'outline'}
                            size="sm"
                            onClick={() => handleProjectAction(project.id, action)}
                            disabled={isProjectActionLoading}
                            className="flex items-center gap-1 text-xs px-2 py-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                          >
                            <div className={`${action.icon} w-2.5 h-2.5`} />
                            {action.name}
                          </Button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-bolt-elements-textSecondary flex items-center gap-2 p-4">
                <div className="i-ph:info w-4 h-4" />
                Aucun projet trouvé dans votre compte Vercel
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }, [
    connection.stats,
    fetchingStats,
    isProjectsExpanded,
    isProjectActionLoading,
    handleProjectAction,
    projectActions,
  ]);

  console.log('connection', connection);

  return (
    <div className="space-y-6">
      {confirmDialog}
      <ServiceHeader
        icon={VercelLogo}
        title="Intégration Vercel"
        description="Connectez et gérez vos projets Vercel avec des contrôles de déploiement avancés et des analyses"
        onTestConnection={connection.user ? () => testConnection() : undefined}
        isTestingConnection={isTestingConnection}
      />

      <ConnectorActionPermissions
        connector="vercel"
        actions={[
          { id: 'redeploy', name: 'Redéployer', description: 'Lancer un nouveau déploiement de production.' },
          {
            id: 'view_dashboard',
            name: 'Voir le tableau de bord',
            description: 'Ouvrir le tableau de bord du projet.',
          },
          {
            id: 'view_deployments',
            name: 'Voir les déploiements',
            description: 'Ouvrir l’historique des déploiements.',
          },
          { id: 'view_functions', name: 'Voir les fonctions', description: 'Ouvrir les fonctions serverless.' },
          { id: 'view_analytics', name: 'Voir les analyses', description: 'Ouvrir les analyses du projet.' },
          { id: 'view_domains', name: 'Voir les domaines', description: 'Ouvrir les domaines du projet.' },
          { id: 'view_settings', name: 'Voir les réglages', description: 'Ouvrir les réglages du projet.' },
          { id: 'view_logs', name: 'Voir les journaux', description: 'Ouvrir les journaux du projet.' },
          { id: 'delete_project', name: 'Supprimer le projet', description: 'Supprimer définitivement un projet.' },
        ]}
      />

      <ConnectionTestIndicator testResult={connectionTest} />

      {/* Main Connection Component */}
      <motion.div
        className="bg-bolt-elements-background dark:bg-bolt-elements-background border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="p-6 space-y-6">
          {!connection.user ? (
            <div className="space-y-4">
              <div className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 p-3 rounded-lg mb-4">
                <p className="flex items-center gap-1 mb-1">
                  <span className="i-ph:lightbulb w-3.5 h-3.5 text-bolt-elements-icon-success dark:text-bolt-elements-icon-success" />
                  <span className="font-medium">Astuce :</span> vous pouvez aussi définir la variable d’environnement{' '}
                  <code className="px-1 py-0.5 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 rounded">
                    VITE_VERCEL_ACCESS_TOKEN
                  </code>{' '}
                  pour vous connecter automatiquement.
                </p>
              </div>

              <div>
                <label className="block text-sm text-bolt-elements-textSecondary mb-2">Jeton d’accès personnel</label>
                <input
                  type="password"
                  value={connection.token}
                  onChange={(e) => updateVercelConnection({ ...connection, token: e.target.value })}
                  disabled={connecting}
                  placeholder="Saisissez votre jeton d’accès personnel Vercel"
                  className={classNames(
                    'w-full px-3 py-2 rounded-lg text-sm',
                    'bg-[#F8F8F8] dark:bg-[#1A1A1A]',
                    'border border-[#E5E5E5] dark:border-[#333333]',
                    'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-1 focus:ring-bolt-elements-borderColorActive',
                    'disabled:opacity-50',
                  )}
                />
                <div className="mt-2 text-sm text-bolt-elements-textSecondary">
                  <a
                    href="https://vercel.com/account/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bolt-elements-borderColorActive hover:underline inline-flex items-center gap-1"
                  >
                    Obtenir votre jeton
                    <div className="i-ph:arrow-square-out w-4 h-4" />
                  </a>
                </div>
              </div>

              <button
                onClick={handleConnect}
                disabled={connecting || !connection.token}
                className={classNames(
                  'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                  'bg-[#303030] text-white',
                  'hover:bg-[#5E41D0] hover:text-white',
                  'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                  'transform active:scale-95',
                )}
              >
                {connecting ? (
                  <>
                    <div className="i-ph:spinner-gap animate-spin" />
                    Connexion…
                  </>
                ) : (
                  <>
                    <div className="i-ph:plug-charging w-4 h-4" />
                    Connecter
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDisconnect}
                    className={classNames(
                      'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                      'bg-red-500 text-white',
                      'hover:bg-red-600',
                    )}
                  >
                    <div className="i-ph:plug w-4 h-4" />
                    Déconnecter
                  </button>
                  <span className="text-sm text-bolt-elements-textSecondary flex items-center gap-1">
                    <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                    Connecté à Vercel
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 rounded-lg">
                  <img
                    src={`https://vercel.com/api/www/avatar?u=${connection.user?.username}`}
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    alt="Avatar de l’utilisateur"
                    className="w-12 h-12 rounded-full border-2 border-bolt-elements-borderColorActive"
                  />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-bolt-elements-textPrimary">
                      {connection.user?.username || 'Vercel User'}
                    </h4>
                    <p className="text-sm text-bolt-elements-textSecondary">
                      {connection.user?.email || 'Aucune adresse e-mail'}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-bolt-elements-textSecondary">
                      <span className="flex items-center gap-1">
                        <div className="i-ph:buildings w-3 h-3" />
                        {(() => {
                          const projectCount = connection.stats?.totalProjects || 0;
                          return `${projectCount} ${projectCount > 1 ? 'projets' : 'projet'}`;
                        })()}
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="i-ph:check-circle w-3 h-3" />
                        {connection.stats?.projects.filter((p) => p.latestDeployments?.[0]?.state === 'READY').length ||
                          0}{' '}
                        En ligne
                      </span>
                      <span className="flex items-center gap-1">
                        <div className="i-ph:users w-3 h-3" />
                        {/* Team size would be fetched from API */}
                        --
                      </span>
                    </div>
                  </div>
                </div>

                {/* Usage Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent" />
                      <span className="text-xs font-medium text-bolt-elements-textPrimary">Projets</span>
                    </div>
                    <div className="text-sm text-bolt-elements-textSecondary">
                      <div>
                        Actifs :{' '}
                        {connection.stats?.projects.filter((p) => p.latestDeployments?.[0]?.state === 'READY').length ||
                          0}
                      </div>
                      <div>Total : {connection.stats?.totalProjects || 0}</div>
                    </div>
                  </div>
                  <div className="p-3 bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="i-ph:globe w-4 h-4 text-bolt-elements-item-contentAccent" />
                      <span className="text-xs font-medium text-bolt-elements-textPrimary">Domaines</span>
                    </div>
                    <div className="text-sm text-bolt-elements-textSecondary">
                      {/* Domain usage would be fetched from API */}
                      <div>Personnalisés : --</div>
                      <div>Vercel : --</div>
                    </div>
                  </div>
                  <div className="p-3 bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="i-ph:activity w-4 h-4 text-bolt-elements-item-contentAccent" />
                      <span className="text-xs font-medium text-bolt-elements-textPrimary">Utilisation</span>
                    </div>
                    <div className="text-sm text-bolt-elements-textSecondary">
                      {/* Usage metrics would be fetched from API */}
                      <div>Bande passante : --</div>
                      <div>Requêtes : --</div>
                    </div>
                  </div>
                </div>
              </div>

              {renderProjects()}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
