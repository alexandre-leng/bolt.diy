// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@nanostores/react', () => ({ useStore: () => [] }));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: { previews: { get: () => [], subscribe: () => vi.fn() } },
}));
vi.mock('~/lib/stores/previewSelection', () => ({ selectPreview: () => undefined }));
vi.mock('~/lib/stores/qrCodeStore', () => ({ expoUrlAtom: { get: () => undefined } }));
vi.mock('~/lib/toastify', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }) }));
vi.mock('./PortDropdown', () => ({ PortDropdown: () => <div /> }));
vi.mock('./InspectorPanel', () => ({ InspectorPanel: () => null }));
vi.mock('./ScreenshotSelector', () => ({ ScreenshotSelector: () => null }));
vi.mock('~/components/ui/IconButton', () => ({
  IconButton: ({ title }: { title?: string }) => <button title={title} aria-label={title} />,
}));
vi.mock('~/components/workbench/ExpoQrModal', () => ({ ExpoQrModal: () => null }));
vi.mock('~/lib/runtime/server/previewUrl', () => ({ parsePreviewId: () => undefined }));
import { Preview } from './Preview';
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});
describe('Preview empty state', () => {
  it('explains the unavailable preview in French and offers a restart action', () => {
    render(<Preview />);
    expect(screen.getByText(/Aucun aperçu n’est disponible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relancer le serveur de prévisualisation' })).toBeInTheDocument();
  });
});
