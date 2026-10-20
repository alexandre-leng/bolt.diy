import { useEffect, useId, useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { toast } from '~/lib/toastify';
import { classNames } from '~/utils/classNames';

/*
 * Account tab, native to the app.
 *
 * The account section used to exist ONLY as server-rendered HTML at /settings: its own header,
 * its own indigo accent, its own navigation. Following the link left the app entirely, so the
 * user lost the sidebar, the theme and the header they were looking at, and came back through
 * a page that did not look like the product. This tab is the same content rendered by the app's
 * own components, inside the existing ControlPanel, behind the existing header.
 *
 * It is a PURE CLIENT view of the accounts API: the forms POST the same JSON the HTML pages
 * posted, so there is one backend and no second security path.
 *
 * Two rules that are not cosmetic:
 * - every destructive action names what it destroys and keeps its confirm field empty until the
 *   user types the password: a bare "Supprimer" button next to a save button gets clicked by mistake;
 * - a field that the server refused must never be announced as saved. The success toast waits for
 *   `ok: true`, and the server's own message is shown on failure.
 */

interface AccountUser {
  id: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt?: string;
  profile?: { displayName?: string; avatarUrl?: string };
}

interface SessionRow {
  current: boolean;
  userAgent: string;
  ip: string;
  lastSeenAt: string;
}

async function postJson<T>(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Erreur ${response.status}`);
  }

  return payload;
}

const FIELD_CLASSES =
  'w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:ring-2 focus:ring-bolt-elements-borderColorActive';

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={classNames(FIELD_CLASSES, 'pr-11')}
        />
        {/*
         * Accessible show/hide control, keyboard reachable, aria-pressed and a localised label
         * (the user asks for this on every password field of their sites).
         */}
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          title={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md bg-transparent text-bolt-elements-textTertiary hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          <span className={visible ? 'i-ph:eye-slash text-base' : 'i-ph:eye text-base'} aria-hidden="true" />
        </button>
      </div>
      {/*
       * The hint is a real description, not a copy of the label. A `<span class="sr-only">` that
       * repeats the label text makes a screen reader announce every field twice ("Mot de passe
       * actuel, Mot de passe actuel"), which is what the first version of this component did.
       */}
      {hint ? (
        <span id={hintId} className="block text-xs text-bolt-elements-textTertiary">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export default function AccountTab() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me: { user?: AccountUser } | null = await Promise.all([
          fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch('/api/auth/sessions', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : { sessions: [] }))
            .catch(() => ({ sessions: [] })),
        ]).then(([meResult, sessionList]) => {
          setSessions(((sessionList as { sessions?: SessionRow[] }).sessions ?? []) as SessionRow[]);

          return meResult as { user?: AccountUser } | null;
        });

        if (cancelled) {
          return;
        }

        if (me?.user) {
          setUser(me.user as AccountUser);
          setDisplayName(me.user.profile?.displayName ?? '');
          setAvatarUrl(me.user.profile?.avatarUrl ?? '');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);

    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Une erreur est survenue.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-bolt-elements-textTertiary" role="status">
        <span className="i-ph:spinner-gap animate-spin" aria-hidden="true" />
        Chargement du compte…
      </div>
    );
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Compte</CardTitle>
          <CardDescription>Session expirée. Reconnecte-toi pour gérer ton compte.</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/login"
            className="inline-flex h-9 items-center rounded-md border border-bolt-elements-borderColor px-4 text-sm font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
          >
            Se connecter
          </a>
        </CardContent>
      </Card>
    );
  }

  const otherSessions = sessions.filter((session) => !session.current).length;

  return (
    <div className="space-y-6" data-testid="account-tab">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>
            {user.email}
            {user.createdAt ? ` · compte créé le ${user.createdAt.slice(0, 10)}` : ''}
            {user.emailVerified ? '' : ' · adresse non confirmée'}
            {user.isAdmin ? ' · administrateur' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-display-name">Nom affiché</Label>
            <Input
              id="account-display-name"
              value={displayName}
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-avatar">Avatar (URL)</Label>
            <Input id="account-avatar" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
          </div>
          <Button
            disabled={busy === 'profile'}
            onClick={() =>
              run('profile', async () => {
                await postJson('/api/auth/profile', { displayName, avatarUrl }, 'PATCH');
                toast.success('Profil enregistré.');
              })
            }
          >
            {busy === 'profile' ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle>Adresse email</CardTitle>
          <CardDescription>
            Un lien de confirmation est envoyé à la nouvelle adresse, et l&apos;ancienne est prévenue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-new-email">Nouvelle adresse</Label>
            <Input
              id="account-new-email"
              type="email"
              value={newEmail}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </div>
          <PasswordField
            id="account-email-password"
            label="Mot de passe actuel (confirmation)"
            value={emailPassword}
            onChange={setEmailPassword}
          />
          <Button
            variant="outline"
            disabled={busy === 'email' || !newEmail || !emailPassword}
            onClick={() =>
              run('email', async () => {
                const result = await postJson<{ message?: string }>('/api/auth/change-email', {
                  email: newEmail,
                  password: emailPassword,
                });
                setNewEmail('');
                setEmailPassword('');
                toast.success(result.message || 'Adresse modifiée.');
              })
            }
          >
            {busy === 'email' ? 'Modification…' : "Changer l'adresse"}
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle>Mot de passe</CardTitle>
          <CardDescription>Changer le mot de passe déconnecte les autres appareils.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordField
            id="account-current-password"
            label="Mot de passe actuel"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <PasswordField
            id="account-new-password"
            label="Nouveau mot de passe"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            hint="8 caractères minimum."
          />
          <PasswordField
            id="account-confirm-password"
            label="Confirmer le nouveau mot de passe"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <Button
            variant="outline"
            disabled={
              busy === 'password' || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword
            }
            onClick={() =>
              run('password', async () => {
                await postJson('/api/auth/change-password', { currentPassword, password: newPassword });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                toast.success('Mot de passe modifié.');
              })
            }
          >
            {busy === 'password' ? 'Modification…' : 'Changer le mot de passe'}
          </Button>
          {newPassword && confirmPassword && newPassword !== confirmPassword ? (
            <p className="text-xs text-amber-600 dark:text-amber-400" role="alert">
              Les deux mots de passe ne correspondent pas.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Sessions */}
      <Card>
        <CardHeader>
          <CardTitle>Appareils connectés</CardTitle>
          <CardDescription>
            {otherSessions === 0
              ? 'Aucune autre session active.'
              : `${otherSessions} autre${otherSessions > 1 ? 's' : ''} session${otherSessions > 1 ? 's' : ''} active${otherSessions > 1 ? 's' : ''}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {sessions.slice(0, 5).map((session) => (
              <li
                key={`${session.userAgent}-${session.lastSeenAt}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-bolt-elements-textPrimary">
                  {session.userAgent || 'Client inconnu'}
                </span>
                <span className="text-bolt-elements-textTertiary">
                  {session.current ? 'Cet appareil' : session.ip} · {session.lastSeenAt.replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            disabled={busy === 'revoke' || otherSessions === 0}
            onClick={() =>
              run('revoke', async () => {
                const result = await postJson<{ message?: string }>('/api/auth/sessions/revoke-others', {});
                setSessions((current) => current.filter((session) => session.current));
                toast.success(result.message || 'Autres sessions déconnectées.');
              })
            }
          >
            {busy === 'revoke' ? 'Déconnexion…' : 'Déconnecter les autres appareils'}
          </Button>
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardHeader>
          <CardTitle>Mes données</CardTitle>
          <CardDescription>Exporte tout ce que le compte contient, ou supprime-le définitivement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button
            variant="outline"
            disabled={busy === 'export'}
            onClick={() =>
              run('export', async () => {
                const result = await postJson<{ data: unknown }>('/api/auth/export', {});
                const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `bolt-donnees-${new Date().toISOString().slice(0, 10)}.json`;
                link.click();
                URL.revokeObjectURL(url);
                toast.success('Export téléchargé.');
              })
            }
          >
            {busy === 'export' ? 'Préparation…' : 'Exporter mes données (JSON)'}
          </Button>

          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
            <p className="text-sm font-medium text-bolt-elements-textPrimary">Supprimer le compte</p>
            <p className="text-xs text-bolt-elements-textSecondary">
              La suppression est définitive : conversations, profil et publications sont détachés, puis le compte est
              effacé. Cette action ne peut pas être annulée.
            </p>
            <PasswordField
              id="account-delete-password"
              label="Mot de passe (pour confirmer)"
              value={deletePassword}
              onChange={setDeletePassword}
            />
            <Button
              variant="destructive"
              disabled={busy === 'delete' || !deletePassword}
              onClick={() =>
                run('delete', async () => {
                  await postJson('/api/auth/delete-account', { password: deletePassword });

                  /*
                   * The session is gone with the account: leave through the server, which also
                   * clears the cookie. Navigating anywhere in-app would land on a 401 page.
                   */
                  window.location.href = '/login';
                })
              }
            >
              {busy === 'delete' ? 'Suppression…' : 'Supprimer définitivement mon compte'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
