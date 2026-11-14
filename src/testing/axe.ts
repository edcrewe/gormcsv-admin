/**
 * Test helper that runs axe-core accessibility checks on a rendered component's DOM and fails with
 * a readable list of violations. It supports the AXE and WCAG AA requirement in AGENTS.md. jsdom
 * does not compute styles, so colour contrast cannot be checked here; check it in a real browser.
 */

import axe from 'axe-core';

/**
 * Fails the test with a readable list of AXE violations.
 * color-contrast is disabled because jsdom does not compute styles; check contrast in a real browser.
 */
export async function expectNoAxeViolations(element: Element): Promise<void> {
  const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
  expect(summary).toEqual([]);
}
