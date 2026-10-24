import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatId as chatIdStore, db, description as descriptionStore, getMessages } from '~/lib/persistence';
import { renameChat } from '~/lib/persistence/historySync';
import { toast } from '~/lib/toastify';
import { cleanChatTitle } from '~/utils/chatTitle';

interface EditChatDescriptionOptions {
  initialDescription?: string;
  customChatId?: string;
  syncWithGlobalStore?: boolean;
}

type EditChatDescriptionHook = {
  editing: boolean;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBlur: () => Promise<void>;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => Promise<void>;
  currentDescription: string;
  toggleEditMode: () => void;
};

/**
 * Hook to manage the state and behavior for editing chat descriptions.
 *
 * Offers functions to:
 * - Switch between edit and view modes.
 * - Manage input changes, blur, and form submission events.
 * - Save updates to IndexedDB and optionally to the global application state.
 *
 * @param {Object} options
 * @param {string} options.initialDescription - The current chat description.
 * @param {string} options.customChatId - Optional ID for updating the description via the sidebar.
 * @param {boolean} options.syncWithGlobalStore - Flag to indicate global description store synchronization.
 * @returns {EditChatDescriptionHook} Methods and state for managing description edits.
 */
export function useEditChatDescription({
  initialDescription: storedDescription = descriptionStore.get()!,
  customChatId,
  syncWithGlobalStore,
}: EditChatDescriptionOptions): EditChatDescriptionHook {
  /*
   * What the user sees and edits is the CLEANED title: stored titles may still start with
   * `[Model: x] [Provider: y]`. Display only: nothing is written unless the user saves a change
   * (an unchanged submit compares equal to this value and is a no-op).
   */
  const initialDescription = cleanChatTitle(storedDescription);
  const chatIdFromStore = useStore(chatIdStore);
  const [editing, setEditing] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(initialDescription);

  const [chatId, setChatId] = useState<string>();

  useEffect(() => {
    setChatId(customChatId || chatIdFromStore);
  }, [customChatId, chatIdFromStore]);
  useEffect(() => {
    setCurrentDescription(initialDescription);
  }, [initialDescription]);

  const toggleEditMode = useCallback(() => setEditing((prev) => !prev), []);

  /*
   * Submit, blur and Escape CLOSE the editor; they never toggle it. One click on the check
   * used to fire handleSubmit on mousedown, again on the form submit, then handleBlur, and
   * each toggled: double save, double toast, and an editor that reopened.
   */
  const closeEditMode = useCallback(() => setEditing(false), []);

  // Set while a save is in flight, so a second submit from the same gesture is a no-op.
  const savingRef = useRef(false);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentDescription(e.target.value);
  }, []);

  const fetchLatestDescription = useCallback(async () => {
    if (!db || !chatId) {
      return initialDescription;
    }

    try {
      const chat = await getMessages(db, chatId);
      return cleanChatTitle(chat?.description) || initialDescription;
    } catch (error) {
      console.error('Failed to fetch latest description:', error);
      return initialDescription;
    }
  }, [db, chatId, initialDescription]);

  const handleBlur = useCallback(async () => {
    if (savingRef.current) {
      return;
    }

    closeEditMode();

    const latestDescription = await fetchLatestDescription();
    setCurrentDescription(latestDescription);
  }, [fetchLatestDescription, closeEditMode]);

  const isValidDescription = useCallback(
    (desc: string): boolean => {
      const trimmedDesc = desc.trim();

      if (trimmedDesc === initialDescription) {
        closeEditMode();
        return false; // No change, nothing to save
      }

      const lengthValid = trimmedDesc.length > 0 && trimmedDesc.length <= 100;

      /*
       * Any letter, digit, punctuation or space in any script. The old ASCII whitelist
       * refused every accented letter and the typographic apostrophe, so « Café de Noël »
       * or « L’atelier » could never be saved. Only control characters and angle brackets
       * are refused.
       */
      const characterValid = !/[\p{Cc}<>]/u.test(trimmedDesc);

      if (!lengthValid) {
        toast.error('Le titre doit contenir entre 1 et 100 caractères.');
        return false;
      }

      if (!characterValid) {
        toast.error('Le titre ne peut pas contenir de caractères de contrôle ni de chevrons (< >).');
        return false;
      }

      return true;
    },
    [initialDescription, closeEditMode],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (savingRef.current) {
        return;
      }

      if (!isValidDescription(currentDescription)) {
        return;
      }

      const nextDescription = currentDescription.trim();
      savingRef.current = true;

      try {
        if (!db) {
          toast.error('L’historique local n’est pas disponible.');
          return;
        }

        if (!chatId) {
          toast.error('Conversation introuvable.');
          return;
        }

        // renameChat bumps the timestamp and pushes to the server, so other devices see it.
        await renameChat(db, chatId, nextDescription);
        setCurrentDescription(nextDescription);

        if (syncWithGlobalStore) {
          descriptionStore.set(nextDescription);
        }

        toast.success('Titre mis à jour');
      } catch (error) {
        toast.error('Impossible de renommer la conversation : ' + (error as Error).message);
      } finally {
        savingRef.current = false;
        closeEditMode();
      }
    },
    [currentDescription, db, chatId, syncWithGlobalStore, isValidDescription, closeEditMode],
  );

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        await handleBlur();
      }
    },
    [handleBlur],
  );

  return {
    editing,
    handleChange,
    handleBlur,
    handleSubmit,
    handleKeyDown,
    currentDescription,
    toggleEditMode,
  };
}
