/**
 * Edge-safe constants. Anything in session.ts pulls node:crypto, which the
 * proxy/middleware Edge runtime cannot import.
 */
export const SESSION_COOKIE_NAME = "listgram_session";
