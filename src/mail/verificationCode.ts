/**
 * Extract numeric verification codes from email bodies / subjects.
 */
export function extractVerificationCode(
  text: string,
  options?: { minDigits?: number; maxDigits?: number },
): string | null {
  const min = options?.minDigits ?? 4;
  const max = options?.maxDigits ?? 8;

  const patterns = [
    new RegExp(
      `(?:verification|verify|code|otp|pin)\\s*(?:is|:)?\\s*(\\d{${min},${max}})`,
      'i',
    ),
    new RegExp(`\\b(\\d{${min},${max}})\\b`),
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}
