import { DuplicateRule } from '../../shared/api-types';

/** How a model's duplicate rule reads in the UI, e.g. "skipped when code matches". */
export function describeDuplicateRule(rule: DuplicateRule | undefined): string {
  if (!rule || rule.mode === 'allow') return 'imported again';
  if (rule.mode === 'identical') return 'skipped when the whole row matches';
  const verb = rule.columns.length === 1 ? 'matches' : 'match';
  return `skipped when ${rule.columns.join(' + ')} ${verb}`;
}
