import { describe, expect, it } from 'vitest';
import { selectPreview } from './previewSelection';
import { PreviewsStore } from './previews';

type PortHandler = (port: number, type: 'open' | 'close' | 'raw', url: string) => void;

function createStore() {
  let handler: PortHandler | undefined;

  const webcontainer = {
    on: (event: string, cb: unknown) => {
      if (event === 'port') {
        handler = cb as PortHandler;
      }
    },
  };

  const store = new PreviewsStore(Promise.resolve(webcontainer as never));

  const emit = (port: number, type: 'open' | 'close') => {
    handler?.(port, type, `https://p${port}.example.test`);
  };

  return { store, emit };
}

const ready = async () => {
  // allow #init's await on the webcontainer promise to resolve and register the listener
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const ports = (list: { port: number }[]) => list.map((p) => p.port);

describe('preview selection by port identity', () => {
  it('8080 then 3000 selects the latest announced port (3000), not the numerically largest', async () => {
    const { store, emit } = createStore();
    await ready();

    emit(8080, 'open');
    emit(3000, 'open');

    const selected = selectPreview(store.previews.get(), null);

    expect(selected?.port).toBe(3000);
  });

  it('a re-announcement of an existing port does not steal focus', async () => {
    const { store, emit } = createStore();
    await ready();

    emit(8080, 'open');
    emit(3000, 'open');
    emit(8080, 'open'); // irrelevant update of the older port

    expect(ports(store.previews.get())).toEqual([8080, 3000]);
    expect(selectPreview(store.previews.get(), null)?.port).toBe(3000);
  });

  it('removing a port before the selected one keeps the selected port by identity', async () => {
    const { store, emit } = createStore();
    await ready();

    emit(8080, 'open');
    emit(3000, 'open');
    emit(5173, 'open');
    emit(8080, 'close'); // removed before the selection (index shift)

    expect(selectPreview(store.previews.get(), 3000)?.port).toBe(3000);
  });

  it('falls back to the latest remaining port when the selected port is removed', async () => {
    const { store, emit } = createStore();
    await ready();

    emit(8080, 'open');
    emit(3000, 'open');
    emit(5173, 'open');

    expect(selectPreview(store.previews.get(), 3000)?.port).toBe(3000);

    emit(3000, 'close');

    expect(selectPreview(store.previews.get(), 3000)?.port).toBe(5173);
  });

  it('empty -> first port becomes the selection; empty list selects nothing', async () => {
    const { store, emit } = createStore();
    await ready();

    expect(selectPreview(store.previews.get(), null)).toBeUndefined();

    emit(4000, 'open');

    expect(selectPreview(store.previews.get(), null)?.port).toBe(4000);
  });

  it('an explicit manual choice wins over later announcements', async () => {
    const { store, emit } = createStore();
    await ready();

    emit(8080, 'open');
    emit(3000, 'open');

    expect(selectPreview(store.previews.get(), 8080)?.port).toBe(8080);

    emit(5173, 'open');

    expect(selectPreview(store.previews.get(), 8080)?.port).toBe(8080);
  });
});
