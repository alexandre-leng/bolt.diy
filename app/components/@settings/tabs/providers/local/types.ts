// Type definitions
export type ProviderName = 'Ollama' | 'LMStudio' | 'OpenAILike';

export interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  status?: 'idle' | 'updating' | 'updated' | 'error' | 'checking';
  error?: string;
  newDigest?: string;
  progress?: {
    current: number;
    total: number;
    status: string;
  };
}

export interface LMStudioModel {
  id: string;
  object: 'model';
  owned_by: string;
  created?: number;
}

// Constants
export const OLLAMA_API_URL = 'http://127.0.0.1:11434';

export const PROVIDER_ICONS = {
  Ollama: 'Server',
  LMStudio: 'Monitor',
  OpenAILike: 'Globe',
} as const;

export const PROVIDER_DESCRIPTIONS = {
  Ollama: 'Exécutez des modèles open source localement sur votre machine',
  LMStudio: 'Inférence de modèles locaux avec LM Studio',
  OpenAILike: 'Connectez-vous à des points de terminaison d’API compatibles OpenAI',
} as const;
