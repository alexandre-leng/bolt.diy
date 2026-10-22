import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDesigns } from './designs';

// Small opaque payload: no paid image call is made by this protocol regression.
const image = 'data:image/png;base64,aGVsbG8=';
afterEach(() => vi.unstubAllGlobals());

describe('progressive design direction contract', () => {
  it('sends distinct validated direction slots rather than relabeling identical requests', async () => {
    const requests: Array<{ directionIndex?: number; count: number }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return Response.json({ images: [image] });
      }),
    );

    const received: string[] = [];

    const result = await generateDesigns({
      prompt: 'Landing page Pagia',
      count: 3,
      onDesign: (d) => received.push(d.direction),
    });
    expect(requests.map((r) => r.directionIndex)).toEqual([0, 1, 2]);
    expect(requests.map((r) => r.count)).toEqual([1, 1, 1]);
    expect(received).toEqual(['Minimaliste', 'Affirmé', 'Chaleureux']);
    expect(result).toHaveLength(3);
  });
});
