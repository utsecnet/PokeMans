/**
 * Thrown when an action needs an account and the invitation has been shown instead.
 *
 * A distinct type because callers have to tell it apart from a real failure: the prompt
 * is already on screen, so showing an error beside it would be the app complaining about
 * its own suggestion. Catch this and do nothing.
 */
export class SignInRequired extends Error {
  constructor() {
    super('An account is needed for this.');
    this.name = 'SignInRequired';
  }
}

/** True when a caught error is the gate rather than something that went wrong. */
export function isSignInRequired(e: unknown): boolean {
  return e instanceof SignInRequired || (e as Error)?.name === 'SignInRequired';
}
