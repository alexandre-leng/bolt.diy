#!/usr/bin/env python3
"""Encryption for the per-user secrets stored by bolt-accounts.

The browser used to be the only home for API keys (GitHub, Netlify, Vercel, Supabase,
providers), which is why signing in on a phone asked for every one of them again. Moving
them to the account means the database now holds credentials: they must not be readable in
a database dump.

AES-256-GCM, with the format `iv.tag.data` (all base64). GCM is authenticated, so a value
that was tampered with fails to decrypt instead of returning garbage that would then be
sent to GitHub or a provider as if it were a key. A fresh random IV per encryption means
the same key stored twice produces two different ciphertexts, so an observer cannot tell
that two accounts use the same provider key.

The key comes from BOLT_SECRETS_KEY in the service's environment, never from the database:
a dump of `user_secrets` alone is therefore useless. Generation:

    python3 -c "import secrets; print(secrets.token_urlsafe(48))"

Read, never guessed: an absent or short key raises on use, so the service cannot silently
store plaintext (or weakly encrypted values) if the environment is misconfigured.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_BYTES = 12          # 96 bits, the size AES-GCM is specified for
MIN_KEY_CHARS = 32     # do not accept a short human secret as an encryption key
ENV_VAR = "BOLT_SECRETS_KEY"


class SecretCryptoError(RuntimeError):
    """Raised when the key is unusable or a ciphertext cannot be read."""


def _key() -> bytes:
    """Derive the 32-byte AES key from the environment secret.

    SHA-256 is used to turn an arbitrary-length passphrase into the exact key size. The
    raw environment value is not used directly: most secrets are not 32 bytes long, and
    padding or truncating one would silently weaken it.
    """
    raw = os.environ.get(ENV_VAR, "")

    if not raw:
        raise SecretCryptoError(
            "%s is not set: refusing to store secrets without encryption." % ENV_VAR
        )

    if len(raw) < MIN_KEY_CHARS:
        raise SecretCryptoError(
            "%s must be at least %d characters (got %d)." % (ENV_VAR, MIN_KEY_CHARS, len(raw))
        )

    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt(plaintext: str) -> str:
    """Encrypt a value for storage. Returns 'iv.tag.data', base64."""
    if not isinstance(plaintext, str):
        raise SecretCryptoError("only strings can be encrypted")

    iv = os.urandom(IV_BYTES)
    # cryptography's AESGCM appends the 16-byte tag to the ciphertext.
    sealed = AESGCM(_key()).encrypt(iv, plaintext.encode("utf-8"), None)
    tag, data = sealed[-16:], sealed[:-16]

    return ".".join(
        base64.b64encode(part).decode("ascii") for part in (iv, tag, data)
    )


def decrypt(stored: str) -> str:
    """Decrypt a stored value. Raises SecretCryptoError on tampering or malformed input."""
    if not isinstance(stored, str) or not stored:
        raise SecretCryptoError("ciphertext is empty")

    parts = stored.split(".")

    if len(parts) != 3:
        raise SecretCryptoError("ciphertext must look like iv.tag.data")

    try:
        iv, tag, data = (base64.b64decode(part, validate=True) for part in parts)
    except Exception as exc:  # noqa: BLE001 - any decoding failure is the same refusal
        raise SecretCryptoError("ciphertext is not valid base64") from exc

    if len(iv) != IV_BYTES or len(tag) != 16:
        raise SecretCryptoError("ciphertext has an unexpected IV or tag length")

    try:
        return AESGCM(_key()).decrypt(iv, data + tag, None).decode("utf-8")
    except InvalidTag as exc:
        # Wrong key, or the row was modified. Either way the value is not trustworthy.
        raise SecretCryptoError("secret failed authentication (wrong key or altered data)") from exc
    except UnicodeDecodeError as exc:
        raise SecretCryptoError("decrypted secret is not valid UTF-8") from exc


def key_is_configured() -> bool:
    """True when a usable key is present, without raising. For health checks and startup."""
    try:
        _key()
        return True
    except SecretCryptoError:
        return False
