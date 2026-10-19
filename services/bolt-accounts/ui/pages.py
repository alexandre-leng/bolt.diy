"""Server-rendered pages for bolt-accounts.

The pages are plain HTML served by the accounts service, which is also the API. That keeps the
authorization in one place: a page is rendered only after the same server-side session check the
API uses, so there is no separate frontend that could be tricked into believing it is logged in.
"""

from __future__ import annotations

import html
import json
import os

UI_DIR = os.path.dirname(os.path.abspath(__file__))
_LAYOUT = None

EYE = ('<svg class="on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
       '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
       '<svg class="off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" hidden>'
       '<path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>')


def layout():
    global _LAYOUT
    if _LAYOUT is None:
        with open(os.path.join(UI_DIR, "layout.html"), encoding="utf-8") as fh:
            _LAYOUT = fh.read()
    return _LAYOUT


def page(body: str, title: str, wide: bool = False) -> bytes:
    return layout().replace("__BODY__", body).replace("__TITLE__", html.escape(title)) \
                   .replace("__WIDTH__", "wide" if wide else "").encode()


def esc(value) -> str:
    return html.escape(str(value or ""), quote=True)


def password_field(field_id: str, name: str, label: str, autocomplete: str = "new-password",
                   required: bool = True) -> str:
    return f'''<div class="field">
  <label for="{field_id}">{esc(label)}</label>
  <div class="pw">
    <input id="{field_id}" name="{name}" type="password" autocomplete="{esc(autocomplete)}" {'required' if required else ''}>
    <button type="button" class="toggle" aria-controls="{field_id}" aria-pressed="false"
            aria-label="Afficher le mot de passe" title="Afficher le mot de passe">{EYE}</button>
  </div>
</div>'''


def notice(kind: str, text: str) -> str:
    if not text:
        return ""

    return '<p class="msg %s" role="alert">%s</p>' % (kind, esc(text))


# --------------------------------------------------------------------------- auth pages

def register_page(error: str = "", notice_text: str = "") -> bytes:
    body = f'''<h1>Créer un compte</h1>
<p class="sub">Un compte pour créer et publier tes sites.</p>
{notice('err', error)}{notice('ok', notice_text)}
<form method="post" action="/register" novalidate>
  <div class="field">
    <label for="email">Adresse email</label>
    <input id="email" name="email" type="email" autocomplete="email" required autocapitalize="none" spellcheck="false">
  </div>
  <div class="field">
    <label for="displayName">Nom affiché <span class="hint">(facultatif)</span></label>
    <input id="displayName" name="displayName" type="text" autocomplete="nickname" maxlength="80">
  </div>
  {password_field('password', 'password', 'Mot de passe')}
  <p class="hint">12 caractères minimum. Une phrase de passe longue est excellente.</p>
  {password_field('passwordConfirm', 'passwordConfirm', 'Confirmer le mot de passe')}
  <div class="check">
    <input id="acceptTerms" name="acceptTerms" type="checkbox" value="1" required>
    <label for="acceptTerms">J'accepte les <a href="/terms">conditions d'utilisation</a>.</label>
  </div>
  <div class="check">
    <input id="acceptPrivacy" name="acceptPrivacy" type="checkbox" value="1" required>
    <label for="acceptPrivacy">J'ai lu la <a href="/privacy">politique de confidentialité</a>.</label>
  </div>
  <button class="submit" type="submit">Créer mon compte</button>
</form>
<p class="links"><a href="/login">J'ai déjà un compte</a></p>'''

    return page(body, "Créer un compte")


def login_page(error: str = "", notice_text: str = "", next_path: str = "/") -> bytes:
    body = f'''<h1>Connexion</h1>
<p class="sub">Connecte-toi pour accéder à ton espace.</p>
{notice('err', error)}{notice('ok', notice_text)}
<form method="post" action="/login">
  <input type="hidden" name="next" value="{esc(next_path)}">
  <div class="field">
    <label for="email">Adresse email</label>
    <input id="email" name="email" type="email" autocomplete="email" required autofocus
           autocapitalize="none" spellcheck="false">
  </div>
  {password_field('password', 'password', 'Mot de passe', autocomplete='current-password')}
  <button class="submit" type="submit">Se connecter</button>
</form>
<p class="links"><a href="/forgot-password">Mot de passe oublié ?</a><a href="/register">Créer un compte</a></p>'''

    return page(body, "Connexion")


def forgot_page(error: str = "", notice_text: str = "") -> bytes:
    body = f'''<h1>Mot de passe oublié</h1>
<p class="sub">Indique ton adresse : si un compte existe, tu recevras un lien de réinitialisation.</p>
{notice('err', error)}{notice('ok', notice_text)}
<form method="post" action="/forgot-password" novalidate>
  <div class="field">
    <label for="email">Adresse email</label>
    <input id="email" name="email" type="email" autocomplete="email" required autocapitalize="none" spellcheck="false">
  </div>
  <button class="submit" type="submit">Envoyer le lien</button>
</form>
<p class="links"><a href="/login">Retour à la connexion</a></p>'''

    return page(body, "Mot de passe oublié")


def reset_page(token: str, error: str = "", notice_text: str = "") -> bytes:
    body = f'''<h1>Nouveau mot de passe</h1>
<p class="sub">Choisis un nouveau mot de passe. Toutes tes sessions seront déconnectées.</p>
{notice('err', error)}{notice('ok', notice_text)}
<form method="post" action="/reset-password">
  <input type="hidden" name="token" value="{esc(token)}">
  {password_field('password', 'password', 'Nouveau mot de passe')}
  {password_field('passwordConfirm', 'passwordConfirm', 'Confirmer le mot de passe')}
  <button class="submit" type="submit">Changer le mot de passe</button>
</form>'''

    return page(body, "Nouveau mot de passe")


def verify_page(ok: bool, message: str) -> bytes:
    body = f'''<h1>{'Adresse confirmée' if ok else 'Lien invalide'}</h1>
{notice('ok' if ok else 'err', message)}
<p class="links"><a href="/">Continuer vers Bolt</a><a href="/login">Se connecter</a></p>'''

    return page(body, "Confirmation d'email")


def notice_page(title: str, message: str, cta: str = "", href: str = "/") -> bytes:
    button = ('<p class="links"><a href="%s">%s</a></p>' % (esc(href), esc(cta))) if cta else ""

    return page('<h1>%s</h1>%s%s' % (esc(title), notice('ok', message), button), title)


# --------------------------------------------------------------------------- app pages

def shell(user: dict, current: str, inner: str, title: str) -> bytes:
    """Common chrome for the signed-in pages, so navigation is consistent."""
    links = [("/dashboard", "Tableau de bord"), ("/settings/account", "Mon compte"),
             ("/settings/security", "Sécurité")]

    if user.get("isAdmin"):
        links.append(("/admin/users", "Administration"))

    nav = "".join('<a href="%s"%s>%s</a>' % (href, ' aria-current="page"' if href == current else "", label)
                  for href, label in links)

    inner_html = (inner + '<p class="links"><a href="/logout">Se déconnecter</a></p>')
    body = '<header class="bar"><nav>%s</nav></header>%s' % (nav, inner_html)

    return page(body, title, wide=True)


def dashboard_page(user: dict, stats: dict) -> bytes:
    cards = "".join('<tr><td>%s</td><td><strong>%s</strong></td></tr>' % (esc(k), esc(v))
                    for k, v in stats.items())
    inner = f'''<h1>Bonjour {esc(user.get('profile', {}).get('displayName') or user['email'].split('@')[0])}</h1>
<p class="sub">Ton espace Bolt.</p>
<table><tbody>{cards}</tbody></table>
<p class="links"><a href="/">Ouvrir Bolt</a></p>'''

    return shell(user, "/dashboard", inner, "Tableau de bord")


def account_page(user: dict, message: str = "", error: str = "", avatar_error: str = "") -> bytes:
    profile = user.get("profile", {})
    inner = f'''<h1>Mon compte</h1>
<p class="sub">Crée le {esc(user.get('createdAt', '')[:10])} · {esc(user['email'])}</p>
{notice('ok', message)}{notice('err', error)}
<section>
  <h2 style="font-size:1rem">Profil</h2>
  <form method="post" action="/settings/account/profile">
    <div class="field">
      <label for="displayName">Nom affiché</label>
      <input id="displayName" name="displayName" type="text" maxlength="80" value="{esc(profile.get('displayName', ''))}">
    </div>
    <div class="field">
      <label for="avatarUrl">Avatar (URL)</label>
      <input id="avatarUrl" name="avatarUrl" type="text" value="{esc(profile.get('avatarUrl', ''))}">
      {notice('err', avatar_error)}
    </div>
    <button class="submit" type="submit">Enregistrer</button>
  </form>
</section>
<section style="margin-top:28px">
  <h2 style="font-size:1rem">Adresse email</h2>
  <form method="post" action="/settings/account/email">
    <div class="field">
      <label for="newEmail">Nouvelle adresse</label>
      <input id="newEmail" name="email" type="email" required autocapitalize="none" spellcheck="false">
    </div>
    {password_field('emailPassword', 'password', 'Mot de passe actuel', autocomplete='current-password')}
    <button class="submit" type="submit">Changer l'adresse</button>
  </form>
</section>
<section style="margin-top:28px">
  <h2 style="font-size:1rem">Mes données</h2>
  <form method="post" action="/settings/account/export">
    <button class="submit" type="submit">Exporter mes données (JSON)</button>
  </form>
  <form method="post" action="/settings/account/delete" style="margin-top:20px">
    <p class="hint">La suppression est définitive : conversations, profil et publications sont détachés,
    puis le compte est effacé.</p>
    {password_field('deletePassword', 'password', 'Mot de passe (pour confirmer)', autocomplete='current-password')}
    <div class="check">
      <input id="confirmDelete" name="confirm" type="checkbox" value="1" required>
      <label for="confirmDelete">Je comprends que cette action est irréversible.</label>
    </div>
    <button class="submit" type="submit" style="background:var(--err);color:#fff">Supprimer mon compte</button>
  </form>
</section>'''

    return shell(user, "/settings/account", inner, "Mon compte")


def security_page(user: dict, sessions: list, message: str = "", error: str = "") -> bytes:
    rows = "".join(
        '<tr><td>%s</td><td>%s</td><td>%s</td></tr>' % (
            esc((s[0] or "—")[:60]), esc(s[1] or "—"), esc(s[2][:16].replace("T", " ")))
        for s in sessions
    ) or '<tr><td colspan="3">Aucune autre session active.</td></tr>'

    inner = f'''<h1>Sécurité</h1>
<p class="sub">Mot de passe et sessions actives.</p>
{notice('ok', message)}{notice('err', error)}
<section>
  <h2 style="font-size:1rem">Changer le mot de passe</h2>
  <form method="post" action="/settings/security/password">
    {password_field('currentPassword', 'currentPassword', 'Mot de passe actuel', autocomplete='current-password')}
    {password_field('newPassword', 'newPassword', 'Nouveau mot de passe')}
    {password_field('confirmPassword', 'passwordConfirm', 'Confirmer le nouveau mot de passe')}
    <button class="submit" type="submit">Changer le mot de passe</button>
  </form>
  <p class="hint">Toutes les sessions seront déconnectées, y compris les autres appareils.</p>
</section>
<section style="margin-top:28px">
  <h2 style="font-size:1rem">Sessions actives</h2>
  <table><thead><tr><th>Appareil</th><th>Adresse IP</th><th>Dernière activité</th></tr></thead>
  <tbody>{rows}</tbody></table>
  <form method="post" action="/settings/security/logout-all" style="margin-top:16px">
    <button class="submit" type="submit">Déconnecter les autres appareils</button>
  </form>
</section>'''

    return shell(user, "/settings/security", inner, "Sécurité")


def admin_page(users: list, page_no: int, total: int, per_page: int, query_text: str = "",
               role: str = "", status: str = "", message: str = "", error: str = "") -> bytes:
    rows = ""

    for u in users:
        badges = []
        if u["isAdmin"]:
            badges.append('<span class="badge">admin</span>')
        if not u["emailVerified"]:
            badges.append('<span class="badge">email non vérifié</span>')
        if u["status"] == "suspended":
            badges.append('<span class="badge">suspendu</span>')

        role_action = "Retirer admin" if u["isAdmin"] else "Promouvoir admin"
        status_action = "Réactiver" if u["status"] == "suspended" else "Suspendre"

        rows += f'''<tr>
  <td>{esc(u['email'])}<br><span class="hint">{esc(u['displayName'] or '')}</span></td>
  <td>{' '.join(badges) or '<span class="badge">user</span>'}</td>
  <td>{esc(u['createdAt'][:10])}<br><span class="hint">{esc((u['lastSeenAt'] or 'jamais')[:16].replace('T',' '))}</span></td>
  <td>{u['activeSessions']}</td>
  <td><div class="row-actions">
    <form method="post" action="/admin/users/role"><input type="hidden" name="id" value="{esc(u['id'])}">
      <input type="hidden" name="isAdmin" value="{0 if u['isAdmin'] else 1}">
      <button class="btn-sm" type="submit">{role_action}</button></form>
    <form method="post" action="/admin/users/status"><input type="hidden" name="id" value="{esc(u['id'])}">
      <input type="hidden" name="status" value="{'active' if u['status'] == 'suspended' else 'suspended'}">
      <button class="btn-sm" type="submit">{status_action}</button></form>
    <form method="post" action="/admin/users/reset"><input type="hidden" name="id" value="{esc(u['id'])}">
      <button class="btn-sm" type="submit">Email de réinitialisation</button></form>
    <form method="post" action="/admin/users/delete" onsubmit="return confirm('Supprimer ce compte ?');">
      <input type="hidden" name="id" value="{esc(u['id'])}">
      <button class="btn-sm" type="submit">Supprimer</button></form>
  </div></td>
</tr>'''

    pages = max(1, (total + per_page - 1) // per_page)
    pager = " ".join(
        ('<a href="/admin/users?page=%d">%d</a>' % (n, n) if n != page_no else '<strong>%d</strong>' % n)
        for n in range(max(1, page_no - 2), min(pages, page_no + 2) + 1)
    )

    inner = f'''<h1>Administration</h1>
<p class="sub">{total} compte(s).</p>
{notice('ok', message)}{notice('err', error)}
<form method="get" action="/admin/users" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
  <input type="text" name="q" placeholder="Email ou nom" value="{esc(query_text)}" style="flex:1;min-width:180px;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit">
  <select name="role" style="height:40px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit">
    <option value="">Tous les rôles</option>
    <option value="admin" {'selected' if role == 'admin' else ''}>Admin</option>
    <option value="user" {'selected' if role == 'user' else ''}>Utilisateur</option>
  </select>
  <select name="status" style="height:40px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit">
    <option value="">Tous les statuts</option>
    <option value="active" {'selected' if status == 'active' else ''}>Actif</option>
    <option value="suspended" {'selected' if status == 'suspended' else ''}>Suspendu</option>
  </select>
  <button class="btn-sm" type="submit" style="height:40px">Filtrer</button>
</form>
<table><thead><tr><th>Compte</th><th>Rôle</th><th>Créé / vu</th><th>Sessions</th><th>Actions</th></tr></thead>
<tbody>{rows or '<tr><td colspan="5">Aucun compte.</td></tr>'}</tbody></table>
<p class="links">{pager}</p>'''

    return shell(users[0] if False else {"isAdmin": True, "email": ""}, "/admin/users", inner, "Administration")
