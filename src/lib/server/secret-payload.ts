/**
 * Secret payload codec.
 *
 * A stored credential is `{ username, password }`. Both are packed
 * into a single JSON string, then that string is AES-256-GCM
 * encrypted into `items.secret_encrypted` — so no schema change is
 * needed to carry the username alongside the password.
 *
 * Backward compatibility: secrets created before the username step
 * existed have a raw password string as the encrypted plaintext (not
 * JSON). `decodeSecretPayload` detects the `_lb` marker; anything
 * without it is treated as a legacy password-only entry.
 */

export type SecretPayload = {
  /** null when the credential has no username (e.g. a Wi-Fi password). */
  username: string | null;
  password: string;
};

/** Marker so we never mistake a legacy raw password for JSON. */
const MARKER = 1;

export function encodeSecretPayload(p: SecretPayload): string {
  return JSON.stringify({
    _lb: MARKER,
    u: p.username,
    p: p.password,
  });
}

export function decodeSecretPayload(decrypted: string): SecretPayload {
  try {
    const obj: unknown = JSON.parse(decrypted);
    if (
      obj !== null &&
      typeof obj === "object" &&
      (obj as { _lb?: unknown })._lb === MARKER
    ) {
      const o = obj as { u?: unknown; p?: unknown };
      return {
        username: typeof o.u === "string" && o.u.length > 0 ? o.u : null,
        password: typeof o.p === "string" ? o.p : "",
      };
    }
  } catch {
    // Not JSON → legacy raw-password entry.
  }
  return { username: null, password: decrypted };
}
