import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { PublishButton } from '~/components/deploy/PublishButton';
import { ReportBugPanel } from '~/components/header/ReportBugPanel';
import { workbenchStore } from '~/lib/stores/workbench';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtons({ chatStarted }: HeaderActionButtonsProps) {
  const [activePreviewIndex] = useState(0);
  const [isReportBugOpen, setIsReportBugOpen] = useState(false);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];

  const shouldShowButtons = activePreview;

  /*
   * Publish does NOT wait for the preview: it builds from the files on the server. Gating it
   * on previews[0] hid it exactly when the preview could not start (dev server error,
   * Firefox Android, a chat reopened on another device) — when publishing is the only way
   * to see the site. PublishButton disables itself while there are no files.
   */
  const showPublish = chatStarted;

  return (
    <div className="flex items-center gap-1">
      {/*
       * Self-hosted publishing: the Deploy menu only offers Netlify/Vercel/GitHub/GitLab,
       * none of them connected here, so it is replaced by a button that builds the project
       * on this server and serves it at /container/<slug>/ (a real public URL).
       */}
      {showPublish && <PublishButton />}

      {/* Project Actions */}
      {shouldShowButtons && (
        <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden text-sm">
          <button
            onClick={() => setIsReportBugOpen(true)}
            className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-accent-500 text-white hover:text-bolt-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-bolt-elements-button-primary-backgroundHover outline-accent-500 flex gap-1.5"
            title="Signaler un bug"
            aria-label="Signaler un bug"
          >
            <div className="i-ph:bug" aria-hidden="true" />
            <span className="hidden sm:inline">Signaler un bug</span>
          </button>
        </div>
      )}
      <ReportBugPanel open={isReportBugOpen} onClose={() => setIsReportBugOpen(false)} />
    </div>
  );
}
