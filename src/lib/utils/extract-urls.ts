/**
 * Pull HTTP(S) URLs out of free-text. Used by the Mini App's item edit
 * sheet to surface clickable links below a description textarea —
 * users paste URLs into the description; we extract + render them as
 * anchors so they don't have to copy/paste back out to open one.
 *
 * Deliberately conservative regex: only matches https?:// + non-whitespace,
 * trimming common trailing punctuation that's almost always sentence
 * structure rather than path content (., ,, ;, :, ), ], }). False
 * negatives (no auto-protocol guessing, no www-prefix matching) are
 * fine — paste-the-full-URL is the user expectation everywhere else.
 */
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_RE);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(TRAILING_PUNCT, "");
    if (cleaned.length < 8) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Display the URL with the scheme stripped + path elided so a long
 * tracking URL doesn't blow up the layout. The full URL stays on the
 * anchor's `href`.
 */
export function shortUrl(url: string, max = 40): string {
  let s = url.replace(/^https?:\/\//, "");
  if (s.length > max) {
    s = s.slice(0, max - 1) + "…";
  }
  return s;
}
