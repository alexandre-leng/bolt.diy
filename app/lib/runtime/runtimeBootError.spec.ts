import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installRuntimeRejectionGuard,
  isRuntimeCapacityError,
  reportRuntimeBootFailure,
  resetRuntimeBootFailureForTests,
  runtimeBootMessage,
} from './runtimeBootError';
import { RuntimeOperationError } from './server/client';

// The exact error measured in production (pageerror, 4 times per page).
const QUOTA = new RuntimeOperationError(
  {
    code: 'EBUSY',
    message: "vous avez déjà 3 projets en cours d'exécution : fermez un onglet ou attendez qu'un projet se termine",
  },
  'session.open',
);

type Handler = (event: { reason: unknown; preventDefault: () => void }) => void;

function fakeWindow() {
  const handlers: Handler[] = [];

  return {
    handlers,
    addEventListener: vi.fn((type: string, handler: Handler) => {
      if (type === 'unhandledrejection') {
        handlers.push(handler);
      }
    }),
    removeEventListener: vi.fn((_type: string, handler: Handler) => {
      handlers.splice(handlers.indexOf(handler), 1);
    }),
    reject(reason: unknown) {
      const event = { reason, preventDefault: vi.fn() };
      handlers.forEach((handler) => handler(event));

      return event;
    },
  };
}

afterEach(() => resetRuntimeBootFailureForTests());

describe('refus de démarrage du runtime (EBUSY, quota de projets)', () => {
  it('reconnaît le refus de quota, et pas une erreur de fichier EBUSY ordinaire', () => {
    expect(isRuntimeCapacityError(QUOTA)).toBe(true);
    expect(
      isRuntimeCapacityError(new Error('EBUSY: capacity reached: 4 projects are running commands right now')),
    ).toBe(true);
    expect(isRuntimeCapacityError(new Error("EBUSY: resource busy or locked, rm '/home/project/x'"))).toBe(false);
    expect(isRuntimeCapacityError(new Error('ENOENT: no such file'))).toBe(false);
    expect(isRuntimeCapacityError(undefined)).toBe(false);
  });

  it('donne un message clair en français, sans le code technique', () => {
    const message = runtimeBootMessage(QUOTA);

    expect(message).toBe(
      "Vous avez déjà 3 projets en cours d'exécution : fermez un onglet ou attendez qu'un projet se termine. Rechargez ensuite la page pour démarrer ce projet.",
    );
    expect(message).not.toContain('EBUSY');
    expect(runtimeBootMessage(new Error('EBUSY: this project is open in another tab'))).toMatch(
      /^Ce projet est déjà ouvert dans un autre onglet\./,
    );
    expect(runtimeBootMessage(new Error('ESESSION: connection to the runtime was lost'))).toBe(
      'Le projet n’a pas pu démarrer : connection to the runtime was lost. Rechargez la page pour réessayer.',
    );
  });

  it('prévient l’utilisateur une seule fois', () => {
    const notify = vi.fn();

    reportRuntimeBootFailure(QUOTA, notify);
    reportRuntimeBootFailure(QUOTA, notify);

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('marque comme gérées toutes les rejections dérivées du même échec, avec un seul message', () => {
    const target = fakeWindow();
    const notify = vi.fn();
    const uninstall = installRuntimeRejectionGuard(target as never, notify);

    // Four stores awaited the boot without a catch: four rejections of the same error.
    const events = [1, 2, 3, 4].map(() => target.reject(QUOTA));

    events.forEach((event) => expect(event.preventDefault).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/^Vous avez déjà 3 projets en cours d'exécution/);

    uninstall();
    expect(target.handlers).toHaveLength(0);
  });

  it('marque aussi comme gérée une autre erreur de démarrage déjà signalée (même objet)', () => {
    const target = fakeWindow();
    const notify = vi.fn();
    const bootError = new Error('ESESSION: connection to the runtime was lost');

    installRuntimeRejectionGuard(target as never, notify);
    reportRuntimeBootFailure(bootError, notify);

    expect(target.reject(bootError).preventDefault).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('laisse passer les rejections sans rapport', () => {
    const target = fakeWindow();
    const notify = vi.fn();

    installRuntimeRejectionGuard(target as never, notify);

    const event = target.reject(new Error('something else'));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
