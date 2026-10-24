import * as RadixDialog from '@radix-ui/react-dialog';
import {
  Blocks,
  ChevronLeft,
  Download,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '~/components/ui/Select';
import { useConfirmDialog } from '~/components/ui/useConfirmDialog';
import { getPluginToolName } from '~/lib/plugins/adapters';
import type { MarketplaceSnapshot, MarketplacePlugin } from '~/lib/plugins/marketplace';
import { pluginCategorySchema, pluginManifestSchema, type PluginManifest } from '~/lib/plugins/schema';
import {
  createDraftManifest,
  exportPluginDraft,
  fetchMarketplaceChangelog,
  installFromMarketplace,
  installLocalPackage,
  loadMarketplace,
  getPluginUpdates,
} from '~/lib/plugins/service';
import { usePluginStore } from '~/lib/stores/plugins';
import { classNames } from '~/utils/classNames';

type View = 'marketplace' | 'installed' | 'updates' | 'develop';
type DetailTab = 'overview' | 'settings' | 'permissions' | 'logs';
type Draft = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  license: string;
  category: PluginManifest['category'];
  version: string;
};

const MARKETPLACE_URL = 'https://github.com/dustinwloring1988/bolt-marketplace';
const CATEGORIES = pluginCategorySchema.options;

/** Display labels for the manifest category values, which stay in English in the data. */
const CATEGORY_LABELS: Record<string, string> = {
  AI: 'IA',
  'Developer Tools': 'Outils de développement',
  Productivity: 'Productivité',
  Data: 'Données',
  Media: 'Médias',
  Communication: 'Communication',
  Other: 'Autre',
};

const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;

const buttonClass =
  'inline-flex appearance-none items-center justify-center gap-2 rounded-lg border border-bolt-elements-borderColor bg-transparent px-3 py-2 text-sm font-medium text-bolt-elements-textPrimary transition-colors hover:bg-bolt-elements-background-depth-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass =
  'inline-flex appearance-none items-center justify-center gap-2 rounded-lg border border-purple-500 bg-purple-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass =
  'w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20';

function ErrorMessage({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
      {message}
    </div>
  );
}

function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-bolt-elements-borderColor px-2.5 py-1 text-xs text-bolt-elements-textSecondary">
      {children}
    </span>
  );
}

function PluginCard({
  plugin,
  onOpen,
  installed,
  updateAvailable,
}: {
  plugin: MarketplacePlugin;
  onOpen: () => void;
  installed: boolean;
  updateAvailable: boolean;
}) {
  const manifest = plugin.manifest;

  return (
    <article className="flex min-h-[220px] flex-col rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 transition-colors hover:border-purple-500/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 appearance-none items-start gap-3 border-0 bg-transparent text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/10 text-purple-400">
          <Blocks className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-bolt-elements-textPrimary">{manifest.name}</span>
          <span className="mt-0.5 block text-xs text-bolt-elements-textTertiary">
            {manifest.publisher} · v{manifest.version}
          </span>
          <span className="mt-3 line-clamp-3 block text-sm leading-5 text-bolt-elements-textSecondary">
            {manifest.description}
          </span>
        </span>
      </button>
      <div className="mt-4 flex items-center justify-between gap-2">
        <CategoryPill>{categoryLabel(manifest.category)}</CategoryPill>
        <span className="text-xs text-bolt-elements-textTertiary">
          {updateAvailable ? 'Mise à jour disponible' : installed ? 'Installée' : ''}
        </span>
        <button type="button" onClick={onOpen} className={buttonClass}>
          {installed ? 'Gérer' : 'Détails'}
        </button>
      </div>
    </article>
  );
}

export default function PluginTab() {
  const { askConfirmation, confirmDialog } = useConfirmDialog();
  const plugins = usePluginStore((state) => state.plugins);
  const storeBusy = usePluginStore((state) => state.busy);
  const storeError = usePluginStore((state) => state.error);
  const initialize = usePluginStore((state) => state.initialize);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const setConfiguration = usePluginStore((state) => state.setConfiguration);
  const uninstall = usePluginStore((state) => state.uninstall);
  const rollback = usePluginStore((state) => state.rollback);
  const loadLogs = usePluginStore((state) => state.loadLogs);
  const logs = usePluginStore((state) => state.logs);
  const importInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('marketplace');
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All categories');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');

  const [installTarget, setInstallTarget] = useState<{
    pluginId: string;
    version: MarketplacePlugin['versions'][number];
  } | null>(null);

  const [changelogText, setChangelogText] = useState<string>();
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const changelogRequestRef = useRef(0);

  const [operationError, setOperationError] = useState<string | null>(null);
  const [draftStep, setDraftStep] = useState(0);

  const [draft, setDraft] = useState<Draft>({
    id: 'boltdiy.text-utilities',
    name: 'Text Utilities',
    description: 'Compter et transformer du texte avec des outils déterministes.',
    publisher: 'Bolt.diy',
    license: 'MIT',
    category: 'Productivity',
    version: '1.0.0',
  });

  const [draftTools, setDraftTools] = useState<PluginManifest['tools']>(['count', 'transform']);

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);

    try {
      setSnapshot(await loadMarketplace());
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Impossible de charger le catalogue.');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void initialize();
    void refreshCatalog();
  }, [initialize, refreshCatalog]);

  const updates = useMemo(() => getPluginUpdates(snapshot, plugins), [snapshot, plugins]);
  const catalogPlugins = snapshot?.plugins ?? [];

  const installedAsPlugins = plugins.flatMap((record) => {
    const parsed = pluginManifestSchema.safeParse(record.manifest);

    return parsed.success ? [{ id: record.id, manifest: parsed.data, versions: [] }] : [];
  });
  const displayedPlugins = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const sourcePlugins = view === 'installed' ? installedAsPlugins : catalogPlugins;

    return sourcePlugins.filter((plugin) => {
      const matchesSearch =
        !normalizedSearch ||
        [plugin.manifest.name, plugin.manifest.description, plugin.manifest.publisher].some((value) =>
          value.toLowerCase().includes(normalizedSearch),
        );

      const matchesCategory = category === 'All categories' || plugin.manifest.category === category;
      const matchesUpdates = view !== 'updates' || updates.some((update) => update.pluginId === plugin.id);

      return matchesSearch && matchesCategory && matchesUpdates;
    });
  }, [catalogPlugins, installedAsPlugins, search, category, view, updates]);

  const selectedInstalled = plugins.find((plugin) => plugin.id === selectedId);
  const selectedMarketplace = catalogPlugins.find((plugin) => plugin.id === selectedId);
  const selectedUpdate = updates.find((update) => update.pluginId === selectedId);
  const selectedManifest = (selectedInstalled?.manifest as PluginManifest | undefined) ?? selectedMarketplace?.manifest;

  useEffect(() => {
    if (selectedId && detailTab === 'logs') {
      void loadLogs(selectedId);
    }
  }, [selectedId, detailTab, loadLogs]);

  async function runOperation(operation: () => Promise<void>) {
    setOperationError(null);

    try {
      await operation();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'L’opération sur l’extension a échoué.');
    }
  }

  async function handleImport(file?: File) {
    if (!file) {
      return;
    }

    setOperationError(null);

    try {
      await installLocalPackage(file);
      setView('installed');
      setSelectedId(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Impossible d’importer ce paquet d’extension.');
    }
  }

  async function handleExportDraft() {
    setOperationError(null);

    try {
      const manifest = createDraftManifest({ ...draft, tools: draftTools });
      await exportPluginDraft(manifest);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Les informations du brouillon sont invalides.');
    }
  }

  function goBack() {
    setSelectedId(null);
    setDetailTab('overview');
    setOperationError(null);
  }

  async function openInstallConfirmation(pluginId: string, version: MarketplacePlugin['versions'][number]) {
    const requestId = ++changelogRequestRef.current;
    setInstallTarget({ pluginId, version });
    setChangelogText(undefined);
    setChangelogError(null);

    if (!snapshot || !version.changelogPath) {
      setChangelogLoading(false);
      return;
    }

    setChangelogLoading(true);

    try {
      const text = await fetchMarketplaceChangelog(snapshot, version);

      if (requestId === changelogRequestRef.current) {
        setChangelogText(text);
      }
    } catch (error) {
      if (requestId === changelogRequestRef.current) {
        setChangelogError(error instanceof Error ? error.message : 'Impossible de charger les notes de cette version.');
      }
    } finally {
      if (requestId === changelogRequestRef.current) {
        setChangelogLoading(false);
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      {confirmDialog}
      <input
        ref={importInput}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="sr-only"
        aria-label="Sélectionner une archive ZIP d’extension"
        onChange={(event) => {
          void handleImport(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />

      {selectedManifest && selectedId ? (
        <PluginDetails
          manifest={selectedManifest}
          installed={selectedInstalled}
          detailTab={detailTab}
          setDetailTab={setDetailTab}
          onBack={goBack}
          logs={logs[selectedId] ?? []}
          busy={storeBusy}
          onEnabled={(enabled) => runOperation(() => setEnabled(selectedId, enabled))}
          onUninstall={() => {
            const name = selectedManifest.name;
            const id = selectedId;

            void askConfirmation({
              title: `Désinstaller ${name} ?`,
              description: 'Le plugin et ses paramètres seront supprimés de votre espace.',
              confirmLabel: 'Désinstaller',
              destructive: true,
            }).then((confirmed) => {
              if (!confirmed) {
                return;
              }

              void runOperation(async () => {
                await uninstall(id);
                goBack();
              });
            });
          }}
          onRollback={() => runOperation(() => rollback(selectedId))}
          onConfiguration={(configuration) => runOperation(() => setConfiguration(selectedId, configuration))}
          onToolEnabled={(tool, enabled) =>
            runOperation(() =>
              setConfiguration(selectedId, {
                ...selectedInstalled?.configuration,
                [`toolDisabled:${tool}`]: !enabled,
              }),
            )
          }
          onUpdate={
            selectedMarketplace && selectedInstalled && selectedUpdate
              ? () => void openInstallConfirmation(selectedMarketplace.id, selectedUpdate.version)
              : undefined
          }
          onInstall={
            selectedMarketplace && !selectedInstalled
              ? () => {
                  const version = selectedMarketplace.versions.find(
                    (candidate) => candidate.version === selectedMarketplace.manifest.version,
                  );

                  if (version) {
                    void openInstallConfirmation(selectedMarketplace.id, version);
                  }
                }
              : undefined
          }
          error={operationError ?? storeError}
        />
      ) : view === 'develop' ? (
        <DeveloperWizard
          step={draftStep}
          setStep={setDraftStep}
          draft={draft}
          setDraft={setDraft}
          tools={draftTools}
          setTools={setDraftTools}
          busy={storeBusy}
          onCancel={() => {
            setView('marketplace');
            setOperationError(null);
          }}
          onExport={() => void handleExportDraft()}
          error={operationError}
        />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Extensions</p>
              <h2 className="mt-1 text-2xl font-semibold text-bolt-elements-textPrimary">Catalogue d’extensions</h2>
              <p className="mt-1 max-w-2xl text-sm text-bolt-elements-textSecondary">
                Découvrez et gérez des extensions vérifiées depuis le catalogue de Bolt.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshCatalog()}
                disabled={loadingCatalog}
                className={buttonClass}
              >
                {loadingCatalog ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{' '}
                Rechercher des mises à jour
              </button>
              <button type="button" onClick={() => importInput.current?.click()} className={buttonClass}>
                <Upload className="h-4 w-4" /> Installer une extension
              </button>
              <button
                type="button"
                onClick={() => {
                  setView('develop');
                  setDraftStep(0);
                }}
                className={primaryButtonClass}
              >
                <Plus className="h-4 w-4" /> Développer une extension
              </button>
            </div>
          </header>

          <nav
            aria-label="Vues des extensions"
            className="flex flex-wrap gap-1 border-b border-bolt-elements-borderColor"
          >
            {(
              [
                ['marketplace', 'Catalogue'],
                ['installed', 'Installées'],
                ['updates', 'Mises à jour'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
                className={classNames(
                  'appearance-none rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  view === id
                    ? 'border-bolt-elements-borderColorActive bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                    : 'border-bolt-elements-borderColor bg-transparent text-bolt-elements-textSecondary hover:border-bolt-elements-borderColorActive hover:text-bolt-elements-textPrimary',
                )}
              >
                {label}
                {id === 'updates' && updates.length > 0 ? (
                  <span className="ml-2 rounded-full bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-300">
                    {updates.length}
                  </span>
                ) : null}
                {id === 'installed' ? (
                  <span className="ml-2 rounded-full bg-bolt-elements-background-depth-3 px-1.5 py-0.5 text-xs">
                    {plugins.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-bolt-elements-textTertiary" />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher une extension…"
                aria-label="Rechercher une extension"
              />
            </label>
            <label className="sr-only" htmlFor="plugin-category">
              Filtrer par catégorie
            </label>
            <Select
              id="plugin-category"
              className={`${inputClass} w-auto min-w-44`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="All categories">Toutes les catégories</option>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {categoryLabel(item)}
                </option>
              ))}
            </Select>
          </div>

          {(operationError || storeError) && <ErrorMessage message={operationError ?? storeError ?? ''} />}

          {catalogError && !snapshot ? (
            <div className="space-y-3 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 text-center">
              <h3 className="font-medium text-bolt-elements-textPrimary">Catalogue indisponible</h3>
              <p className="text-sm text-bolt-elements-textSecondary">{catalogError}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={buttonClass} onClick={() => void refreshCatalog()}>
                  Réessayer
                </button>
                <a className={buttonClass} href={MARKETPLACE_URL} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Ouvrir le dépôt
                </a>
              </div>
            </div>
          ) : null}

          {snapshot?.stale && (
            <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              Affichage du dernier catalogue enregistré le {new Date(snapshot.fetchedAt).toLocaleString()}. Les
              recherches de mises à jour peuvent être obsolètes.
            </p>
          )}

          {loadingCatalog && !snapshot ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-bolt-elements-textSecondary">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Chargement du catalogue…
            </div>
          ) : null}

          {snapshot && !catalogError && catalogPlugins.length === 0 && view === 'marketplace' ? (
            <div className="rounded-xl border border-dashed border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-6 py-12 text-center">
              <Blocks className="mx-auto h-9 w-9 text-bolt-elements-textTertiary" />
              <h3 className="mt-3 font-medium text-bolt-elements-textPrimary">
                Aucune extension publiée pour l’instant
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-bolt-elements-textSecondary">
                Le dépôt du catalogue est connecté. Importez un paquet ZIP vérifié ou créez un brouillon d’extension
                pour commencer.
              </p>
              <button type="button" onClick={() => importInput.current?.click()} className={`${buttonClass} mt-4`}>
                <Upload className="h-4 w-4" /> Installer depuis un ZIP
              </button>
            </div>
          ) : null}

          {snapshot && catalogPlugins.length > 0 && displayedPlugins.length === 0 && (
            <p className="rounded-xl border border-bolt-elements-borderColor p-8 text-center text-sm text-bolt-elements-textSecondary">
              {view === 'installed' && plugins.length === 0
                ? 'Aucune extension installée pour l’instant.'
                : view === 'updates' && updates.length === 0
                  ? 'Toutes les extensions installées sont à jour.'
                  : 'Aucune extension ne correspond à ces filtres.'}
            </p>
          )}

          {displayedPlugins.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {displayedPlugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  onOpen={() => {
                    setSelectedId(plugin.id);
                    setDetailTab('overview');
                  }}
                  installed={plugins.some((installed) => installed.id === plugin.id)}
                  updateAvailable={updates.some((update) => update.pluginId === plugin.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {installTarget && snapshot && (
        <InstallConfirmation
          plugin={snapshot.plugins.find((plugin) => plugin.id === installTarget.pluginId)}
          version={installTarget.version.version}
          installed={plugins.find((plugin) => plugin.id === installTarget.pluginId)}
          changelog={changelogText}
          changelogLoading={changelogLoading}
          changelogError={changelogError}
          busy={storeBusy}
          onCancel={() => {
            changelogRequestRef.current += 1;
            setInstallTarget(null);
            setChangelogText(undefined);
            setChangelogError(null);
          }}
          onInstall={() =>
            void runOperation(async () => {
              await installFromMarketplace(snapshot, installTarget.pluginId, installTarget.version);
              changelogRequestRef.current += 1;
              setInstallTarget(null);
              setChangelogText(undefined);
              setChangelogError(null);
              setView('installed');
            })
          }
        />
      )}
    </div>
  );
}

function InstallConfirmation({
  plugin,
  version,
  installed,
  changelog,
  changelogLoading,
  changelogError,
  busy,
  onCancel,
  onInstall,
}: {
  plugin?: MarketplacePlugin;
  version: string;
  installed?: ReturnType<typeof usePluginStore.getState>['plugins'][number];
  changelog?: string;
  changelogLoading: boolean;
  changelogError: string | null;
  busy: boolean;
  onCancel: () => void;
  onInstall: () => void;
}) {
  if (!plugin) {
    return null;
  }

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[130] bg-black/70" />
        <RadixDialog.Content
          onEscapeKeyDown={(event) => {
            if (busy) {
              event.preventDefault();
            }
          }}
          className="fixed left-1/2 top-1/2 z-[131] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-6 shadow-2xl focus:outline-none"
        >
          <RadixDialog.Title className="text-lg font-semibold text-bolt-elements-textPrimary">
            {installed ? `Mettre à jour ${plugin.manifest.name} ?` : `Installer ${plugin.manifest.name} ?`}
          </RadixDialog.Title>
          <RadixDialog.Description className="text-sm text-bolt-elements-textSecondary">
            Version {version} par {plugin.manifest.publisher}. Le paquet sera vérifié auprès du catalogue avant d’être
            enregistré.
          </RadixDialog.Description>
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0" /> Cette extension ne demande aucune capacité supplémentaire.{' '}
            {installed?.enabled ? 'Son état actuel (activée) sera conservé.' : 'L’installation démarre désactivée.'}
          </div>
          {installed &&
            plugin.manifest.tools.some((tool) => {
              const currentManifest = pluginManifestSchema.safeParse(installed.manifest);
              return !currentManifest.success || !currentManifest.data.tools.includes(tool);
            }) && (
              <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
                Les nouveaux outils resteront désactivés après la mise à jour. Vérifiez-les dans les Réglages avant de
                les activer.
              </p>
            )}
          {changelogLoading && (
            <p role="status" className="text-sm text-bolt-elements-textSecondary">
              Chargement des notes de version…
            </p>
          )}
          {changelogError && <ErrorMessage message={changelogError} />}
          {changelog && (
            <section className="max-h-48 overflow-auto rounded-lg border border-bolt-elements-borderColor p-3">
              <h3 className="mb-2 text-sm font-medium text-bolt-elements-textPrimary">Notes de version</h3>
              <pre className="whitespace-pre-wrap break-words text-xs text-bolt-elements-textSecondary">
                {changelog}
              </pre>
            </section>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={onCancel} disabled={busy}>
              Annuler
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={onInstall}
              disabled={busy || changelogLoading || !!changelogError}
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{' '}
              {installed ? 'Mettre à jour' : 'Installer'}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function PluginDetails({
  manifest,
  installed,
  detailTab,
  setDetailTab,
  onBack,
  logs,
  busy,
  onEnabled,
  onUninstall,
  onRollback,
  onConfiguration,
  onToolEnabled,
  onUpdate,
  onInstall,
  error,
}: {
  manifest: PluginManifest;
  installed?: ReturnType<typeof usePluginStore.getState>['plugins'][number];
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;
  onBack: () => void;
  logs: ReturnType<typeof usePluginStore.getState>['logs'][string];
  busy: boolean;
  onEnabled: (enabled: boolean) => void;
  onUninstall: () => void;
  onRollback: () => void;
  onConfiguration: (configuration: Record<string, string | boolean | number>) => void;
  onToolEnabled: (tool: PluginManifest['tools'][number], enabled: boolean) => void;
  onUpdate?: () => void;
  onInstall?: () => void;
  error: string | null;
}) {
  const versions = installed?.previous
    ? [manifest.version, (installed.previous.manifest as PluginManifest).version]
    : [manifest.version];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex appearance-none items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-sm font-medium text-bolt-elements-textSecondary transition-colors hover:text-bolt-elements-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        <ChevronLeft className="h-4 w-4" /> {installed ? 'Extensions installées' : 'Catalogue'}
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
        <div className="flex gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Blocks className="h-7 w-7" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-bolt-elements-textPrimary">{manifest.name}</h2>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">
              Version {manifest.version} · {manifest.publisher}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-bolt-elements-textSecondary">{manifest.description}</p>
          </div>
        </div>
        {installed && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-bolt-elements-textSecondary">
              <span>{installed.enabled ? 'Activée' : 'Désactivée'}</span>
              <input
                type="checkbox"
                checked={installed.enabled}
                disabled={busy}
                aria-label={`${installed.enabled ? 'Désactiver' : 'Activer'} ${manifest.name}`}
                onChange={(event) => onEnabled(event.target.checked)}
                className="h-4 w-4 accent-purple-500"
              />
            </label>
            <button type="button" onClick={onUninstall} disabled={busy} className={buttonClass}>
              <Trash2 className="h-4 w-4" /> Désinstaller
            </button>
          </div>
        )}
      </header>
      <nav
        aria-label="Détails de l’extension"
        className="flex gap-2 overflow-x-auto border-b border-bolt-elements-borderColor pb-2"
      >
        {(
          [
            ['overview', 'Aperçu'],
            ['settings', 'Réglages'],
            ['permissions', 'Autorisations'],
            ['logs', 'Activité'],
          ] as const
        ).map(([tab, label]) => (
          <button
            type="button"
            key={tab}
            onClick={() => setDetailTab(tab)}
            aria-current={detailTab === tab ? 'page' : undefined}
            className={classNames(
              'appearance-none rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500',
              detailTab === tab
                ? 'border-bolt-elements-borderColorActive bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                : 'border-bolt-elements-borderColor bg-transparent text-bolt-elements-textSecondary hover:border-bolt-elements-borderColorActive hover:text-bolt-elements-textPrimary',
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <ErrorMessage message={error} />}
      {detailTab === 'overview' && (
        <section className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="space-y-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
            <h3 className="font-semibold text-bolt-elements-textPrimary">À propos</h3>
            <p className="text-sm leading-6 text-bolt-elements-textSecondary">{manifest.description}</p>
            <div className="flex flex-wrap gap-2">
              <CategoryPill>{categoryLabel(manifest.category)}</CategoryPill>
              <CategoryPill>{manifest.license}</CategoryPill>
            </div>
            {installed && (
              <p className="text-xs text-bolt-elements-textTertiary">
                {installed.source === 'marketplace'
                  ? `Catalogue, commit ${installed.sourceCommit?.slice(0, 8)}`
                  : 'Paquet local importé, source non vérifiée'}
              </p>
            )}
          </div>
          <div className="space-y-3 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
            <h3 className="font-semibold text-bolt-elements-textPrimary">État de l’extension</h3>
            <p className="text-sm text-bolt-elements-textSecondary">
              {installed
                ? installed.enabled
                  ? 'Activée dans ce profil de navigateur'
                  : 'Installée et désactivée'
                : 'Disponible à l’installation'}
            </p>
            <p className="text-sm text-bolt-elements-textSecondary">
              {manifest.tools.length} outil{manifest.tools.length === 1 ? '' : 's'} · aucune capacité supplémentaire
            </p>
            {onUpdate && (
              <button type="button" onClick={onUpdate} className={buttonClass}>
                <RefreshCw className="h-4 w-4" /> Mise à jour disponible
              </button>
            )}
            {onInstall && (
              <button type="button" onClick={onInstall} className={primaryButtonClass}>
                <Download className="h-4 w-4" /> Installer l’extension
              </button>
            )}
            {versions.length > 1 && (
              <button type="button" onClick={onRollback} className={buttonClass}>
                Restaurer la v{versions[1]}
              </button>
            )}
          </div>
        </section>
      )}
      {detailTab === 'settings' && (
        <section className="space-y-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
          <h3 className="font-semibold text-bolt-elements-textPrimary">Configuration</h3>
          {installed ? (
            manifest.settings.length ? (
              manifest.settings.map((setting) => (
                <label key={setting.key} className="block space-y-1 text-sm text-bolt-elements-textPrimary">
                  <span>{setting.label}</span>
                  {setting.type === 'toggle' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(installed.configuration[setting.key] ?? setting.default)}
                      onChange={(event) =>
                        onConfiguration({ ...installed.configuration, [setting.key]: event.target.checked })
                      }
                    />
                  ) : (
                    <input
                      className={inputClass}
                      type={setting.type === 'number' ? 'number' : 'text'}
                      value={String(installed.configuration[setting.key] ?? setting.default ?? '')}
                      onChange={(event) =>
                        onConfiguration({
                          ...installed.configuration,
                          [setting.key]: setting.type === 'number' ? Number(event.target.value) : event.target.value,
                        })
                      }
                    />
                  )}
                  {setting.description && (
                    <p className="text-xs text-bolt-elements-textSecondary">{setting.description}</p>
                  )}
                </label>
              ))
            ) : (
              <p className="text-sm text-bolt-elements-textSecondary">
                Cette extension n’a aucun réglage supplémentaire.
              </p>
            )
          ) : (
            <p className="text-sm text-bolt-elements-textSecondary">Installez cette extension pour la configurer.</p>
          )}
          {installed &&
            manifest.tools.map((tool) => {
              const toolName = getPluginToolName(manifest.id, tool);
              const toolEnabled = installed.configuration[`toolDisabled:${tool}`] !== true;

              return (
                <label
                  key={tool}
                  className="flex items-center justify-between border-t border-bolt-elements-borderColor py-3 text-sm text-bolt-elements-textSecondary"
                >
                  <span>
                    <span className="block capitalize text-bolt-elements-textPrimary">
                      Outil {tool.replace('-', ' ')}
                    </span>
                    <code className="text-xs">{toolName}</code>
                  </span>
                  <input
                    type="checkbox"
                    checked={toolEnabled}
                    disabled={busy}
                    aria-label={`Activer l’outil ${tool}`}
                    onChange={(event) => onToolEnabled(tool, event.target.checked)}
                    className="h-4 w-4 accent-purple-500"
                  />
                </label>
              );
            })}
        </section>
      )}
      {detailTab === 'permissions' && (
        <section className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
            <h3 className="font-semibold">Autorisations</h3>
          </div>
          <p className="mt-3 text-sm text-bolt-elements-textSecondary">
            Cet adaptateur vérifié ne demande aucun accès au réseau, aux fichiers du projet, aux identifiants ou au
            stockage. Ses outils traitent uniquement les arguments texte fournis par le modèle.
          </p>
          <p className="mt-3 text-xs text-bolt-elements-textTertiary">Capacités déclarées : aucune</p>
        </section>
      )}
      {detailTab === 'logs' && (
        <section className="space-y-3 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
          <h3 className="font-semibold text-bolt-elements-textPrimary">Activité</h3>
          {!installed ? (
            <p className="text-sm text-bolt-elements-textSecondary">Installez l’extension pour voir l’activité.</p>
          ) : logs?.length ? (
            logs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap justify-between gap-2 border-t border-bolt-elements-borderColor py-3 text-sm"
              >
                <span className={log.level === 'error' ? 'text-red-400' : 'text-bolt-elements-textSecondary'}>
                  {log.message}
                </span>
                <time className="text-xs text-bolt-elements-textTertiary">{new Date(log.time).toLocaleString()}</time>
              </div>
            ))
          ) : (
            <p className="text-sm text-bolt-elements-textSecondary">Aucune activité enregistrée pour l’instant.</p>
          )}
        </section>
      )}
    </div>
  );
}

function DeveloperWizard({
  step,
  setStep,
  draft,
  setDraft,
  tools,
  setTools,
  busy,
  onCancel,
  onExport,
  error,
}: {
  step: number;
  setStep: (step: number) => void;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  tools: PluginManifest['tools'];
  setTools: (tools: PluginManifest['tools']) => void;
  busy: boolean;
  onCancel: () => void;
  onExport: () => void;
  error: string | null;
}) {
  const update = (key: keyof Draft, value: string) => setDraft({ ...draft, [key]: value });
  const steps = ['Informations de base', 'Capacités', 'Configuration', 'Vérification'];

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Extensions</p>
          <h2 className="mt-1 text-2xl font-semibold text-bolt-elements-textPrimary">Développer une extension</h2>
          <p className="mt-1 text-sm text-bolt-elements-textSecondary">
            Créez un brouillon validé pour un adaptateur Bolt pris en charge.
          </p>
        </div>
        <button type="button" onClick={onCancel} className={buttonClass}>
          Annuler
        </button>
      </header>
      <ol aria-label="Étapes de création d’une extension" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? 'step' : undefined}
            className={classNames(
              'rounded-lg border px-3 py-2 text-xs',
              step === index
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary',
            )}
          >
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bolt-elements-background-depth-3">
              {index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {error && <ErrorMessage message={error} />}
      <section className="space-y-4 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-5">
        {step === 0 && (
          <>
            <h3 className="font-semibold text-bolt-elements-textPrimary">Informations de base</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Identifiant de l’extension
                <input className={inputClass} value={draft.id} onChange={(event) => update('id', event.target.value)} />
                <span className="block text-xs">Format éditeur.slug, en minuscules et avec des traits d’union.</span>
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Nom de l’extension
                <input
                  className={inputClass}
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Éditeur
                <input
                  className={inputClass}
                  maxLength={80}
                  value={draft.publisher}
                  onChange={(event) => update('publisher', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Licence
                <input
                  className={inputClass}
                  maxLength={40}
                  value={draft.license}
                  onChange={(event) => update('license', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Version
                <input
                  className={inputClass}
                  value={draft.version}
                  onChange={(event) => update('version', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary">
                Catégorie
                <Select
                  className={inputClass}
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value as Draft['category'] })}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {categoryLabel(item)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-sm text-bolt-elements-textSecondary md:col-span-2">
                Description
                <textarea
                  className={`${inputClass} min-h-24`}
                  maxLength={400}
                  value={draft.description}
                  onChange={(event) => update('description', event.target.value)}
                />
              </label>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3 className="font-semibold text-bolt-elements-textPrimary">Capacités</h3>
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-bolt-elements-textPrimary">Aucun accès supplémentaire demandé</p>
                <p className="mt-1 text-sm text-bolt-elements-textSecondary">
                  La version 1 prend en charge l’adaptateur hôte Text Utilities, vérifié. Il ne peut pas accéder au
                  réseau, aux fichiers du projet, aux identifiants ni au stockage des extensions.
                </p>
              </div>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3 className="font-semibold text-bolt-elements-textPrimary">Configuration</h3>
            <p className="text-sm text-bolt-elements-textSecondary">
              Choisissez les outils déterministes que ce paquet apporte. Ces outils ne traitent que le texte que vous
              fournissez.
            </p>
            {(['count', 'transform'] as const).map((tool) => (
              <label
                key={tool}
                className="flex items-center gap-3 rounded-lg border border-bolt-elements-borderColor p-3 text-sm text-bolt-elements-textPrimary"
              >
                <input
                  type="checkbox"
                  checked={tools.includes(tool)}
                  onChange={(event) =>
                    setTools(
                      event.target.checked
                        ? ([...tools, tool].sort() as PluginManifest['tools'])
                        : tools.filter((item) => item !== tool),
                    )
                  }
                />{' '}
                <Wrench className="h-4 w-4 text-purple-400" />
                <span className="capitalize">
                  {tool === 'count' ? 'Compter les mots, caractères et lignes' : 'Transformer le texte'}
                </span>
              </label>
            ))}
            {tools.length === 0 && (
              <p role="alert" className="text-sm text-amber-300">
                Choisissez au moins un outil.
              </p>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <h3 className="font-semibold text-bolt-elements-textPrimary">Vérification</h3>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ['Nom', draft.name],
                ['Identifiant', draft.id],
                ['Éditeur', draft.publisher],
                ['Version', draft.version],
                ['Licence', draft.license],
                ['Catégorie', categoryLabel(draft.category)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase text-bolt-elements-textTertiary">{label}</dt>
                  <dd className="mt-1 text-bolt-elements-textPrimary">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-bolt-elements-borderColor pt-4 text-sm text-bolt-elements-textSecondary">
              {draft.description}
            </p>
            <p className="text-sm text-bolt-elements-textSecondary">
              Outils : {tools.join(', ') || 'aucun'} · Capacités supplémentaires : aucune
            </p>
            <p className="text-xs text-bolt-elements-textTertiary">
              Le ZIP ne contient qu’un manifeste déclaratif. La publication demande une modification vérifiée du dépôt
              du catalogue.
            </p>
          </>
        )}
        <div className="flex justify-between border-t border-bolt-elements-borderColor pt-4">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className={buttonClass}
          >
            Retour
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 2 && tools.length === 0}
              className={primaryButtonClass}
            >
              Suivant <ChevronLeft className="h-4 w-4 rotate-180" />
            </button>
          ) : (
            <button type="button" onClick={onExport} disabled={busy} className={primaryButtonClass}>
              <Download className="h-4 w-4" /> Exporter le ZIP
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
