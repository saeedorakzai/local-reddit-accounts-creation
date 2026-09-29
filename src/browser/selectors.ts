/**
 * Stable selectors for the configurable test/staging registration flow.
 * Prefer data-testid; keep CSS fallbacks. Avoid mixing text= engines in comma lists.
 */
export const Selectors = {
  registerLink: '[data-testid="register-link"], a[href*="register"]',
  emailInput: '[data-testid="email"], input[name="email"], input[type="email"], #email',
  passwordInput:
    '[data-testid="password"], input[name="password"], input[type="password"], #password',
  usernameInput:
    '[data-testid="username"], input[name="username"], input[name="displayName"], #username',
  submitButton:
    '[data-testid="submit"], button[type="submit"], input[type="submit"]',
  verificationInput:
    '[data-testid="verification-code"], input[name="code"], input[name="verificationCode"], #code, #verification-code',
  verifyButton: '[data-testid="verify-submit"], button[type="submit"]',
  preferenceSelect: '[data-testid="preference"], select[name="preference"], #preference',
  preferenceOption: 'option',
  completeButton: '[data-testid="complete"], button[type="submit"]',
  successBanner: '[data-testid="success"], .success, #success',
  accountId: '[data-testid="account-id"], #account-id, [data-account-id]',
  errorBanner: '[data-testid="error"], .error, #error',
} as const;

export type SelectorKey = keyof typeof Selectors;
