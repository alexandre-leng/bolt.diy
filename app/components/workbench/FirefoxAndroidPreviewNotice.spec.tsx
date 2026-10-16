import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FirefoxAndroidPreviewNotice } from './FirefoxAndroidPreviewNotice';

describe('Firefox Android preview notice', () => {
  it('offers a private preview action and never a blank new-tab promise', () => {
    render(<FirefoxAndroidPreviewNotice files={{ 'index.html': '<h1>x</h1>' }} />);

    expect(screen.getByRole('button', { name: 'Aperçu privé' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).toBeNull();
  });

  it('still lets users dismiss the notice', () => {
    render(<FirefoxAndroidPreviewNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('firefox-android-preview-notice')).toBeNull();
  });
});
