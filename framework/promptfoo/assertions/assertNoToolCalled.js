/**
 * assertNoToolCalled — deterministic promptfoo assertion.
 *
 * Verifies that a given tool name does NOT appear in `metadata.toolsCalled`.
 *
 * Signature: (output, { vars, provider }) => { pass, score, reason }
 */
export default function assertNoToolCalled(output, { vars, provider }) {
  const forbiddenTool = vars.forbiddenTool || vars.tool;
  const toolsCalled = (output.metadata && output.metadata.toolsCalled) || [];
  const calledNames = toolsCalled.map((t) => (t && t.name) || (t && t.tool) || String(t));

  if (!forbiddenTool) {
    return {
      pass: false,
      score: 0,
      reason: 'No forbidden tool configured (set vars.forbiddenTool).',
    };
  }

  if (calledNames.includes(forbiddenTool)) {
    return {
      pass: false,
      score: 0,
      reason: `Forbidden tool '${forbiddenTool}' was called. Called tools: ${calledNames.join(', ') || '(none)'}`,
    };
  }

  return {
    pass: true,
    score: 1,
    reason: `Forbidden tool '${forbiddenTool}' was not called.`,
  };
}
