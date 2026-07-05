import type { FeatureFlag } from '@actual-app/core/types/prefs';

import { useSyncedPref } from './useSyncedPref';

const DEFAULT_FEATURE_FLAG_STATE: Record<FeatureFlag, boolean> = {
  goalTemplatesEnabled: false,
  goalTemplatesUIEnabled: false,
  actionTemplating: false,
  formulaMode: false,
  currency: false,
  ageOfMoneyReport: false,
  balanceForecastReport: false,
  customThemes: false,
  budgetAnalysisReport: false,
  payeeLocations: false,
  enableBanking: false,
  sankeyReport: false,
  akahuBankSync: false,
  mobileCalculator: false,
  // New transaction table built on TanStack Table's column model. Enabled by
  // default; the toggle lets users fall back to the legacy table.
  transactionTableV2: true,
};

export function useFeatureFlag(name: FeatureFlag): boolean {
  const [value] = useSyncedPref(`flags.${name}`);

  return value === undefined
    ? DEFAULT_FEATURE_FLAG_STATE[name] || false
    : String(value) === 'true';
}
