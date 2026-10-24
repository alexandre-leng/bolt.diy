import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmationDialog } from './Dialog';

export interface ConfirmOptions {
  /** Question posée, en tête de la boîte (sert de nom accessible). */
  title: string;

  /** Conséquence de l’action, lue par les lecteurs d’écran via aria-describedby. */
  description: string;

  /** Libellé explicite du bouton qui exécute l’action (par exemple « Supprimer le projet »). */
  confirmLabel?: string;

  /** Libellé de l’action sûre. */
  cancelLabel?: string;

  /** Affiche le bouton de confirmation en rouge. */
  destructive?: boolean;
}

export interface ConfirmDialogApi {
  /**
   * Ouvre la boîte de dialogue et résout `true` uniquement si l’utilisateur clique sur l’action.
   * Annuler, Échap, un clic hors de la boîte ou le démontage résolvent `false`.
   */
  askConfirmation: (options: ConfirmOptions) => Promise<boolean>;

  /** Élément à rendre une fois dans l’arbre du composant appelant. */
  confirmDialog: ReactNode;
}

/**
 * Remplaçant accessible de `window.confirm`, construit sur `ConfirmationDialog` (Radix):
 * rôle dialog titré et décrit, focus piégé, focus initial sur « Annuler » (premier bouton),
 * Échap annule, et focus rendu à l’élément qui avait le focus à l’ouverture.
 */
export function useConfirmDialog(): ConfirmDialogApi {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolve?.(value);
  }, []);

  const askConfirmation = useCallback((next: ConfirmOptions) => {
    // Une seule question à la fois: une demande précédente restée ouverte vaut refus.
    resolverRef.current?.(false);

    const active = typeof document === 'undefined' ? null : document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(next);
      setOpen(true);
    });
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const confirmDialog = options ? (
    <ConfirmationDialog
      isOpen={open}
      title={options.title}
      description={options.description}
      confirmLabel={options.confirmLabel ?? 'Confirmer'}
      cancelLabel={options.cancelLabel ?? 'Annuler'}
      variant={options.destructive ? 'destructive' : 'default'}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      onCloseAutoFocus={(event) => {
        event.preventDefault();

        const opener = openerRef.current;
        openerRef.current = null;

        if (opener?.isConnected) {
          opener.focus();
        }
      }}
    />
  ) : null;

  return { askConfirmation, confirmDialog };
}

/** Texte de confirmation pour une action de projet ou de site sans libellé dédié. */
export function actionConfirmOptions(action: {
  name: string;
  variant?: string;
  confirmation?: Partial<ConfirmOptions>;
}): ConfirmOptions {
  const destructive = action.variant === 'destructive';

  return {
    title: `Confirmer « ${action.name} » ?`,
    description: destructive
      ? 'Cette action est irréversible. Voulez-vous vraiment continuer ?'
      : 'Voulez-vous vraiment exécuter cette action ?',
    confirmLabel: destructive ? 'Confirmer la suppression' : 'Confirmer',
    destructive,
    ...action.confirmation,
  };
}
