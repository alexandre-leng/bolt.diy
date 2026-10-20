import { useEffect } from 'react';
import type { MetaFunction } from 'react-router';
import { useNavigate } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { MobileNav } from '~/components/mobile/MobileNav';
import { requestOpenSettings } from '~/components/mobile/MobileNav';

export const meta: MetaFunction = () => {
  return [{ title: 'Mon compte · Bolt' }];
};

export const loader = () => Response.json({});

/*
 * `/settings` used to be served by nginx straight to the accounts service, as a server-rendered
 * page with its own stylesheet, its own header and its own navigation. Following a link from the
 * app therefore replaced the whole product with a page that did not look like it, and the user
 * lost the sidebar, the theme and the header on the way.
 *
 * This route keeps the URL (bookmarks and mail links still land here) but renders the app: the
 * real header, the real chat shell underneath, and the native account tab opened in the settings
 * panel. When the panel closes, the URL falls back to `/` so the address bar never claims to be
 * on a settings page that is no longer on screen.
 */
export default function SettingsRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    requestOpenSettings('account');

    const onClose = () => {
      navigate('/', { replace: true });
    };

    window.addEventListener('bolt:settings-closed', onClose);

    return () => window.removeEventListener('bolt:settings-closed', onClose);
  }, [navigate]);

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      <ClientOnly>{() => <MobileNav />}</ClientOnly>
    </div>
  );
}
