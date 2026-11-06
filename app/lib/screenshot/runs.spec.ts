import { describe, expect, it, vi, beforeEach } from 'vitest';
import { newRunId, startRun, finishRun, listRuns, getRun, deleteRun } from './runs';

/*
 * Ces tests verrouillent les deux propriétés qui comptent : une génération est enregistrée
 * avec son identifiant, et une panne du service de persistance ne fait JAMAIS échouer une
 * génération. Le dialogue doit garder son résultat à l'écran même si le journal est muet.
 */

describe('newRunId', () => {
  it('produit un identifiant opaque de 32 caractères hexadécimaux', () => {
    const id = newRunId();

    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('ne réutilise pas le même identifiant deux fois', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRunId()));

    expect(ids.size).toBe(200);
  });
});

describe('startRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enregistre la génération et signale le succès', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await startRun({ id: 'abc123', mode: 'design', prompt: 'boulangerie' });

    expect(ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/screenshot-runs/abc123');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ mode: 'design', prompt: 'boulangerie', model: null });
  });

  it('tronque un prompt démesuré au lieu de faire échouer la requête', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await startRun({ id: 'abc123', mode: 'design', prompt: 'x'.repeat(5000) });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prompt.length).toBe(1500);
  });

  it('retourne false quand le service est injoignable, sans lever', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(startRun({ id: 'abc123', mode: 'design', prompt: 'test' })).resolves.toBe(false);
  });

  it('retourne false sur une réponse en erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    await expect(startRun({ id: 'abc123', mode: 'design', prompt: 'test' })).resolves.toBe(false);
  });
});

describe('finishRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('envoie le statut et les références d’images', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await finishRun({ id: 'r1', status: 'done', images: ['/a.png'] });

    expect(ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'done', images: ['/a.png'] });
  });

  it('borne le message d’erreur à 500 caractères', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await finishRun({ id: 'r1', status: 'failed', error: 'e'.repeat(2000) });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).error.length).toBe(500);
  });
});

describe('listRuns', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('filtre les entrées qui ne respectent pas la forme attendue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              { id: 'a', mode: 'design', status: 'done', images: [], prompt: 'ok', model: null, error: null },
              { id: 'b', mode: 'bogus', status: 'done', images: [] },
              { nonsense: true },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const runs = await listRuns();

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('a');
  });

  it('retourne une liste vide plutôt que de lever quand le service échoue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await expect(listRuns()).resolves.toEqual([]);
  });
});

describe('getRun / deleteRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retourne null quand la génération est absente ou appartient à un autre compte', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));

    await expect(getRun('nope')).resolves.toBeNull();
  });

  it('signale l’échec de suppression sans lever', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await expect(deleteRun('r1')).resolves.toBe(false);
  });
});
