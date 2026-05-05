/**
 * Build a mailto: URL with proper encoding and length cap.
 *
 * mailto links go via the OS handler; some clients (Outlook in particular)
 * truncate or refuse very long URLs. We cap the body at 1800 chars — leaves
 * headroom under the typical 2000-byte URL ceiling for to/subject/body.
 */

const MAX_BODY_CHARS = 1800;
const TRUNCATE_SUFFIX = '...see attached invoice';

export type BuildMailtoInput = {
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
};

export type BuildMailtoResult = {
  url: string;
  /** Body that was actually included in the URL (may be truncated). */
  body: string;
  truncated: boolean;
};

/**
 * Compose a mailto: URL safe to hand to window.location.href / window.open.
 * Truncates the body if it would push the URL too long.
 */
export function buildMailto(input: BuildMailtoInput): BuildMailtoResult {
  const { to, subject } = input;
  let body = input.body ?? '';
  let truncated = false;

  if (body.length > MAX_BODY_CHARS) {
    const cutAt = MAX_BODY_CHARS - TRUNCATE_SUFFIX.length - 1;
    body = body.slice(0, Math.max(0, cutAt)).trimEnd() + '\n\n' + TRUNCATE_SUFFIX;
    truncated = true;
  }

  const params = new URLSearchParams();
  params.set('subject', subject);
  params.set('body', body);
  if (input.cc) params.set('cc', input.cc);

  // mailto: parameter encoding — URLSearchParams uses '+' for spaces, but
  // mailto handlers expect '%20'. Convert.
  const query = params.toString().replace(/\+/g, '%20');

  const url = `mailto:${encodeURIComponent(to)}?${query}`;
  return { url, body, truncated };
}
