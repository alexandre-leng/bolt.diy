import React from 'react';
import { Button } from '~/components/ui/Button';
import type { GitLabStats } from '~/types/GitLab';

interface StatsDisplayProps {
  stats: GitLabStats;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function StatsDisplay({ stats, onRefresh, isRefreshing }: StatsDisplayProps) {
  return (
    <div className="space-y-4">
      {/* Repository Stats */}
      <div>
        <h5 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">Statistiques des dépôts</h5>
        <div className="grid grid-cols-2 gap-4">
          {[
            {
              label: 'Dépôts publics',
              value: stats.publicProjects,
            },
            {
              label: 'Dépôts privés',
              value: stats.privateProjects,
            },
          ].map((stat, index) => (
            <div
              key={index}
              className="flex flex-col p-3 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor"
            >
              <span className="text-xs text-bolt-elements-textSecondary">{stat.label}</span>
              <span className="text-lg font-medium text-bolt-elements-textPrimary">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Contribution Stats */}
      <div>
        <h5 className="text-sm font-medium text-bolt-elements-textPrimary mb-2">Statistiques de contribution</h5>
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: 'Étoiles',
              value: stats.stars || 0,
              icon: 'i-ph:star',
              iconColor: 'text-bolt-elements-icon-warning',
            },
            {
              label: 'Forks',
              value: stats.forks || 0,
              icon: 'i-ph:git-fork',
              iconColor: 'text-bolt-elements-icon-info',
            },
            {
              label: 'Abonnés',
              value: stats.followers || 0,
              icon: 'i-ph:users',
              iconColor: 'text-bolt-elements-icon-success',
            },
          ].map((stat, index) => (
            <div
              key={index}
              className="flex flex-col p-3 rounded-lg bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor"
            >
              <span className="text-xs text-bolt-elements-textSecondary">{stat.label}</span>
              <span className="text-lg font-medium text-bolt-elements-textPrimary flex items-center gap-1">
                <div className={`${stat.icon} w-4 h-4 ${stat.iconColor}`} />
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-bolt-elements-borderColor">
        <div className="flex items-center justify-between">
          <span className="text-xs text-bolt-elements-textSecondary">
            Dernière mise à jour : {new Date(stats.lastUpdated).toLocaleString('fr-FR')}
          </span>
          {onRefresh && (
            <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" size="sm" className="text-xs">
              {isRefreshing ? 'Actualisation…' : 'Actualiser'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
