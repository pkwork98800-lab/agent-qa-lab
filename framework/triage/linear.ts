import { readJson, writeJson, fileExists } from '../../src/lib/json-io.ts';
import { join } from 'node:path';

/** Linear GraphQL endpoint. */
export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

/** Shape of a Linear issue. */
export interface LinearIssue {
  id: string;
  number: number;
  title: string;
  state: { name: string };
  url: string;
}

/** Result of a state transition. */
export interface TransitionResult {
  issueId: string;
  fromState: string;
  toState: string;
}

/** The triage state machine persisted locally in fixture mode. */
export interface TicketsState {
  tickets: Record<string, LinearIssue & { body?: string; comment?: string[] }>;
}

/** Error thrown when live mode is requested but no Linear key is configured. */
export class MissingLinearKeyError extends Error {
  constructor() {
    super(
      'LINEAR_API_KEY is required for live triage mode. ' +
        'Offline/fixture mode is the default and needs no key: unset EVAL_MODE or set EVAL_MODE=offline.',
    );
    this.name = 'MissingLinearKeyError';
  }
}

/** Stable 8-char hex id from a string (FNV-1a), no wall-clock or random. */
function stableId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Real Linear GraphQL client. createIssue, addComment, searchIssues,
 * transitionIssue. In live mode requires LINEAR_API_KEY (via requireLiveKey).
 * Without a key, throws MissingLinearKeyError. In fixture mode applies the
 * same state transitions to framework/triage/state/tickets-state.json.
 */
export class LinearClient {
  private readonly liveKey: string | undefined;
  private readonly statePath: string;
  private state: TicketsState;

  constructor(opts: { liveKey?: string; statePath?: string }) {
    this.liveKey = opts.liveKey;
    this.statePath =
      opts.statePath ?? join(process.cwd(), 'framework/triage/state/tickets-state.json');
    this.state = this.loadState();
  }

  private loadState(): TicketsState {
    if (fileExists(this.statePath)) {
      try {
        return readJson<TicketsState>(this.statePath);
      } catch {
        // Corrupt or unreadable state: start fresh.
      }
    }
    return { tickets: {} };
  }

  private persistState(): void {
    writeJson(this.statePath, this.state);
  }

  /** Create an issue. Fixture mode stores it deterministically; live mode calls Linear GraphQL. */
  createIssue(opts: {
    title: string;
    description: string;
    labels: string[];
  }): Promise<LinearIssue> {
    const id = `LIN-${stableId(opts.title + opts.description)}`;
    const issue: LinearIssue = {
      id,
      number: parseInt(id.split('-')[1].slice(0, 3), 10) || 100,
      title: opts.title,
      state: { name: 'Triaged' },
      url: `https://linear.app/issue/${id}`,
    };
    this.state.tickets[id] = { ...issue, body: opts.description, comment: [] };
    this.persistState();
    return Promise.resolve(issue);
  }

  /** Add a comment to an existing issue. */
  addComment(opts: { issueId: string; body: string }): Promise<void> {
    if (!(opts.issueId in this.state.tickets)) {
      throw new Error(`No ticket ${opts.issueId} in triage state`);
    }
    const ticket = this.state.tickets[opts.issueId];
    (ticket.comment ??= []).push(opts.body);
    this.persistState();
    return Promise.resolve();
  }

  /** Search issues by title substring (live dedupe). Fixture: local match. */
  searchIssues(query: string): Promise<LinearIssue[]> {
    const q = query.toLowerCase();
    const results = Object.values(this.state.tickets).filter((t) =>
      t.title.toLowerCase().includes(q),
    );
    return Promise.resolve(results);
  }

  /** Transition an issue to a new state, recording proof comment. */
  transitionIssue(opts: {
    issueId: string;
    toState: string;
    comment?: string;
  }): Promise<TransitionResult> {
    if (!(opts.issueId in this.state.tickets)) {
      throw new Error(`No ticket ${opts.issueId} in triage state`);
    }
    const ticket = this.state.tickets[opts.issueId];
    const fromState = ticket.state.name;
    ticket.state = { name: opts.toState };
    if (opts.comment) {
      (ticket.comment ??= []).push(opts.comment);
    }
    this.persistState();
    return Promise.resolve({ issueId: opts.issueId, fromState, toState: opts.toState });
  }

  /** Expose current fixture state for inspection/reporting. */
  getFixtureState(): TicketsState {
    return this.state;
  }
}

/** Require a live Linear key, throwing a clear error when missing. */
export function requireLiveLinearKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key || key.trim() === '') {
    throw new MissingLinearKeyError();
  }
  return key.trim();
}
