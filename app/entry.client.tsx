import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import '~/utils/clearLocks';
import { installStaleChunkReload } from '~/lib/staleChunkReload';

installStaleChunkReload();

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
