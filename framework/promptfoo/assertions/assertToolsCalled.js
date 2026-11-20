/**
 * assertToolsCalled — deterministic promptfoo assertion.
 *
 * Verifies that expected tool names appear in `metadata.toolsCalled` in the
 * declared order. Each tool must appear at least once; the order of first
 * appearances must match the `expectedTools` array.
 *
 * Signature: (output, { vars, provider }) => { pass, score, reason }
 *   output: { output: string, metadata: { toolsCalled: [...], ... } }
 */
export default function assertToolsCalled(output, { vars, provider }) {
  const expectedTools = vars.expectedTools || [];
  const toolsCalled = (output.metadata && output.metadata.toolsCalled) || [];
  const calledNames = toolsCalled.map((t) => (t && t.name) || (t && t.tool) || String(t));

  if (expectedTools.length === 0) {
    return { pass: true, score: 1, reason: 'No expected tools configured.' };
  }

  // Check that each expected tool appears at least once.
  const missing = expectedTools.filter((tool) => !calledNames.includes(tool));
  if (missing.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: `Expected tools not called: ${missing.join(', ')}. Called: ${calledNames.join(', ') || '(none)'}`,
    };
  }

  // Check that first-appearance order matches expectedTools order.
  const firstIndex = (tool) => calledNames.indexOf(tool);
  const ordered = expectedTools.every(
    (tool, i) => i === 0 || firstIndex(tool) >= firstIndex(expectedTools[i - 1]),
  );
  if (!ordered) {
    return {
      pass: false,
      score: 0,
      reason: `Tools called out of expected order. Expected: ${expectedTools.join(', ')}. Observed first appearances: ${calledNames.join(', ')}`,
    };
  }

  return {
    pass: true,
    score: 1,
    reason: `All expected tools called in order: ${expectedTools.join(', ')}`,
  };
}
