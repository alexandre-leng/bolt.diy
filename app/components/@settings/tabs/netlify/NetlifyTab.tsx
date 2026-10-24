import { useStore } from '@nanostores/react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { motion } from 'framer-motion';
import React, { useState, useEffect } from 'react';
import {
  ConnectorActionPermissions,
  getConnectorPermissionKey,
} from '~/components/@settings/shared/ConnectorActionPermissions';
import { Badge } from '~/components/ui/Badge';
import { Button } from '~/components/ui/Button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '~/components/ui/Collapsible';
import { useConfirmDialog, actionConfirmOptions, type ConfirmOptions } from '~/components/ui/useConfirmDialog';
import { useMCPStore } from '~/lib/stores/mcp';
import { netlifyConnection, updateNetlifyConnection, initializeNetlifyConnection } from '~/lib/stores/netlify';
import { toast } from '~/lib/toastify';
import type { NetlifySite, NetlifyDeploy, NetlifyBuild, NetlifyUser } from '~/types/netlify';
import { classNames } from '~/utils/classNames';

interface ConnectionTestResult {
  status: 'success' | 'error' | 'testing';
  message: string;
  timestamp?: number;
}

interface SiteAction {
  name: string;
  permissionId: string;
  icon: string;
  action: (siteId: string) => Promise<void>;
  requiresConfirmation?: boolean;
  variant?: 'default' | 'destructive' | 'outline';
  confirmation?: Partial<ConfirmOptions>;
}

// Netlify logo SVG component
const NetlifyLogo = () => (
  <svg viewBox="0 0 40 40" className="w-5 h-5">
    <path
      fill="currentColor"
      d="M28.589 14.135l-.014-.006c-.008-.003-.016-.006-.023-.013a.11.11 0 0 1-.028-.093l.773-4.726 3.625 3.626-3.77 1.604a.083.083 0 0 1-.033.006h-.015c-.005-.003-.01-.007-.02-.017a1.716 1.716 0 0 0-.495-.381zm5.258-.288l3.876 3.876c.805.806 1.208 1.208 1.674 1.355a2 2 0 0 1 1.206 0c.466-.148.869-.55 1.674-1.356L8.73 28.73l2.349-3.643c.011-.018.022-.034.04-.047.025-.018.061-.01.091 0a2.434 2.434 0 0 0 1.638-.083c.027-.01.054-.017.075.002a.19.19 0 0 1 .028.032L21.95 38.05zM7.863 27.863L5.8 25.8l4.074-1.738a.084.084 0 0 1 .033-.007c.034 0 .054.034.072.065a2.91 2.91 0 0 0 .13.184l.013.016c.012.017.004.034-.008.05l-2.25 3.493zm-2.976-2.976l-2.61-2.61c-.444-.444-.766-.766-.99-1.043l7.936 1.646a.84.84 0 0 0 .03.005c.049.008.103.017.103.063 0 .05-.059.073-.109.092l-.023.01-4.337 1.837zM.831 19.892a2 2 0 0 1 .09-.495c.148-.466.55-.868 1.356-1.674l3.34-3.34a2175.525 2175.525 0 0 0 4.626 6.687c.027.036.057.076.026.106-.146.161-.292.337-.395.528a.16.16 0 0 1-.05.062c-.013.008-.027.005-.042.002H9.78L.831 19.892zm5.68-6.403l4.491-4.491c.422.185 1.958.834 3.332 1.414 1.04.44 1.988.84 2.286.97.03.012.057.024.07.054.008.018.004.041 0 .06a2.003 2.003 0 0 0 .523 1.828c.03.03 0 .073-.026.11l-.014.021-4.56 7.063c-.012.02-.023.037-.043.05-.024.015-.058.008-.086.001a2.274 2.274 0 0 0-.543-.074c-.164 0-.342.03-.522.063h-.001c-.02.003-.038.007-.054-.005a.21.21 0 0 1-.045-.051l-4.808-7.013zm5.398-5.398l5.814-5.814c.805-.805 1.208-1.208 1.674-1.355a2 2 0 0 1 1.206 0c.466.147.869.55 1.674 1.355l1.26 1.26-4.135 6.404a.155.155 0 0 1-.041.048c-.025.017-.06.01-.09 0a2.097 2.097 0 0 0-1.92.37c-.027.028-.067.012-.101-.003-.54-.235-4.74-2.01-5.341-2.265zm12.506-3.676l3.818 3.818-.92 5.698v.015a.135.135 0 0 1-.008.038c-.01.02-.03.024-.05.03a1.83 1.83 0 0 0-.548.273.154.154 0 0 0-.02.017c-.011.012-.022.023-.04.025a.114.114 0 0 1-.043-.007l-5.818-2.472-.011-.005c-.037-.015-.081-.033-.081-.071a2.198 2.198 0 0 0-.31-.915c-.028-.046-.059-.094-.035-.141l4.066-6.303zm-3.932 8.606l5.454 2.31c.03.014.063.027.076.058a.106.106 0 0 1 0 .057c-.016.08-.03.171-.03.263v.153c0 .038-.039.054-.075.069l-.011.004c-.864.369-12.13 5.173-12.147 5.173-.017 0-.035 0-.052-.017-.03-.03 0-.072.027-.11a.76.76 0 0 0 .014-.02l4.482-6.94.008-.012c.026-.042.056-.089.104-.089l.045.007c.102.014.192.027.283.027.68 0 1.31-.331 1.69-.897a.16.16 0 0 1 .034-.04c.027-.02.067-.01.098.004zm-6.246 9.185l12.28-5.237s.018 0 .035.017c.067.067.124.112.179.154l.027.017c.025.014.05.03.052.056 0 .01 0 .016-.002.025L25.756 23.7l-.004.026c-.007.05-.014.107-.061.107a1.729 1.729 0 0 0-1.373.847l-.005.008c-.014.023-.027.045-.05.057-.021.01-.048.006-.07.001l-9.793-2.02c-.01-.002-.152-.519-.163-.52z"
    />
  </svg>
);

// Libellés d’affichage des états techniques renvoyés par l’API Netlify
const DEPLOY_STATE_LABELS: Record<string, string> = {
  ready: 'Prêt',
  error: 'Erreur',
  building: 'En cours de build',
  processing: 'En cours de traitement',
  enqueued: 'En file d’attente',
  new: 'Nouveau',
  pending_review: 'En attente de validation',
  uploaded: 'Téléversé',
  rejected: 'Rejeté',
  accepted: 'Accepté',
};

const DEPLOY_ACTION_LABELS: Record<'publish' | 'lock' | 'unlock', string> = {
  publish: 'Déploiement publié',
  lock: 'Déploiement verrouillé',
  unlock: 'Déploiement déverrouillé',
};

const DEPLOY_ACTION_ERRORS: Record<'publish' | 'lock' | 'unlock', string> = {
  publish: 'Impossible de publier le déploiement',
  lock: 'Impossible de verrouiller le déploiement',
  unlock: 'Impossible de déverrouiller le déploiement',
};

export default function NetlifyTab() {
  const { askConfirmation, confirmDialog } = useConfirmDialog();
  const toolEnabled = useMCPStore((state) => state.settings.toolEnabled);
  const permissionsInitialized = useMCPStore((state) => state.isInitialized);
  const connection = useStore(netlifyConnection);
  const [tokenInput, setTokenInput] = useState('');
  const [fetchingStats, setFetchingStats] = useState(false);
  const [sites, setSites] = useState<NetlifySite[]>([]);
  const [deploys, setDeploys] = useState<NetlifyDeploy[]>([]);
  const [deploymentCount, setDeploymentCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState('');
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [activeSiteIndex, setActiveSiteIndex] = useState(0);
  const [isSitesExpanded, setIsSitesExpanded] = useState(false);
  const [isDeploysExpanded, setIsDeploysExpanded] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionTest, setConnectionTest] = useState<ConnectionTestResult | null>(null);

  // Connection testing function
  const testConnection = async () => {
    if (!connection.token) {
      setConnectionTest({
        status: 'error',
        message: 'Aucun jeton fourni',
        timestamp: Date.now(),
      });
      return;
    }

    setConnectionTest({
      status: 'testing',
      message: 'Test de la connexion…',
    });

    try {
      const response = await fetch('https://api.netlify.com/api/v1/user', {
        headers: {
          Authorization: `Bearer ${connection.token}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        setConnectionTest({
          status: 'success',
          message: `Connexion établie avec le compte ${data.email}`,
          timestamp: Date.now(),
        });
      } else {
        setConnectionTest({
          status: 'error',
          message: `Échec de la connexion : ${response.status} ${response.statusText}`,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      setConnectionTest({
        status: 'error',
        message: `Échec de la connexion : ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
        timestamp: Date.now(),
      });
    }
  };

  // Site actions
  const siteActions: SiteAction[] = [
    {
      name: 'Vider le cache',
      permissionId: 'clear_cache',
      icon: 'i-ph:arrows-clockwise',
      action: async (siteId: string) => {
        try {
          setIsActionLoading(true);

          // Try to get site details first to check for build hooks
          const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!siteResponse.ok) {
            const errorText = await siteResponse.text();

            if (siteResponse.status === 404) {
              toast.error('Site introuvable. Il s’agit peut-être d’une limitation du compte gratuit.');
              return;
            }

            throw new Error(`Impossible de récupérer les détails du site : ${errorText}`);
          }

          const siteData = (await siteResponse.json()) as any;

          // Check if this looks like a free account (limited features)
          const isFreeAccount = !siteData.plan || siteData.plan === 'free' || siteData.plan === 'starter';

          // If site has build hooks, try triggering a build instead
          if (siteData.build_settings && siteData.build_settings.repo_url) {
            // Try to trigger a build by making a POST to the site's build endpoint
            const buildResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${connection.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                clear_cache: true,
              }),
            });

            if (buildResponse.ok) {
              toast.success('Build déclenché avec vidage du cache');
              return;
            } else if (buildResponse.status === 422) {
              // Often indicates free account limitation
              toast.warning(
                'Échec du déclenchement du build. Cette fonctionnalité n’est peut-être pas disponible sur les comptes gratuits.',
              );
              return;
            }
          }

          // Fallback: Try the standard cache purge endpoint
          const cacheResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/purge_cache`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!cacheResponse.ok) {
            if (cacheResponse.status === 404) {
              if (isFreeAccount) {
                toast.warning(
                  'Vidage du cache indisponible sur les comptes gratuits. Essayez plutôt de déclencher un build.',
                );
              } else {
                toast.error(
                  'Point de terminaison de vidage du cache introuvable. Cette fonctionnalité n’est peut-être pas disponible.',
                );
              }

              return;
            }

            const errorText = await cacheResponse.text();
            throw new Error(`Échec du vidage du cache : ${errorText}`);
          }

          toast.success('Cache du site vidé avec succès');
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de vider le cache du site: ${error}`);
        } finally {
          setIsActionLoading(false);
        }
      },
    },
    {
      name: 'Gérer l’environnement',
      permissionId: 'manage_environment',
      icon: 'i-ph:gear',
      action: async (siteId: string) => {
        try {
          setIsActionLoading(true);

          // Get site info first to check account type
          const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!siteResponse.ok) {
            throw new Error('Impossible de récupérer les détails du site');
          }

          const siteData = (await siteResponse.json()) as any;
          const isFreeAccount = !siteData.plan || siteData.plan === 'free' || siteData.plan === 'starter';

          // Get environment variables
          const envResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/env`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (envResponse.ok) {
            const envVars = (await envResponse.json()) as any[];
            toast.success(`Variables d’environnement chargées : ${envVars.length} variables`);
          } else if (envResponse.status === 404) {
            if (isFreeAccount) {
              toast.info('La gestion des variables d’environnement est limitée sur les comptes gratuits');
            } else {
              toast.info('Aucune variable d’environnement n’est configurée pour ce site');
            }
          } else {
            const errorText = await envResponse.text();
            toast.error(`Impossible de charger les variables d’environnement : ${errorText}`);
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de charger les variables d’environnement: ${error}`);
        } finally {
          setIsActionLoading(false);
        }
      },
    },
    {
      name: 'Déclencher un build',
      permissionId: 'trigger_build',
      icon: 'i-ph:rocket-launch',
      action: async (siteId: string) => {
        try {
          setIsActionLoading(true);

          const buildResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/builds`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${connection.token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!buildResponse.ok) {
            throw new Error('Impossible de déclencher le build');
          }

          const buildData = (await buildResponse.json()) as any;
          toast.success(`Build déclenché avec succès. ID : ${buildData.id}`);
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de déclencher le build: ${error}`);
        } finally {
          setIsActionLoading(false);
        }
      },
    },
    {
      name: 'Voir les fonctions',
      permissionId: 'view_functions',
      icon: 'i-ph:code',
      action: async (siteId: string) => {
        try {
          setIsActionLoading(true);

          // Get site info first to check account type
          const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!siteResponse.ok) {
            throw new Error('Impossible de récupérer les détails du site');
          }

          const siteData = (await siteResponse.json()) as any;
          const isFreeAccount = !siteData.plan || siteData.plan === 'free' || siteData.plan === 'starter';

          const functionsResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/functions`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (functionsResponse.ok) {
            const functions = (await functionsResponse.json()) as any[];
            toast.success(`Le site compte ${functions.length} fonctions serverless`);
          } else if (functionsResponse.status === 404) {
            if (isFreeAccount) {
              toast.info('Les fonctions sont peut-être limitées ou indisponibles sur les comptes gratuits');
            } else {
              toast.info('Ce site n’a aucune fonction serverless');
            }
          } else {
            const errorText = await functionsResponse.text();
            toast.error(`Impossible de charger les fonctions : ${errorText}`);
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de charger les fonctions: ${error}`);
        } finally {
          setIsActionLoading(false);
        }
      },
    },
    {
      name: 'Statistiques du site',
      permissionId: 'site_analytics',
      icon: 'i-ph:chart-bar',
      action: async (siteId: string) => {
        try {
          setIsActionLoading(true);

          // Get site info first to check account type
          const siteResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!siteResponse.ok) {
            throw new Error('Impossible de récupérer les détails du site');
          }

          const siteData = (await siteResponse.json()) as any;
          const isFreeAccount = !siteData.plan || siteData.plan === 'free' || siteData.plan === 'starter';

          // Get site traffic data (if available)
          const analyticsResponse = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/traffic`, {
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (analyticsResponse.ok) {
            await analyticsResponse.json(); // Analytics data received
            toast.success('Statistiques du site chargées avec succès');
          } else if (analyticsResponse.status === 404) {
            if (isFreeAccount) {
              toast.info(
                'Statistiques indisponibles sur les comptes gratuits. Affichage des informations de base du site.',
              );
            }

            // Fallback to basic site info
            toast.info(
              `Site : ${siteData.name}, statut : ${DEPLOY_STATE_LABELS[siteData.state] ?? siteData.state ?? 'Inconnu'}`,
            );
          } else {
            const errorText = await analyticsResponse.text();

            if (isFreeAccount) {
              toast.info(
                'Statistiques indisponibles sur les comptes gratuits. Informations du site : ' +
                  `${siteData.name} (${DEPLOY_STATE_LABELS[siteData.state] ?? siteData.state ?? 'Inconnu'})`,
              );
            } else {
              toast.error(`Impossible de charger les statistiques : ${errorText}`);
            }
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de charger les statistiques du site: ${error}`);
        } finally {
          setIsActionLoading(false);
        }
      },
    },
    {
      name: 'Supprimer le site',
      permissionId: 'delete_site',
      icon: 'i-ph:trash',
      action: async (siteId: string) => {
        try {
          const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${connection.token}`,
            },
          });

          if (!response.ok) {
            throw new Error('Impossible de supprimer le site');
          }

          toast.success('Site supprimé avec succès');
          fetchNetlifyStats(connection.token);
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : 'Erreur inconnue';
          toast.error(`Impossible de supprimer le site : ${error}`);
        }
      },
      requiresConfirmation: true,
      variant: 'destructive',
      confirmation: {
        title: 'Supprimer ce site Netlify ?',
        description:
          'Le site et ses déploiements seront définitivement supprimés de Netlify. Cette action est irréversible.',
        confirmLabel: 'Supprimer le site',
      },
    },
  ];

  // Deploy management functions
  const handleDeploy = async (siteId: string, deployId: string, action: 'lock' | 'unlock' | 'publish') => {
    if (!permissionsInitialized || toolEnabled[getConnectorPermissionKey('netlify', `deploy_${action}`)] === false) {
      return;
    }

    try {
      setIsActionLoading(true);

      const endpoint =
        action === 'publish'
          ? `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployId}/restore`
          : `https://api.netlify.com/api/v1/deploys/${deployId}/${action}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Impossible de ${action === 'publish' ? 'publier' : action === 'lock' ? 'verrouiller' : 'déverrouiller'} ce déploiement`,
        );
      }

      toast.success(`${DEPLOY_ACTION_LABELS[action]} avec succès`);
      fetchNetlifyStats(connection.token);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(`${DEPLOY_ACTION_ERRORS[action]} : ${error}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  useEffect(() => {
    // Initialize connection with environment token if available
    initializeNetlifyConnection();
  }, []);

  useEffect(() => {
    // Check if we have a connection with a token but no stats
    if (connection.user && connection.token && (!connection.stats || !connection.stats.sites)) {
      fetchNetlifyStats(connection.token);
    }

    // Update local state from connection
    if (connection.stats) {
      setSites(connection.stats.sites || []);
      setDeploys(connection.stats.deploys || []);
      setDeploymentCount(connection.stats.deploys?.length || 0);
      setLastUpdated(connection.stats.lastDeployTime || '');
    }
  }, [connection]);

  const handleConnect = async () => {
    if (!tokenInput) {
      toast.error('Veuillez saisir un jeton API Netlify');
      return;
    }

    setIsConnecting(true);

    try {
      const response = await fetch('https://api.netlify.com/api/v1/user', {
        headers: {
          Authorization: `Bearer ${tokenInput}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Erreur HTTP. Statut : ${response.status}`);
      }

      const userData = (await response.json()) as NetlifyUser;

      // Update the connection store
      updateNetlifyConnection({
        user: userData,
        token: tokenInput,
      });

      toast.success('Connexion à Netlify réussie');

      // Fetch stats after successful connection
      fetchNetlifyStats(tokenInput);
    } catch (error) {
      console.error('Error connecting to Netlify:', error);
      toast.error(
        `Impossible de se connecter à Netlify : ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      );
    } finally {
      setIsConnecting(false);
      setTokenInput('');
    }
  };

  const handleDisconnect = () => {
    // Clear from localStorage
    localStorage.removeItem('netlify_connection');

    // Remove cookies
    document.cookie = 'netlifyToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

    // Update the store
    updateNetlifyConnection({ user: null, token: '' });
    setConnectionTest(null);
    toast.success('Déconnexion de Netlify effectuée');
  };

  const fetchNetlifyStats = async (token: string) => {
    setFetchingStats(true);

    try {
      // Fetch sites
      const sitesResponse = await fetch('https://api.netlify.com/api/v1/sites', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!sitesResponse.ok) {
        throw new Error(`Impossible de récupérer les sites : ${sitesResponse.statusText}`);
      }

      const sitesData = (await sitesResponse.json()) as NetlifySite[];
      setSites(sitesData);

      // Fetch deploys and builds for ALL sites
      const allDeploysData: NetlifyDeploy[] = [];
      const allBuildsData: NetlifyBuild[] = [];

      let lastDeployTime = '';
      let totalDeploymentCount = 0;

      if (sitesData && sitesData.length > 0) {
        // Process sites in batches to avoid overwhelming the API
        const batchSize = 3;
        const siteBatches = [];

        for (let i = 0; i < sitesData.length; i += batchSize) {
          siteBatches.push(sitesData.slice(i, i + batchSize));
        }

        for (const batch of siteBatches) {
          const batchPromises = batch.map(async (site) => {
            try {
              // Fetch deploys for this site
              const deploysResponse = await fetch(
                `https://api.netlify.com/api/v1/sites/${site.id}/deploys?per_page=20`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                },
              );

              let siteDeploys: NetlifyDeploy[] = [];

              if (deploysResponse.ok) {
                siteDeploys = (await deploysResponse.json()) as NetlifyDeploy[];
              }

              // Fetch builds for this site
              const buildsResponse = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/builds?per_page=10`, {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });

              let siteBuilds: NetlifyBuild[] = [];

              if (buildsResponse.ok) {
                siteBuilds = (await buildsResponse.json()) as NetlifyBuild[];
              }

              return { site, deploys: siteDeploys, builds: siteBuilds };
            } catch (error) {
              console.error(`Failed to fetch data for site ${site.name}:`, error);
              return { site, deploys: [], builds: [] };
            }
          });

          const batchResults = await Promise.all(batchPromises);

          for (const result of batchResults) {
            allDeploysData.push(...result.deploys);
            allBuildsData.push(...result.builds);
            totalDeploymentCount += result.deploys.length;
          }

          // Small delay between batches
          if (batch !== siteBatches[siteBatches.length - 1]) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        // Sort deploys by creation date (newest first)
        allDeploysData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // Set the most recent deploy time
        if (allDeploysData.length > 0) {
          lastDeployTime = allDeploysData[0].created_at;
          setLastUpdated(lastDeployTime);
        }

        setDeploys(allDeploysData);
        setDeploymentCount(totalDeploymentCount);
      }

      // Update the stats in the store
      updateNetlifyConnection({
        stats: {
          sites: sitesData,
          deploys: allDeploysData,
          builds: allBuildsData,
          lastDeployTime,
          totalSites: sitesData.length,
          totalDeploys: totalDeploymentCount,
          totalBuilds: allBuildsData.length,
        },
      });

      toast.success('Statistiques Netlify mises à jour');
    } catch (error) {
      console.error('Error fetching Netlify stats:', error);
      toast.error(
        `Impossible de récupérer les statistiques Netlify : ${error instanceof Error ? error.message : 'Erreur inconnue'}`,
      );
    } finally {
      setFetchingStats(false);
    }
  };

  const renderStats = () => {
    if (!connection.user || !connection.stats) {
      return null;
    }

    return (
      <div className="mt-6">
        <Collapsible open={isStatsOpen} onOpenChange={setIsStatsOpen}>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between p-4 rounded-lg bg-bolt-elements-background dark:bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70 dark:hover:border-bolt-elements-borderColorActive/70 transition-all duration-200 cursor-pointer">
              <div className="flex items-center gap-2">
                <div className="i-ph:chart-bar w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                <span className="text-sm font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                  Statistiques Netlify
                </span>
              </div>
              <div
                className={classNames(
                  'i-ph:caret-down w-4 h-4 transform transition-transform duration-200 text-bolt-elements-textSecondary',
                  isStatsOpen ? 'rotate-180' : '',
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden">
            <div className="space-y-4 mt-4">
              {/* Netlify Overview Dashboard */}
              <div className="mb-6 p-4 bg-bolt-elements-background-depth-1 rounded-lg border border-bolt-elements-borderColor">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary mb-3">Aperçu Netlify</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {connection.stats.totalSites}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Sites au total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {connection.stats.totalDeploys || deploymentCount}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Déploiements au total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {connection.stats.totalBuilds || 0}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Builds au total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-bolt-elements-textPrimary">
                      {sites.filter((site) => site.published_deploy?.state === 'ready').length}
                    </div>
                    <div className="text-xs text-bolt-elements-textSecondary">Sites en ligne</div>
                  </div>
                </div>
              </div>

              {/* Advanced Analytics */}
              <div className="mb-6 space-y-4">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Statistiques de déploiement</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor">
                    <h6 className="text-xs font-medium text-bolt-elements-textPrimary flex items-center gap-2 mb-2">
                      <div className="i-ph:chart-pie w-4 h-4 text-bolt-elements-item-contentAccent" />
                      Taux de réussite
                    </h6>
                    <div className="space-y-1">
                      {(() => {
                        const successfulDeploys = deploys.filter((deploy) => deploy.state === 'ready').length;
                        const failedDeploys = deploys.filter((deploy) => deploy.state === 'error').length;

                        const successRate =
                          deploys.length > 0 ? Math.round((successfulDeploys / deploys.length) * 100) : 0;

                        return [
                          { label: 'Taux de réussite', value: `${successRate}%` },
                          { label: 'Réussis', value: successfulDeploys },
                          { label: 'Échoués', value: failedDeploys },
                        ];
                      })().map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-bolt-elements-textSecondary">{item.label}:</span>
                          <span className="text-bolt-elements-textPrimary font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-bolt-elements-background-depth-2 p-3 rounded-lg border border-bolt-elements-borderColor">
                    <h6 className="text-xs font-medium text-bolt-elements-textPrimary flex items-center gap-2 mb-2">
                      <div className="i-ph:clock w-4 h-4 text-bolt-elements-item-contentAccent" />
                      Activité récente
                    </h6>
                    <div className="space-y-1">
                      {(() => {
                        const now = Date.now();

                        const last24Hours = deploys.filter(
                          (deploy) => now - new Date(deploy.created_at).getTime() < 24 * 60 * 60 * 1000,
                        ).length;
                        const last7Days = deploys.filter(
                          (deploy) => now - new Date(deploy.created_at).getTime() < 7 * 24 * 60 * 60 * 1000,
                        ).length;
                        const activeSites = sites.filter((site) => {
                          const lastDeploy = site.published_deploy?.published_at;
                          return lastDeploy && now - new Date(lastDeploy).getTime() < 7 * 24 * 60 * 60 * 1000;
                        }).length;

                        return [
                          { label: 'Dernières 24 heures', value: last24Hours },
                          { label: 'Derniers 7 jours', value: last7Days },
                          { label: 'Sites actifs', value: activeSites },
                        ];
                      })().map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-bolt-elements-textSecondary">{item.label}:</span>
                          <span className="text-bolt-elements-textPrimary font-medium">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Site Health Metrics */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">
                  Vue d’ensemble de la santé des sites
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {(() => {
                    const healthySites = sites.filter(
                      (site) => site.published_deploy?.state === 'ready' && site.ssl_url,
                    ).length;

                    const sslEnabled = sites.filter((site) => !!site.ssl_url).length;
                    const customDomain = sites.filter((site) => !!site.custom_domain).length;

                    const needsAttention = sites.filter(
                      (site) => site.published_deploy?.state === 'error' || !site.published_deploy,
                    ).length;
                    const buildingSites = sites.filter(
                      (site) =>
                        site.published_deploy?.state === 'building' || site.published_deploy?.state === 'processing',
                    ).length;

                    return [
                      {
                        label: 'En bonne santé',
                        value: healthySites,
                        icon: 'i-ph:heart',
                        color: 'text-green-500',
                        bgColor: 'bg-green-100 dark:bg-green-900/20',
                        textColor: 'text-green-800 dark:text-green-400',
                      },
                      {
                        label: 'SSL activé',
                        value: sslEnabled,
                        icon: 'i-ph:lock',
                        color: 'text-blue-500',
                        bgColor: 'bg-blue-100 dark:bg-blue-900/20',
                        textColor: 'text-blue-800 dark:text-blue-400',
                      },
                      {
                        label: 'Domaine personnalisé',
                        value: customDomain,
                        icon: 'i-ph:globe',
                        color: 'text-purple-500',
                        bgColor: 'bg-purple-100 dark:bg-purple-900/20',
                        textColor: 'text-purple-800 dark:text-purple-400',
                      },
                      {
                        label: 'En cours de build',
                        value: buildingSites,
                        icon: 'i-ph:gear',
                        color: 'text-yellow-500',
                        bgColor: 'bg-yellow-100 dark:bg-yellow-900/20',
                        textColor: 'text-yellow-800 dark:text-yellow-400',
                      },
                      {
                        label: 'Nécessite une attention',
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

              <div className="flex flex-wrap items-center gap-4">
                <Badge
                  variant="outline"
                  className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                >
                  <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent" />
                  <span>{connection.stats.totalSites} sites</span>
                </Badge>
                <Badge
                  variant="outline"
                  className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                >
                  <div className="i-ph:rocket-launch w-4 h-4 text-bolt-elements-item-contentAccent" />
                  <span>{deploymentCount} déploiements</span>
                </Badge>
                <Badge
                  variant="outline"
                  className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                >
                  <div className="i-ph:hammer w-4 h-4 text-bolt-elements-item-contentAccent" />
                  <span>{connection.stats.totalBuilds || 0} builds</span>
                </Badge>
                {lastUpdated && (
                  <Badge
                    variant="outline"
                    className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                  >
                    <div className="i-ph:clock w-4 h-4 text-bolt-elements-item-contentAccent" />
                    <span>
                      Mise à jour {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true, locale: fr })}
                    </span>
                  </Badge>
                )}
              </div>
              {sites.length > 0 && (
                <div className="mt-4 space-y-4">
                  <div className="bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                          <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                          Vos sites ({sites.length})
                        </h4>
                        {sites.length > 8 && (
                          <button
                            onClick={() => setIsSitesExpanded(!isSitesExpanded)}
                            className="text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
                          >
                            {isSitesExpanded ? 'Afficher moins' : `Tout afficher (${sites.length})`}
                          </button>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchNetlifyStats(connection.token)}
                        disabled={fetchingStats}
                        className="flex items-center gap-2 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive/10"
                      >
                        <div
                          className={classNames(
                            'i-ph:arrows-clockwise w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent',
                            { 'animate-spin': fetchingStats },
                          )}
                        />
                        {fetchingStats ? 'Actualisation…' : 'Actualiser'}
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {(isSitesExpanded ? sites : sites.slice(0, 8)).map((site, index) => (
                        <div
                          key={site.id}
                          className={classNames(
                            'bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border rounded-lg p-4 transition-all cursor-pointer',
                            activeSiteIndex === index
                              ? 'border-bolt-elements-item-contentAccent bg-bolt-elements-item-backgroundActive/10'
                              : 'border-bolt-elements-borderColor hover:border-bolt-elements-borderColorActive/70',
                          )}
                          onClick={() => {
                            setActiveSiteIndex(index);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="i-ph:cloud w-5 h-5 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                              <span className="font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                                {site.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={site.published_deploy?.state === 'ready' ? 'default' : 'destructive'}
                                className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                              >
                                {site.published_deploy?.state === 'ready' ? (
                                  <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                                ) : (
                                  <div className="i-ph:x-circle w-4 h-4 text-red-500" />
                                )}
                                <span className="text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                                  {(site.published_deploy?.state && DEPLOY_STATE_LABELS[site.published_deploy.state]) ||
                                    site.published_deploy?.state ||
                                    'Inconnu'}
                                </span>
                              </Badge>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <a
                                href={site.ssl_url || site.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm flex items-center gap-1 transition-colors text-bolt-elements-link-text hover:text-bolt-elements-link-textHover dark:text-white dark:hover:text-bolt-elements-link-textHover"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="i-ph:cloud w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                <span className="underline decoration-1 underline-offset-2">
                                  {site.ssl_url || site.url}
                                </span>
                              </a>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-bolt-elements-textSecondary">
                              {site.published_deploy?.framework && (
                                <div className="flex items-center gap-1">
                                  <div className="i-ph:cube w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  <span>{site.published_deploy.framework}</span>
                                </div>
                              )}
                              {site.custom_domain && (
                                <div className="flex items-center gap-1">
                                  <div className="i-ph:globe w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  <span>Domaine personnalisé</span>
                                </div>
                              )}
                              {site.branch && (
                                <div className="flex items-center gap-1">
                                  <div className="i-ph:code w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  <span>{site.branch}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {activeSiteIndex === index && (
                            <>
                              <div className="mt-4 pt-3 border-t border-bolt-elements-borderColor">
                                <div className="flex items-center gap-2">
                                  {siteActions
                                    .filter(
                                      (action) =>
                                        permissionsInitialized &&
                                        toolEnabled[getConnectorPermissionKey('netlify', action.permissionId)] !==
                                          false,
                                    )
                                    .map((action) => (
                                      <Button
                                        key={action.name}
                                        variant={action.variant || 'outline'}
                                        size="sm"
                                        onClick={async (e) => {
                                          e.stopPropagation();

                                          if (action.requiresConfirmation) {
                                            if (!(await askConfirmation(actionConfirmOptions(action)))) {
                                              return;
                                            }
                                          }

                                          setIsActionLoading(true);
                                          await action.action(site.id);
                                          setIsActionLoading(false);
                                        }}
                                        disabled={isActionLoading}
                                        className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                                      >
                                        <div
                                          className={`${action.icon} w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent`}
                                        />
                                        {action.name}
                                      </Button>
                                    ))}
                                </div>
                              </div>
                              {site.published_deploy && (
                                <div className="mt-3 text-sm">
                                  <div className="flex items-center gap-1">
                                    <div className="i-ph:clock w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                    <span className="text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                      Publié{' '}
                                      {formatDistanceToNow(new Date(site.published_deploy.published_at), {
                                        addSuffix: true,
                                        locale: fr,
                                      })}
                                    </span>
                                  </div>
                                  {site.published_deploy.branch && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <div className="i-ph:code w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                      <span className="text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                        Branche : {site.published_deploy.branch}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {deploys.length > 0 && (
                    <div className="bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-4">
                          <h4 className="text-sm font-medium flex items-center gap-2 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                            <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                            Tous les déploiements ({deploys.length})
                          </h4>
                          {deploys.length > 10 && (
                            <button
                              onClick={() => setIsDeploysExpanded(!isDeploysExpanded)}
                              className="text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
                            >
                              {isDeploysExpanded ? 'Afficher moins' : `Tout afficher (${deploys.length})`}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {(isDeploysExpanded ? deploys : deploys.slice(0, 10)).map((deploy) => (
                          <div
                            key={deploy.id}
                            className="bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    deploy.state === 'ready'
                                      ? 'default'
                                      : deploy.state === 'error'
                                        ? 'destructive'
                                        : 'outline'
                                  }
                                  className="flex items-center gap-1"
                                >
                                  {deploy.state === 'ready' ? (
                                    <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                                  ) : deploy.state === 'error' ? (
                                    <div className="i-ph:x-circle w-4 h-4 text-red-500" />
                                  ) : (
                                    <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent" />
                                  )}
                                  <span className="text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                                    {DEPLOY_STATE_LABELS[deploy.state] ?? deploy.state}
                                  </span>
                                </Badge>
                              </div>
                              <span className="text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                {formatDistanceToNow(new Date(deploy.created_at), {
                                  addSuffix: true,
                                  locale: fr,
                                })}
                              </span>
                            </div>
                            {deploy.branch && (
                              <div className="mt-2 text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary flex items-center gap-1">
                                <div className="i-ph:code w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                <span className="text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                  Branche : {deploy.branch}
                                </span>
                              </div>
                            )}
                            {deploy.deploy_url && (
                              <div className="mt-2 text-xs">
                                <a
                                  href={deploy.deploy_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 transition-colors text-bolt-elements-link-text hover:text-bolt-elements-link-textHover dark:text-white dark:hover:text-bolt-elements-link-textHover"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="i-ph:cloud w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  <span className="underline decoration-1 underline-offset-2">{deploy.deploy_url}</span>
                                </a>
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const siteForDeploy = sites.find((site) => site.id === deploy.site_id);

                                  if (siteForDeploy) {
                                    handleDeploy(siteForDeploy.id, deploy.id, 'publish');
                                  }
                                }}
                                disabled={
                                  isActionLoading ||
                                  !permissionsInitialized ||
                                  toolEnabled[getConnectorPermissionKey('netlify', 'deploy_publish')] === false
                                }
                                className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                              >
                                <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                Publier
                              </Button>
                              {deploy.state === 'ready' ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const siteForDeploy = sites.find((site) => site.id === deploy.site_id);

                                    if (siteForDeploy) {
                                      handleDeploy(siteForDeploy.id, deploy.id, 'lock');
                                    }
                                  }}
                                  disabled={
                                    isActionLoading ||
                                    !permissionsInitialized ||
                                    toolEnabled[getConnectorPermissionKey('netlify', 'deploy_lock')] === false
                                  }
                                  className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                                >
                                  <div className="i-ph:lock w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  Verrouiller
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const siteForDeploy = sites.find((site) => site.id === deploy.site_id);

                                    if (siteForDeploy) {
                                      handleDeploy(siteForDeploy.id, deploy.id, 'unlock');
                                    }
                                  }}
                                  disabled={
                                    isActionLoading ||
                                    !permissionsInitialized ||
                                    toolEnabled[getConnectorPermissionKey('netlify', 'deploy_unlock')] === false
                                  }
                                  className="flex items-center gap-1 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary"
                                >
                                  <div className="i-ph:lock-open w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                  Déverrouiller
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Builds Section */}
                  {connection.stats.builds && connection.stats.builds.length > 0 && (
                    <div className="bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium flex items-center gap-2 text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                          <div className="i-ph:hammer w-4 h-4 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                          Builds récents ({connection.stats.builds.length})
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {connection.stats.builds.slice(0, 8).map((build: any) => (
                          <div
                            key={build.id}
                            className="bg-bolt-elements-background dark:bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant={build.done ? 'default' : 'outline'} className="flex items-center gap-1">
                                  {build.done ? (
                                    <div className="i-ph:check-circle w-4 h-4 text-green-500" />
                                  ) : (
                                    <div className="i-ph:buildings w-4 h-4 text-bolt-elements-item-contentAccent" />
                                  )}
                                  <span className="text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
                                    {build.done ? 'Terminé' : 'En cours'}
                                  </span>
                                </Badge>
                              </div>
                              <span className="text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                {formatDistanceToNow(new Date(build.created_at), { addSuffix: true, locale: fr })}
                              </span>
                            </div>
                            {build.commit_ref && (
                              <div className="mt-2 text-xs text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary flex items-center gap-1">
                                <div className="i-ph:code w-3 h-3 text-bolt-elements-item-contentAccent dark:text-bolt-elements-item-contentAccent" />
                                <span className="text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
                                  {build.commit_ref.substring(0, 7)}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      {/* Header */}
      <motion.div
        className="flex items-center justify-between gap-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-2">
          <div className="text-[#00AD9F]">
            <NetlifyLogo />
          </div>
          <h2 className="text-lg font-medium text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary">
            Intégration Netlify
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {connection.user && (
            <Button
              onClick={testConnection}
              disabled={connectionTest?.status === 'testing'}
              variant="outline"
              className="flex items-center gap-2 hover:bg-bolt-elements-item-backgroundActive/10 hover:text-bolt-elements-textPrimary dark:hover:bg-bolt-elements-item-backgroundActive/10 dark:hover:text-bolt-elements-textPrimary transition-colors"
            >
              {connectionTest?.status === 'testing' ? (
                <>
                  <div className="i-ph:spinner-gap w-4 h-4 animate-spin" />
                  Test en cours…
                </>
              ) : (
                <>
                  <div className="i-ph:plug-charging w-4 h-4" />
                  Tester la connexion
                </>
              )}
            </Button>
          )}
        </div>
      </motion.div>

      <ConnectorActionPermissions
        connector="netlify"
        actions={[
          {
            id: 'clear_cache',
            name: 'Vider le cache',
            description: 'Vider le cache du site ou déclencher un build avec vidage du cache.',
          },
          {
            id: 'manage_environment',
            name: 'Gérer l’environnement',
            description: 'Lire les variables d’environnement du site.',
          },
          { id: 'trigger_build', name: 'Déclencher un build', description: 'Lancer un nouveau build du site.' },
          {
            id: 'view_functions',
            name: 'Voir les fonctions',
            description: 'Lire les fonctions serverless déployées.',
          },
          {
            id: 'site_analytics',
            name: 'Statistiques du site',
            description: 'Lire les statistiques de trafic du site.',
          },
          { id: 'delete_site', name: 'Supprimer le site', description: 'Supprimer définitivement un site.' },
          { id: 'deploy_publish', name: 'Publier un déploiement', description: 'Publier un déploiement sur son site.' },
          {
            id: 'deploy_lock',
            name: 'Verrouiller un déploiement',
            description: 'Empêcher les modifications d’un déploiement.',
          },
          {
            id: 'deploy_unlock',
            name: 'Déverrouiller un déploiement',
            description: 'Autoriser les modifications d’un déploiement.',
          },
        ]}
      />

      <p className="text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary">
        Connectez et gérez vos sites Netlify avec des contrôles de déploiement avancés et une gestion complète des sites
      </p>

      {/* Connection Test Results */}
      {connectionTest && (
        <motion.div
          className={classNames('p-4 rounded-lg border', {
            'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700':
              connectionTest.status === 'success',
            'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700': connectionTest.status === 'error',
            'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700': connectionTest.status === 'testing',
          })}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2">
            {connectionTest.status === 'success' && (
              <div className="i-ph:check-circle w-5 h-5 text-green-600 dark:text-green-400" />
            )}
            {connectionTest.status === 'error' && (
              <div className="i-ph:warning-circle w-5 h-5 text-red-600 dark:text-red-400" />
            )}
            {connectionTest.status === 'testing' && (
              <div className="i-ph:spinner-gap w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
            )}
            <span
              className={classNames('text-sm font-medium', {
                'text-green-800 dark:text-green-200': connectionTest.status === 'success',
                'text-red-800 dark:text-red-200': connectionTest.status === 'error',
                'text-blue-800 dark:text-blue-200': connectionTest.status === 'testing',
              })}
            >
              {connectionTest.message}
            </span>
          </div>
          {connectionTest.timestamp && (
            <p className="text-xs text-gray-500 mt-1">{new Date(connectionTest.timestamp).toLocaleString('fr-FR')}</p>
          )}
        </motion.div>
      )}

      {/* Main Connection Component */}
      <motion.div
        className="bg-bolt-elements-background dark:bg-bolt-elements-background border border-bolt-elements-borderColor dark:border-bolt-elements-borderColor rounded-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="p-6">
          {!connection.user ? (
            <div className="space-y-4">
              <div className="text-xs text-bolt-elements-textSecondary bg-bolt-elements-background-depth-1 dark:bg-bolt-elements-background-depth-1 p-3 rounded-lg mb-4">
                <p className="flex items-center gap-1 mb-1">
                  <span className="i-ph:lightbulb w-3.5 h-3.5 text-bolt-elements-icon-success dark:text-bolt-elements-icon-success" />
                  <span className="font-medium">Astuce :</span> vous pouvez aussi définir la variable d’environnement{' '}
                  <code className="px-1 py-0.5 bg-bolt-elements-background-depth-2 dark:bg-bolt-elements-background-depth-2 rounded">
                    VITE_NETLIFY_ACCESS_TOKEN
                  </code>{' '}
                  pour vous connecter automatiquement.
                </p>
              </div>

              <div>
                <label className="block text-sm text-bolt-elements-textSecondary dark:text-bolt-elements-textSecondary mb-2">
                  Jeton API
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Saisissez votre jeton API Netlify"
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
                    href="https://app.netlify.com/user/applications#personal-access-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bolt-elements-borderColorActive hover:underline inline-flex items-center gap-1"
                  >
                    Obtenir votre jeton
                    <div className="i-ph:arrow-square-out w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={handleConnect}
                  disabled={isConnecting || !tokenInput}
                  className={classNames(
                    'px-4 py-2 rounded-lg text-sm flex items-center gap-2',
                    'bg-[#303030] text-white',
                    'hover:bg-[#5E41D0] hover:text-white',
                    'disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200',
                    'transform active:scale-95',
                  )}
                >
                  {isConnecting ? (
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
            </div>
          ) : (
            <div className="space-y-4">
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
                  Connecté à Netlify
                </span>
              </div>
              {renderStats()}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
