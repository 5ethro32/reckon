/**
 * Contact email used in privacy / terms / settings / no-access pages.
 *
 * Self-hosters: set NEXT_PUBLIC_CONTACT_EMAIL in your env to surface your
 * own contact email. Otherwise the placeholder below is shown.
 *
 * Why this is public env: privacy/terms pages are server-rendered but the
 * value is also embedded in mailto links, so there's no harm exposing it.
 */

export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'contact@example.com';

/**
 * Operator name used in the privacy notice. Self-hosters: set
 * NEXT_PUBLIC_OPERATOR_NAME to your trading name or full name.
 */
export const OPERATOR_NAME =
  process.env.NEXT_PUBLIC_OPERATOR_NAME ?? 'the operator';
