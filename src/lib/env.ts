import { z } from 'zod';

export interface Env {
  evalMode: 'offline' | 'live';
  maxRunCostUsd: number;
  appPort: number;
  playwrightAppPort: number;
  runId?: string;
  anthropicKey?: string;
  openaiKey?: string;
  linearKey?: string;
  linearTeamId?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
  langfuseHost: string;
}

/** Live credentials the runner can demand; offline mode needs none of them. */
export type LiveKeyName = 'anthropic' | 'openai' | 'linear' | 'langfuse';

const LIVE_KEY_VARIABLES: Record<LiveKeyName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  linear: 'LINEAR_API_KEY',
  langfuse: 'LANGFUSE_PUBLIC_KEY',
};

const LIVE_KEY_FIELDS = {
  anthropic: 'anthropicKey',
  openai: 'openaiKey',
  linear: 'linearKey',
  langfuse: 'langfusePublicKey',
} as const satisfies Record<LiveKeyName, keyof Env>;

/**
 * Blank means unset: a `.env` line left empty (the common case) must count as
 * "not configured", not as an invalid value.
 */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const optionalText = blankToUndefined(z.string().trim().min(1).optional());

const envSchema = z.object({
  EVAL_MODE: blankToUndefined(z.enum(['offline', 'live'])).default('offline'),
  MAX_RUN_COST_USD: blankToUndefined(z.coerce.number().nonnegative()).default(2),
  APP_PORT: blankToUndefined(z.coerce.number().int().min(1).max(65535)).default(4799),
  PLAYWRIGHT_APP_PORT: blankToUndefined(z.coerce.number().int().min(1).max(65535)).default(4731),
  RUN_ID: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  OPENAI_API_KEY: optionalText,
  LINEAR_API_KEY: optionalText,
  LINEAR_TEAM_ID: optionalText,
  LANGFUSE_PUBLIC_KEY: optionalText,
  LANGFUSE_SECRET_KEY: optionalText,
  LANGFUSE_HOST: blankToUndefined(z.string().trim().min(1)).default('https://cloud.langfuse.com'),
});

/**
 * Parse and validate the process environment. This function never reads a file:
 * the runner populates `process.env` (via `process.loadEnvFile()` when `.env`
 * exists) and passes it in, so file loading stays one decision in one place.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    evalMode: parsed.EVAL_MODE,
    maxRunCostUsd: parsed.MAX_RUN_COST_USD,
    appPort: parsed.APP_PORT,
    playwrightAppPort: parsed.PLAYWRIGHT_APP_PORT,
    runId: parsed.RUN_ID,
    anthropicKey: parsed.ANTHROPIC_API_KEY,
    openaiKey: parsed.OPENAI_API_KEY,
    linearKey: parsed.LINEAR_API_KEY,
    linearTeamId: parsed.LINEAR_TEAM_ID,
    langfusePublicKey: parsed.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: parsed.LANGFUSE_SECRET_KEY,
    langfuseHost: parsed.LANGFUSE_HOST,
  };
}

/**
 * Return the live-mode key for a provider, or throw an error that names the
 * variable and points back at offline mode, which is the default and needs no
 * key at all.
 */
export function requireLiveKey(env: Env, key: LiveKeyName): string {
  if (key === 'langfuse') {
    if (env.langfusePublicKey === undefined || env.langfuseSecretKey === undefined) {
      throw new Error(
        'Live-mode trace export needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY. ' +
          'Offline mode is the default and needs no keys: unset EVAL_MODE or set EVAL_MODE=offline.',
      );
    }
    return env.langfusePublicKey;
  }
  const value = env[LIVE_KEY_FIELDS[key]];
  if (value === undefined) {
    throw new Error(
      `${LIVE_KEY_VARIABLES[key]} is required to run live mode with the ${key} provider. ` +
        'Offline mode is the default and needs no API keys: unset EVAL_MODE or set EVAL_MODE=offline.',
    );
  }
  return value;
}
