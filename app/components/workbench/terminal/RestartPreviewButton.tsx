import { useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { toast } from '~/lib/toastify';

export function RestartPreviewButton({ onRestart }: { onRestart: () => Promise<void> }) {
  const [restarting, setRestarting] = useState(false);

  return (
    <IconButton
      icon={restarting ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:arrow-clockwise'}
      title="Relancer le serveur de prévisualisation"
      disabled={restarting}
      onClick={async () => {
        setRestarting(true);

        try {
          await onRestart();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'La relance du serveur a échoué.');
        } finally {
          setRestarting(false);
        }
      }}
    />
  );
}
