import { useEffect, useRef, useState } from 'react';
import type { ConnectorCredentialRequest } from '~/components/@settings/tabs/connectors/ConnectorsTab';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { activateConnector, type ConnectorActivationId } from '~/lib/services/connectorActivation';
import { useMCPStore, type ConnectorId } from '~/lib/stores/mcp';
import { toast } from '~/lib/toastify';

const NAMES: Record<ConnectorCredentialRequest['connectorId'], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  vercel: 'Vercel',
  netlify: 'Netlify',
  supabase: 'Supabase',
  'browser-use-cloud': 'Browser Use Cloud',
};

interface ConnectorCredentialDialogProps {
  request: ConnectorCredentialRequest | null;
  onClose: () => void;
  onActivated: (connectorId: ConnectorCredentialRequest['connectorId']) => void;
}

/**
 * "Enable <connector>": asks for the API key without which the connector cannot be switched on.
 *
 * It lives beside the settings panel rather than inside the Connectors tab because `Dialog`
 * paints its backdrop and its content as two siblings at `z-[9999]`: nested in the tab, the
 * backdrop ended up inside the settings tree with no `role="dialog"` above it, so the dismiss
 * layer that answers Escape was never mounted and a click on the page afterwards hit a phantom
 * full-screen layer instead of the control below it. Here it is a sibling of the settings
 * dialog, in its own portal, with a single mount.
 */
export function ConnectorCredentialDialog({ request, onClose, onActivated }: ConnectorCredentialDialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState(request?.initialError ?? '');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const setConnectorEnabled = useMCPStore((state) => state.setConnectorEnabled);

  const connectorId = request?.connectorId ?? null;

  useEffect(() => {
    if (request) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    setApiKey('');
    setVisible(false);
    setError(request?.initialError ?? '');
  }, [request]);

  if (!connectorId) {
    return null;
  }

  const name = NAMES[connectorId];
  const settingsId: ConnectorId = connectorId === 'browser-use-cloud' ? 'browserUseCloud' : connectorId;
  const activationId: ConnectorActivationId = connectorId === 'browser-use-cloud' ? 'browserUseCloud' : connectorId;

  const submit = async () => {
    setBusy(true);
    setError('');

    try {
      await activateConnector(activationId, apiKey);
      setConnectorEnabled(settingsId, true);
      toast.success(`${name} est activé. Vous pouvez maintenant le configurer.`);
      onActivated(connectorId);
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : 'Cette clé API n’a pas pu être vérifiée. L’outil reste désactivé.',
      );
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) {
      return;
    }

    toast.info(`${name} reste désactivé tant qu’aucune clé API valide n’est saisie.`);
    onClose();
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <DialogRoot open onOpenChange={(open) => !open && close()}>
      <Dialog className="max-w-[min(520px,calc(100vw-2rem))] p-6" showCloseButton onClose={close}>
        <DialogTitle>Activer {name}</DialogTitle>
        <DialogDescription>
          Saisissez une clé API valide pour activer cet outil. Si la vérification échoue, il reste désactivé. Une fois
          activé, utilisez le bouton Configurer pour ses autres réglages.
        </DialogDescription>

        <label className="mt-5 block text-sm font-medium text-bolt-elements-textPrimary" htmlFor="connector-api-key">
          Clé API {name}
        </label>
        <div className="relative mt-2">
          <input
            id="connector-api-key"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Collez votre clé API"
            className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 py-2 pl-3 pr-12 text-sm text-bolt-elements-textPrimary outline-none focus:border-bolt-elements-borderColorActive focus-visible:ring-2 focus-visible:ring-accent-500"
          />
          <button
            type="button"
            onClick={() => setVisible((previous) => !previous)}
            aria-label={visible ? `Masquer la clé ${name}` : `Afficher la clé ${name}`}
            aria-pressed={visible}
            title={visible ? 'Masquer' : 'Afficher'}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <span className={visible ? 'i-ph:eye-slash h-4 w-4' : 'i-ph:eye h-4 w-4'} aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-sm text-bolt-elements-icon-error">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <DialogButton type="secondary" onClick={close} disabled={busy}>
            Annuler
          </DialogButton>
          <DialogButton type="primary" onClick={() => void submit()} disabled={busy || !apiKey.trim()}>
            {busy ? 'Vérification…' : 'Vérifier et activer'}
          </DialogButton>
        </div>
      </Dialog>
    </DialogRoot>
  );
}

export default ConnectorCredentialDialog;
