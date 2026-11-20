/**
 * HTTP client for the app under test.
 * ---------------------------------------------------------------------------
 * Owned by agent 2b (apps/agent/**).
 *
 * The agent never touches SQLite. Every fact it states comes from one of the
 * six frozen tools, and every one of those tools is an HTTP call against the
 * endpoint catalogue in `src/contracts/app-api.ts`, authenticated with the
 * demo `x-actor-id` header of the acting persona.
 *
 * Tool → route mapping (the catalogue is frozen; this is the only mapping):
 *
 *   search_record     GET    /api/v1/records?type&q&limit
 *   create_record     POST   /api/v1/records/:type
 *   update_record     PATCH  /api/v1/records/:type/:id
 *   send_email        POST   /api/v1/emails
 *   check_permissions GET    /api/v1/permissions/check?action&resource
 *   summarise         (local — no route in the catalogue; see tool-executor.ts)
 *
 * `summarise` has no HTTP route in the frozen catalogue: it is the agent's own
 * answer-composition step over the tool results it already collected, so it is
 * executed locally by the tool executor and still emits a `tool.summarise`
 * span like any other invocation.
 */

export const ACTOR_HEADER = 'x-actor-id';
export const DEFAULT_APP_BASE_URL = 'http://127.0.0.1:4799';

export interface AppResponse {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or `null` when the body was empty or not JSON. */
  body: unknown;
}

export interface ListRecordsParams {
  type?: string;
  q?: string;
  limit?: number;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

/** The transport the tool executor talks to. Kept narrow so it is mockable. */
export interface AppTransport {
  listRecords(params: ListRecordsParams): Promise<AppResponse>;
  getRecord(type: string, id: string): Promise<AppResponse>;
  createRecord(type: string, fields: Record<string, unknown>): Promise<AppResponse>;
  updateRecord(type: string, id: string, fields: Record<string, unknown>): Promise<AppResponse>;
  checkPermission(action: string, resource: string): Promise<AppResponse>;
  sendEmail(params: SendEmailParams): Promise<AppResponse>;
}

/** Raised when the app cannot be reached at all (as opposed to answering no). */
export class AppUnavailableError extends Error {
  constructor(url: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`App under test unreachable at ${url}: ${detail}`);
    this.name = 'AppUnavailableError';
  }
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class HttpAppTransport implements AppTransport {
  readonly baseUrl: string;
  readonly actorId: string;

  constructor(actorId: string, baseUrl?: string) {
    this.actorId = actorId;
    this.baseUrl = baseUrl ?? process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL;
  }

  /** Raw request, exposed for admin routes the smoke drives (bugs, reset). */
  async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 5000,
  ): Promise<AppResponse> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { [ACTOR_HEADER]: this.actorId };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new AppUnavailableError(url, cause);
    }
    const parsed = await parseBody(response);
    return { status: response.status, ok: response.ok, body: parsed };
  }

  listRecords(params: ListRecordsParams): Promise<AppResponse> {
    return this.request(
      'GET',
      `/api/v1/records${queryString({ type: params.type, q: params.q, limit: params.limit })}`,
    );
  }

  getRecord(type: string, id: string): Promise<AppResponse> {
    return this.request(
      'GET',
      `/api/v1/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    );
  }

  createRecord(type: string, fields: Record<string, unknown>): Promise<AppResponse> {
    return this.request('POST', `/api/v1/records/${encodeURIComponent(type)}`, fields);
  }

  updateRecord(type: string, id: string, fields: Record<string, unknown>): Promise<AppResponse> {
    return this.request(
      'PATCH',
      `/api/v1/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      fields,
    );
  }

  checkPermission(action: string, resource: string): Promise<AppResponse> {
    return this.request('GET', `/api/v1/permissions/check${queryString({ action, resource })}`);
  }

  sendEmail(params: SendEmailParams): Promise<AppResponse> {
    return this.request('POST', '/api/v1/emails', params);
  }
}
