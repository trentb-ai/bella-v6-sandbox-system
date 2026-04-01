// Voice output currency formatter
// Converts numbers to spoken-word format for Bella's TTS output
// NEVER pass display-format strings ("$300,000") to Bella's directives

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function wordsUnderThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return TENS[ten] + (one ? ' ' + ONES[one] : '');
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return ONES[hundred] + ' hundred' + (rest ? ' ' + wordsUnderThousand(rest) : '');
}

export function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  if (n < 0) return 'negative ' + numberToWords(-n);

  const parts: string[] = [];
  if (n >= 1_000_000) {
    parts.push(wordsUnderThousand(Math.floor(n / 1_000_000)) + ' million');
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    parts.push(wordsUnderThousand(Math.floor(n / 1_000)) + ' thousand');
    n %= 1_000;
  }
  if (n > 0) parts.push(wordsUnderThousand(n));

  return parts.join(' ');
}

export function formatCurrencyVoice(
  amount: number,
  currency: 'dollars' | 'percent' = 'dollars',
  period?: 'a week' | 'a month' | 'a year'
): string {
  // Round to natural spoken amounts
  let rounded = amount;
  if (amount >= 10_000) rounded = Math.round(amount / 1_000) * 1_000;
  else if (amount >= 1_000) rounded = Math.round(amount / 100) * 100;
  else rounded = Math.round(amount / 10) * 10;

  const words = numberToWords(rounded);
  const suffix = currency === 'dollars' ? ' dollars' : ' percent';
  const periodSuffix = period ? ' ' + period : '';
  return words + suffix + periodSuffix;
}

// Examples:
// formatCurrencyVoice(300000) → "three hundred thousand dollars"
// formatCurrencyVoice(12500, 'dollars', 'a week') → "twelve thousand five hundred dollars a week"
// formatCurrencyVoice(20, 'percent') → "twenty percent"
// formatCurrencyVoice(1500000, 'dollars', 'a year') → "one million five hundred thousand dollars a year"
