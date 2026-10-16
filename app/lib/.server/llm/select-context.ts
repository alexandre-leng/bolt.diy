import { generateText, type UIMessage } from 'ai';
import ignore from 'ignore';
import { IGNORE_PATTERNS, type FileMap } from './constants';
import { createFilesContext, extractCurrentContext, extractPropertiesFromMessage, simplifyBoltActions } from './utils';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createMessage, getFirstTextPart, getMessageText } from '~/lib/persistence/messageMigration';
import type { IProviderSetting } from '~/types/model';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

// Common patterns to ignore, similar to .gitignore

const ig = ignore().add(IGNORE_PATTERNS);
const logger = createScopedLogger('select-context');

export async function selectContext(props: {
  messages: UIMessage[];
  env?: Env;
  apiKeys?: Record<string, string>;
  files: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  summary: string;
  onFinish?: (resp: Awaited<ReturnType<typeof generateText>>) => void;
}) {
  const { messages, env: serverEnv, apiKeys, files, providerSettings, summary, onFinish } = props;

  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;

  const processedMessages = messages.map((message) => {
    if (message.role === 'user') {
      const { model, provider } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;

      return message;
    } else if (message.role == 'assistant') {
      let text = simplifyBoltActions(getMessageText(message));
      text = text.replace(/<think>.*?<\/think>/s, '');

      return createMessage({ id: message.id, role: 'assistant', text }) as UIMessage;
    }

    return message;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);

  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const { codeContext } = extractCurrentContext(processedMessages);

  let filePaths = getFilePaths(files || {});
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  let context = '';

  const currrentFiles: string[] = [];
  const contextFiles: FileMap = {};

  if (codeContext?.type === 'codeContext') {
    const codeContextFiles: string[] = codeContext.files;
    Object.keys(files || {}).forEach((path) => {
      let relativePath = path;

      if (path.startsWith('/home/project/')) {
        relativePath = path.replace('/home/project/', '');
      }

      if (codeContextFiles.includes(relativePath)) {
        contextFiles[relativePath] = files[path];
        currrentFiles.push(relativePath);
      }
    });
    context = createFilesContext(contextFiles);
  }

  const summaryText = `Here is the summary of the chat till now: ${summary}`;

  const extractTextContent = getFirstTextPart;

  const lastUserMessage = processedMessages.filter((x) => x.role == 'user').pop();

  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  // select files from the list of code file from the project that might be useful for the current request from the user
  const resp = await generateText({
    system: `
        You are a software engineer. You are working on a project. You have access to the following files:

        AVAILABLE FILES PATHS
        ---
        ${filePaths.map((path) => `- ${path}`).join('\n')}
        ---

        You have following code loaded in the context buffer that you can refer to:

        CURRENT CONTEXT BUFFER
        ---
        ${context}
        ---

        Now, you are given a task. You need to select the files that are relevant to the task from the list of files above.

        RESPONSE FORMAT:
        your response should be in following format:
---
<updateContextBuffer>
    <includeFile path="path/to/file"/>
    <excludeFile path="path/to/file"/>
</updateContextBuffer>
---
        * Your should start with <updateContextBuffer> and end with </updateContextBuffer>.
        * You can include multiple <includeFile> and <excludeFile> tags in the response.
        * You should not include any other text in the response.
        * You should not include any file that is not in the list of files above.
        * You should not include any file that is already in the context buffer.
        * If no changes are needed, you can leave the response empty updateContextBuffer tag.
        `,
    prompt: `
        ${summaryText}

        Users Question: ${extractTextContent(lastUserMessage)}

        update the context buffer with the files that are relevant to the task from the list of files above.

        CRITICAL RULES:
        * Only include relevant files in the context buffer.
        * context buffer should not include any file that is not in the list of files above.
        * context buffer is extremlly expensive, so only include files that are absolutely necessary.
        * If no changes are needed, you can leave the response empty updateContextBuffer tag.
        * Only 5 files can be placed in the context buffer at a time.
        * if the buffer is full, you need to exclude files that is not needed and include files that is relevent.

        `,
    model: provider.getModelInstance({
      /*
       * modelDetails, not the requested name: when the model is unknown this already
       * fell back to the first available one, and sending the unknown name produced a
       * "model not found" 4xx from the provider instead of the intended fallback.
       */
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    reasoning: 'none',
  });

  if (onFinish) {
    onFinish(resp);
  }

  const selected = applyContextBufferUpdate({
    responseText: resp.text,
    files,
    filePaths,
    currentContext: contextFiles,
  });
  logger.info(`Total files: ${Object.keys(selected).length}`);

  return selected;
}

/**
 * Apply the model's `<updateContextBuffer>` answer to the files already in context.
 *
 * Two defects lived here. Selecting zero NEW files threw "Bolt failed to select files" and
 * failed the whole chat turn — yet the prompt itself tells the model that an empty tag is
 * the right answer when nothing changes, and a follow-up question about files already loaded
 * hits exactly that. And the files kept in the buffer were dropped from the result: only the
 * newly included ones reached the model. A malformed answer now keeps the current context
 * instead of throwing.
 */
export function applyContextBufferUpdate(args: {
  responseText: string;
  files: FileMap;
  filePaths: string[];
  currentContext: FileMap;
}): FileMap {
  const { responseText, files, filePaths, currentContext } = args;
  const result: FileMap = { ...currentContext };
  const update = responseText.match(/<updateContextBuffer>([\s\S]*?)<\/updateContextBuffer>/);

  if (!update) {
    logger.warn('context selection answer has no <updateContextBuffer>; keeping the current context');

    return result;
  }

  const paths = (tag: string) =>
    [...update[1].matchAll(new RegExp(`<${tag} path="(.*?)"`, 'g'))].map((match) => match[1]);

  for (const path of paths('excludeFile')) {
    delete result[path];
    delete result[path.replace(/^\/home\/project\//, '')];
  }

  for (const path of paths('includeFile')) {
    const fullPath = path.startsWith('/home/project/') ? path : `/home/project/${path}`;

    if (!filePaths.includes(fullPath)) {
      logger.error(`File ${path} is not in the list of files above.`);
      continue;
    }

    const relativePath = fullPath.replace('/home/project/', '');

    if (!result[relativePath]) {
      result[relativePath] = files[fullPath];
    }
  }

  return result;
}

export function getFilePaths(files: FileMap) {
  let filePaths = Object.keys(files);
  filePaths = filePaths.filter((x) => {
    const relPath = x.replace('/home/project/', '');
    return !ig.ignores(relPath);
  });

  return filePaths;
}
