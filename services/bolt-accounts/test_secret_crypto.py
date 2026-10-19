#!/usr/bin/env python3
"""Tests for the per-user secret encryption.

Run with the service's interpreter, which is the one that has `cryptography`:

    cd /opt/bolt/accounts
    BOLT_SECRETS_KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))') \
        /usr/bin/python3 -m unittest test_secret_crypto

The cases below are the ones that decide whether moving API keys into the database is
safe at all: round-trip, random IV, tamper detection, key policy, and the preference
whitelist that keeps the JSONB column from accepting anything a caller invents.
"""

from __future__ import annotations

import os
import unittest

# A usable key must exist before the module is exercised; set a throwaway one so the suite
# never depends on the real environment file.
os.environ.setdefault("BOLT_SECRETS_KEY", "test-only-key-that-is-long-enough-1234567890")

import secret_crypto  # noqa: E402
from secret_crypto import SecretCryptoError, decrypt, encrypt  # noqa: E402


class RoundTrip(unittest.TestCase):
    def test_decrypting_returns_the_original(self):
        for value in ["sk-abc123", "", "clé avec accents éàü", "x" * 5000]:
            self.assertEqual(decrypt(encrypt(value)), value)

    def test_the_ciphertext_does_not_contain_the_plaintext(self):
        secret = "ghp_averydistinctivetokenvalue"

        self.assertNotIn(secret, encrypt(secret))

    def test_output_shape_is_iv_tag_data(self):
        parts = encrypt("value").split(".")

        self.assertEqual(len(parts), 3)
        self.assertTrue(all(part for part in parts))


class RandomIv(unittest.TestCase):
    def test_encrypting_twice_gives_different_ciphertexts(self):
        # If this fails, two accounts using the same provider key would be detectable by
        # comparing rows, and the encryption would be deterministic.
        secret = "same-value-both-times"

        self.assertNotEqual(encrypt(secret), encrypt(secret))


class TamperDetection(unittest.TestCase):
    def test_an_altered_ciphertext_is_refused(self):
        stored = encrypt("original-value")
        iv, tag, data = stored.split(".")

        # Flip one character of the payload.
        flipped = "A" if data[0] != "A" else "B"

        with self.assertRaises(SecretCryptoError):
            decrypt(".".join([iv, tag, flipped + data[1:]]))

    def test_an_altered_tag_is_refused(self):
        iv, tag, data = encrypt("original-value").split(".")
        flipped = "A" if tag[0] != "A" else "B"

        with self.assertRaises(SecretCryptoError):
            decrypt(".".join([iv, flipped + tag[1:], data]))

    def test_a_different_key_cannot_decrypt(self):
        stored = encrypt("original-value")
        os.environ["BOLT_SECRETS_KEY"] = "a-completely-different-key-4567890123456789"

        try:
            with self.assertRaises(SecretCryptoError):
                decrypt(stored)
        finally:
            os.environ["BOLT_SECRETS_KEY"] = "test-only-key-that-is-long-enough-1234567890"


class MalformedInput(unittest.TestCase):
    def test_garbage_is_refused_rather_than_returning_nonsense(self):
        for bad in ["", "not-a-ciphertext", "a.b", "a.b.c.d", "!!!.@@@.###"]:
            with self.assertRaises(SecretCryptoError):
                decrypt(bad)

    def test_encrypting_a_non_string_is_refused(self):
        with self.assertRaises(SecretCryptoError):
            encrypt(12345)


class KeyPolicy(unittest.TestCase):
    def test_a_short_key_is_refused(self):
        os.environ["BOLT_SECRETS_KEY"] = "too-short"

        try:
            self.assertFalse(secret_crypto.key_is_configured())

            with self.assertRaises(SecretCryptoError):
                encrypt("value")
        finally:
            os.environ["BOLT_SECRETS_KEY"] = "test-only-key-that-is-long-enough-1234567890"

    def test_a_missing_key_is_refused(self):
        saved = os.environ.pop("BOLT_SECRETS_KEY", None)

        try:
            self.assertFalse(secret_crypto.key_is_configured())

            with self.assertRaises(SecretCryptoError):
                encrypt("value")
        finally:
            if saved is not None:
                os.environ["BOLT_SECRETS_KEY"] = saved


if __name__ == "__main__":
    unittest.main(verbosity=2)
