import { formatCurrencyVoice } from './formatCurrency';

export interface CalculatorInput {
  acv: number;              // average client value in dollars
  inboundLeads: number;     // leads per week
  conversionRate?: number;  // current conversion rate 0-100 (optional)
  responseTimeHours?: number; // current speed-to-lead in hours (optional)
}

export interface CalculatorResult {
  weeklyValue: number;
  monthlyValue: number;
  yearlyValue: number;
  weeklyValueVoice: string;  // spoken-word format for Bella directives
  yearlyValueVoice: string;
  assumptions: string[];
}

export function tryRunCalculator(input: CalculatorInput): CalculatorResult | null {
  // Minimum required: ACV and inbound volume
  if (!input.acv || input.acv <= 0 || !input.inboundLeads || input.inboundLeads <= 0) {
    return null;
  }

  // Conservative speed-to-lead conversion lift: 20% baseline
  const baseLift = 0.20;
  // Additional lift from poor response time (capped at 5%)
  const responseBonus = input.responseTimeHours
    ? Math.min(0.05, (input.responseTimeHours / 24) * 0.08)
    : 0;

  const totalLift = baseLift + responseBonus;
  const weeklyValue = Math.round(input.inboundLeads * totalLift * input.acv);

  return {
    weeklyValue,
    monthlyValue: Math.round(weeklyValue * 4.33),
    yearlyValue: Math.round(weeklyValue * 52),
    weeklyValueVoice: formatCurrencyVoice(weeklyValue, 'dollars', 'a week'),
    yearlyValueVoice: formatCurrencyVoice(weeklyValue * 52, 'dollars', 'a year'),
    assumptions: [
      `${Math.round(totalLift * 100)}% conversion lift from speed-to-lead improvement`,
      `${input.inboundLeads} inbound leads per week`,
      `${formatCurrencyVoice(input.acv)} average client value`,
      `Conservative estimate — actual ROI typically higher`,
    ],
  };
}
