/**
 * Scenario file schema — the data contract for everything under scenarios/.
 * Owned by the orchestrator. Sub-agents read-only; request changes in reports.
 *
 * Every scenario is ONE JSON file: scenarios/<suite>/scn-*.json, validated
 * against this schema by scripts/run-eval.ts before any chat is run.
 */
import { z } from 'zod';
import type { Assertion, Scenario } from '../src/contracts/types.ts';

const Severity = z.enum(['blocker', 'major', 'minor']);

const ToolName = z.enum([
  'search_record',
  'create_record',
  'update_record',
  'send_email',
  'check_permissions',
  'summarise',
]);

const Role = z.enum(['owner', 'admin', 'sales_rep', 'support_agent', 'read_only', 'external']);

const PersonaId = z.enum([
  'owner_emma',
  'manager_viktor',
  'rep_liam',
  'support_sofia',
  'auditor_raul',
  'contractor_dana',
]);

const AssertionBase = z.object({
  id: z.string().regex(/^A[0-9]{2}$/, 'assertion ids look like A01, A02'),
  description: z.string().optional(),
  severity: Severity.optional(),
});

const assertionVariants = [
  AssertionBase.extend({
    type: z.literal('tool-called'),
    tool: ToolName,
    minTimes: z.number().int().optional(),
    maxTimes: z.number().int().optional(),
    atPosition: z.number().int().optional(),
  }),
  AssertionBase.extend({ type: z.literal('tool-not-called'), tool: ToolName }),
  AssertionBase.extend({
    type: z.literal('tool-args-match'),
    tool: ToolName,
    occurrence: z.number().int().optional(),
    fields: z.record(z.unknown()),
  }),
  AssertionBase.extend({
    type: z.literal('db-field-equals'),
    table: z.string(),
    match: z.record(z.unknown()),
    field: z.string(),
    expected: z.unknown(),
  }),
  AssertionBase.extend({
    type: z.literal('db-record-count'),
    table: z.string(),
    where: z.record(z.unknown()).optional(),
    expected: z.number().int(),
  }),
  AssertionBase.extend({
    type: z.literal('db-consistency'),
    check: z.enum([
      'deal-total-matches-line-items',
      'line-items-orphan-free',
      'invoice-balance-matches-payments',
    ]),
    id: z.string(),
  }),
  AssertionBase.extend({
    type: z.literal('api-response-matches'),
    method: z.enum(['GET', 'POST', 'PATCH']),
    path: z.string(),
    body: z.record(z.unknown()).optional(),
    expectStatus: z.number().int(),
    fields: z.record(z.unknown()).optional(),
  }),
  AssertionBase.extend({
    type: z.literal('permission-outcome'),
    asRole: Role,
    action: z.enum(['read', 'create', 'update', 'delete', 'send-email']),
    resource: z.string(),
    expected: z.enum(['allow', 'deny']),
  }),
  AssertionBase.extend({
    type: z.literal('response-contains'),
    text: z.string().optional(),
    regex: z.string().optional(),
    anyOf: z.array(z.string()).optional(),
    noneOf: z.array(z.string()).optional(),
  }),
  AssertionBase.extend({
    type: z.literal('llm-rubric'),
    rubricId: z.string(),
    minScore: z.number(),
    dimensions: z.array(z.string()).optional(),
  }),
  AssertionBase.extend({ type: z.literal('trace-shape'), shapeId: z.string() }),
  AssertionBase.extend({
    type: z.literal('no-pii-in-outbound'),
    channel: z.literal('email'),
    patterns: z.array(z.string()).optional(),
  }),
  AssertionBase.extend({
    type: z.literal('outbound-contains'),
    channel: z.literal('email'),
    text: z.string(),
  }),
  AssertionBase.extend({
    type: z.literal('outbound-count'),
    channel: z.literal('email'),
    to: z.string().optional(),
    expected: z.number().int(),
  }),
  AssertionBase.extend({ type: z.literal('latency-budget'), maxMs: z.number().int() }),
  AssertionBase.extend({ type: z.literal('cost-budget'), maxUsd: z.number() }),
];

// zod union needs a non-empty tuple of options; the variant array is built
// programmatically, so cast through unknown at the edge. (Every variant
// carries a literal `type` key, so validation works at runtime; the cast only
// satisfies the tuple type argument. `z.ZodTypeAny` avoids an explicit `any`.)
export const AssertionSchema = z.union(
  assertionVariants as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
) as unknown as z.ZodType<Assertion>;

export const ScenarioSchema = z
  .object({
    id: z.string().regex(/^scn-[a-z]+-[0-9]{3}$/, 'scenario ids look like scn-core-001'),
    suite: z.enum(['smoke', 'core', 'redteam']),
    title: z.string().min(8).max(120),
    category: z.enum([
      'lookup',
      'create-record',
      'update-record',
      'permission',
      'communication',
      'multi-step',
      'hallucination',
      'injection-direct',
      'injection-indirect',
      'cross-tenant',
      'exfiltration',
      'over-action',
      'pii-in-logs',
    ]),
    persona: PersonaId,
    userProblem: z
      .string()
      .min(15)
      .refine((s) => !/^(hi|hello|hey|what can you do)/i.test(s.trim()), {
        message: 'userProblem must start from a genuine task, not a greeting',
      }),
    followUps: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
      .optional(),
    seed: z.object({ reset: z.boolean().optional(), note: z.string().optional() }).optional(),
    expectedOutcome: z.object({
      description: z.string(),
      kind: z.enum(['action-completed', 'refusal', 'partial-action', 'clarification']),
      keyFacts: z.array(z.string()),
    }),
    assertions: z.array(AssertionSchema).min(2, 'every scenario needs at least 2 assertions'),
    trace: z
      .object({
        shapeId: z.string(),
        requiredSpans: z.array(z.string()),
        forbiddenSpans: z.array(z.string()).optional(),
        maxLatencyMs: z.number().int().optional(),
        maxCostUsd: z.number().optional(),
      })
      .optional(),
    redteam: z
      .object({
        probeId: z.string().regex(/^rt-[0-9]{2}$/, 'probe ids look like rt-01'),
        severity: Severity,
      })
      .optional(),
    tags: z.array(z.string()).min(1),
    rationale: z.string().optional(),
  })
  .strict()
  .refine((s) => (s.suite === 'redteam') === Boolean(s.redteam), {
    message: 'redteam scenarios must carry a redteam block; others must not',
  });

export type ScenarioFile = z.infer<typeof ScenarioSchema>;

/** Parse + validate one scenario file. Throws with the file path on failure. */
export function parseScenario(raw: unknown, sourcePath: string): Scenario {
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid scenario file ${sourcePath}:\n${issues}`);
  }
  const s = parsed.data;
  // The frozen TS types and this schema share one shape; assert it at the edge.
  return s;
}

/** Type guard used by tests to prove every assertion in a file parses. */
export function isAssertion(value: unknown): value is Assertion {
  return AssertionSchema.safeParse(value).success;
}
