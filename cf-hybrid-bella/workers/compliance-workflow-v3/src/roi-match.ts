/**
 * compliance-workflow-v3/src/roi-match.ts
 * ROI exact match helpers for Ring 1 inline compliance check.
 */

export function extractDollarFigures(text: string): string[] {
  return text.match(/\$[\d,]+(?:\.\d+)?/gi) ?? [];
}

export function verifyRoiExactMatch(
  directive: string,
  bellaResponse: string,
): { match: boolean; details?: string } {
  const lockedMatch = directive.match(/lockedLines:\s*\[(.*?)\]/s);
  if (!lockedMatch) return { match: true };

  const expectedFigures = extractDollarFigures(lockedMatch[1]);
  if (expectedFigures.length === 0) return { match: true };

  const missing = expectedFigures.filter(fig => !bellaResponse.includes(fig));
  if (missing.length === 0) return { match: true };

  return { match: false, details: `Missing: ${missing.join(', ')}` };
}
