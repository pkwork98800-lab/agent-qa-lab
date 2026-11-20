import { test as base, expect as baseExpect } from 'playwright/test';

export interface RestResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
  text: () => Promise<string>;
}

export interface RestClient {
  baseUrl: string;
  headers: Record<string, string>;
  get: <T = unknown>(path: string, init?: RequestInit) => Promise<RestResponse<T>>;
  post: <T = unknown>(path: string, init?: RequestInit) => Promise<RestResponse<T>>;
  patch: <T = unknown>(path: string, init?: RequestInit) => Promise<RestResponse<T>>;
  delete: <T = unknown>(path: string, init?: RequestInit) => Promise<RestResponse<T>>;
}

export interface PlaywrightFixtures {
  baseUrl: string;
  api: (actorId: string) => RestClient;
  resetDb: () => Promise<void>;
  checkpoint: {
    snapshot: () => Promise<unknown>;
    restore: (snapshot: unknown) => Promise<void>;
  };
  asUser: (userId: string) => { headers: Record<string, string> };
}

const SEEDED_USER_IDS = ['usr_emma', 'usr_viktor', 'usr_liam', 'usr_sofia', 'usr_raul', 'usr_dana'];

function buildClient(baseUrl: string, actorId: string): RestClient {
  const headers: Record<string, string> = { 'x-actor-id': actorId };
  async function request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const mergedHeaders: Record<string, string> = {};
    Object.assign(mergedHeaders, headers);
    if (init.headers) {
      Object.assign(mergedHeaders, init.headers);
    }
    return fetch(`${baseUrl}${path}`, {
      ...init,
      method,
      headers: mergedHeaders,
    });
  }
  function response<T = unknown>(res: Response): RestResponse<T> {
    return {
      ok: res.ok,
      status: res.status,
      json: async () => (await res.json()) as T,
      text: async () => await res.text(),
    };
  }
  return {
    baseUrl,
    headers,
    get: <T = unknown>(path: string, init?: RequestInit) =>
      request('GET', path, init).then((res) => response<T>(res)),
    post: <T = unknown>(path: string, init?: RequestInit) =>
      request('POST', path, init).then((res) => response<T>(res)),
    patch: <T = unknown>(path: string, init?: RequestInit) =>
      request('PATCH', path, init).then((res) => response<T>(res)),
    delete: <T = unknown>(path: string, init?: RequestInit) =>
      request('DELETE', path, init).then((res) => response<T>(res)),
  };
}

export const test = base.extend<PlaywrightFixtures>({
  baseUrl: ['http://127.0.0.1:4731', { option: true }],

  api: ({ baseUrl }, use) => {
    function api(actorId: string): RestClient {
      if (!SEEDED_USER_IDS.includes(actorId)) {
        throw new Error(`unknown actor id: ${actorId}`);
      }
      return buildClient(baseUrl, actorId);
    }
    return use(api);
  },

  resetDb: async ({ baseUrl }, use) => {
    async function reset(): Promise<void> {
      const res = await fetch(`${baseUrl}/api/v1/admin/reset`, { method: 'POST' });
      if (!res.ok) throw new Error(`reset failed: ${String(res.status)}`);
    }
    await use(reset);
    await reset();
  },

  checkpoint: async ({ baseUrl }, use) => {
    async function snapshot(): Promise<unknown> {
      const res = await fetch(`${baseUrl}/api/v1/admin/snapshot`);
      if (!res.ok) throw new Error(`snapshot failed: ${String(res.status)}`);
      return await res.json();
    }
    async function restore(snapshot: unknown): Promise<void> {
      const res = await fetch(`${baseUrl}/api/v1/admin/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) throw new Error(`restore failed: ${String(res.status)}`);
    }
    await use({ snapshot, restore });
  },

  asUser: (): ((userId: string) => { headers: Record<string, string> }) => {
    return (userId: string) => {
      if (!SEEDED_USER_IDS.includes(userId)) {
        throw new Error(`unknown user id: ${userId}`);
      }
      return { headers: { 'x-actor-id': userId } };
    };
  },
});

export { baseExpect as expect };
