import { memo } from 'react';
import { IconButton } from '~/components/ui/IconButton';
interface SettingsButtonProps {
  onClick: () => void;
}

/*
 * Both buttons used a hard-coded `text-[#666]`, which ignores the theme entirely: on the
 * panel's dark header (measured rgb(52,55,70)) that grey sits at ~2.5:1 and reads as a
 * smudge. Use the theme's own secondary ink instead, so light and dark both work.
 */
const ICON_BUTTON_CLASS = 'header-icon-control text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary';

export const SettingsButton = memo(({ onClick }: SettingsButtonProps) => {
  return (
    <IconButton
      onClick={onClick}
      icon="i-ph:gear"
      size="xl"
      title="Preferences"
      data-testid="settings-button"
      className={ICON_BUTTON_CLASS}
    />
  );
});

interface HelpButtonProps {
  onClick: () => void;
}

export const HelpButton = memo(({ onClick }: HelpButtonProps) => {
  return (
    <IconButton
      onClick={onClick}
      icon="i-ph:question"
      size="xl"
      title="Help & Documentation"
      data-testid="help-button"
      className={ICON_BUTTON_CLASS}
    />
  );
});
