import { useRef, useState } from 'react';
import { toast } from '~/lib/toastify';
import type { ProviderInfo } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }

  return 'Une erreur inattendue est survenue.';
}

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);

  const resetEnhancer = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (
    input: string,
    setInput: (value: string) => void,
    model: string,
    provider: ProviderInfo,
    apiKeys?: Record<string, string>,
  ) => {
    const previousRequest = activeRequestRef.current;
    const controller = new AbortController();
    activeRequestRef.current = controller;

    if (previousRequest) {
      previousRequest.abort();
    }

    setEnhancingPrompt(true);
    setPromptEnhanced(false);

    const requestBody: any = { message: input, model, provider };

    if (apiKeys) {
      requestBody.apiKeys = apiKeys;
    }

    let failed = false;

    try {
      const response = await fetch('/api/enhancer', {
        method: 'POST',
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        let payload: unknown;

        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        failed = true;
        toast.error(`Impossible d’améliorer le prompt : ${errorMessage(payload)}`);

        return;
      }

      const reader = response.body?.getReader();

      if (!reader) {
        failed = true;
        toast.error('Impossible d’améliorer le prompt : la réponse du serveur est vide.');

        return;
      }

      const decoder = new TextDecoder();

      let enhancedInput = '';

      setInput('');

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        if (activeRequestRef.current !== controller || controller.signal.aborted) {
          return;
        }

        enhancedInput += decoder.decode(value);
        logger.trace('Set input', enhancedInput);
        setInput(enhancedInput);
      }

      setPromptEnhanced(true);
    } catch (error) {
      failed = true;
      logger.error(error);

      if (activeRequestRef.current === controller) {
        setInput(input);
      }

      if (!controller.signal.aborted) {
        toast.error('Impossible d’améliorer le prompt : La connexion a échoué. Vérifiez votre connexion et réessayez.');
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setEnhancingPrompt(false);
      }

      if (failed) {
        setPromptEnhanced(false);
      }
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
