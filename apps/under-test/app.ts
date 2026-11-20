/**
 * The Express app under test: exactly the endpoint catalogue in
 * `src/contracts/app-api.ts`, no more and no less.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * Two deliberate implementation choices worth reading before editing:
 *
 * 1. Records are written with camelCase columns straight out of the contract
 *    (see schema.ts), so `rowToRecord` is a zod parse that also strips the
 *    `createdAt`/`updatedAt` columns the snapshot carries but the API does not.
 * 2. Out-of-scope *single-record* reads answer 404, never 403: a 403 would
 *    confirm the record exists. A wholly unreadable *list* answers 403, because
 *    there is no existence to hide.
 */
import express, { type Express, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ACTOR_HEADER,
  ActivitySchema,
  CompanySchema,
  ContactSchema,
  DealSchema,
  EmailSchema,
  InvoiceSchema,
  LineItemSchema,
  RECORD_TYPES,
  SendEmailArgs,
} from '../../src/contracts/app-api.ts';
import type { RecordType } from '../../src/contracts/app-api.ts';
import type { Role } from '../../src/contracts/types.ts';
import { bugEnabled, looksLikeRecordId, synthesiseRecord } from './bugs.ts';
import {
  findRow,
  findUser,
  insertRow,
  listRows,
  listUsers,
  nextId,
  nextTimestamp,
  openDb,
  resetDatabase,
  restoreDatabase,
  snapshotDatabase,
  updateRow,
  type Row,
} from './db.ts';
import type { Database } from 'better-sqlite3';
import { ACTIONS, can, resolveActor, type Action, type Actor } from './permissions.ts';
import { renderUiPage, type UiPermissionRow, type UiState } from './ui.ts';
import { setBugFlags, getBugFlags } from './bugs.ts';

type RecordSchema = z.ZodType<Record<string, unknown>>;

const SCHEMAS: Record<RecordType, RecordSchema> = {
  company: CompanySchema,
  contact: ContactSchema,
  deal: DealSchema,
  activity: ActivitySchema,
  invoice: InvoiceSchema,
  line_item: LineItemSchema,
};

const TABLE_OF: Record<RecordType, string> = {
  company: 'companies',
  contact: 'contacts',
  deal: 'deals',
  activity: 'activities',
  invoice: 'invoices',
  line_item: 'line_items',
};

const ID_PREFIX: Record<RecordType, string> = {
  company: 'cmp_',
  contact: 'con_',
  deal: 'dls_',
  activity: 'act_',
  invoice: 'inv_',
  line_item: 'dli_',
};

const SEARCHABLE: Record<RecordType, string[]> = {
  company: ['name', 'industry', 'region'],
  contact: ['name', 'email', 'phone', 'role'],
  deal: ['title', 'stage', 'currency'],
  activity: ['type', 'notes'],
  invoice: ['status', 'currency', 'dueOn'],
  line_item: ['product', 'dealId'],
};

/** Demo role ladder used by the demote/promote endpoints. */
const ROLE_LADDER: Role[] = [
  'owner',
  'admin',
  'sales_rep',
  'support_agent',
  'read_only',
  'external',
];

/** Version reported by /health, read from package.json at boot. */
function appVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  return undefined;
}

function queryInt(req: Request, name: string, fallback: number, max: number): number {
  const raw = queryString(req, name);
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ApiError(400, `query '${name}' must be a positive integer`);
  }
  return Math.min(parsed, max);
}

function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (RECORD_TYPES as readonly string[]).includes(value);
}

function parseRecordType(raw: unknown, field: string): RecordType {
  if (!isRecordType(raw)) {
    throw new ApiError(400, `'${field}' must be one of ${RECORD_TYPES.join(', ')}`);
  }
  return raw;
}

/** JSON bodies come back as objects; HTML form posts need scalar coercion. */
function coerceScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return value;
}

function bodyOf(req: Request): Row {
  const raw: unknown = req.body;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const body = raw as Row;
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) return body;
  const coerced: Row = {};
  for (const [key, value] of Object.entries(body)) {
    coerced[key] = coerceScalar(value);
  }
  return coerced;
}

function prefersHtml(req: Request): boolean {
  return (req.headers.accept ?? '').includes('text/html');
}

/** Header first, then the browser cookie/query pair the UI shell uses. */
const ACTOR_COOKIE = 'demo_actor';

function actorIdFrom(req: Request): string | null {
  const header = req.headers[ACTOR_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === 'string' && fromHeader.trim() !== '') {
    return fromHeader.trim();
  }
  if (!prefersHtml(req)) return null;
  const cookie = req.headers.cookie ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACTOR_COOKIE && rest.length > 0) return decodeURIComponent(rest.join('='));
  }
  const fromQuery = queryString(req, 'actor');
  return fromQuery && fromQuery.trim() !== '' ? fromQuery.trim() : null;
}

function rowToRecord(type: RecordType, row: Row): Record<string, unknown> {
  const parsed = SCHEMAS[type].safeParse(row);
  if (!parsed.success) {
    throw new ApiError(500, `stored ${type} row ${String(row.id)} failed contract validation`);
  }
  return parsed.data;
}

function matchesQuery(type: RecordType, row: Row, q: string): boolean {
  const needle = q.toLowerCase();
  if (String(row.id).toLowerCase() === needle) return true;
  for (const field of SEARCHABLE[type]) {
    const value = row[field];
    if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function sequentialIds(firstId: string, count: number): string[] {
  const width = firstId.length - 4;
  const base = Number.parseInt(firstId.slice(4), 10);
  if (!Number.isFinite(base)) return [firstId];
  return Array.from(
    { length: count },
    (_unused, index) => `${firstId.slice(0, 4)}${String(base + index).padStart(width, '0')}`,
  );
}

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

/** Create the app. Passing no database builds a seeded in-memory one. */
export function createApp(db?: Database): Express {
  const database = db ?? openDb(':memory:');
  if (!db) {
    // Library use: hand back a ready-to-serve database, not an empty schema.
    resetDatabase(database);
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  const currentActor = (req: Request): Actor | null => {
    const actorId = actorIdFrom(req);
    return actorId === null ? null : resolveActor(database, actorId);
  };

  const requireActor = (req: Request): Actor => {
    const actor = currentActor(req);
    if (!actor) {
      throw new ApiError(401, `missing or unknown ${ACTOR_HEADER} header`);
    }
    return actor;
  };

  const decide = (actor: Actor, action: Action, resource: string, row?: Row | null) =>
    can({
      db: database,
      role: actor.role,
      action,
      resource,
      actor,
      row,
    });

  // ---- shared search, used by the API and the UI ------------------------
  interface SearchOutcome {
    items: Record<string, unknown>[];
    total: number;
    denied: string | null;
  }

  const searchRecords = (
    actor: Actor,
    type: RecordType | undefined,
    q: string,
    limit: number,
  ): SearchOutcome => {
    const types = type ? [type] : [...RECORD_TYPES];
    const items: Record<string, unknown>[] = [];
    let total = 0;
    for (const candidate of types) {
      const allowed = decide(actor, 'read', candidate);
      if (!allowed.allowed) {
        if (type) return { items: [], total: 0, denied: allowed.reason };
        continue;
      }
      const rows = listRows(database, TABLE_OF[candidate] as never);
      for (const row of rows) {
        if (!decide(actor, 'read', candidate, row).allowed) continue;
        if (q !== '' && !matchesQuery(candidate, row, q)) continue;
        total += 1;
        if (items.length < limit) {
          items.push(rowToRecord(candidate, row));
        }
      }
    }
    return { items, total, denied: null };
  };

  // ---- the UI shell ----------------------------------------------------
  const buildUiState = (
    req: Request,
    overrides: { notice?: string | null; error?: { status: number; message: string } | null } = {},
  ): UiState => {
    const actorId = actorIdFrom(req);
    const actor = actorId === null ? null : resolveActor(database, actorId);
    const type = parseRecordType(queryString(req, 'type') || 'contact', 'type');
    const q = queryString(req, 'q') ?? '';
    const detailParam = queryString(req, 'detail') ?? '';
    const [detailType, detailId] = detailParam.split(':');
    const users = listUsers(database).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
    }));

    const permissions: UiPermissionRow[] = [];
    for (const action of ACTIONS) {
      for (const resource of ['contact', 'deal', 'invoice', 'email']) {
        if (!actor) break;
        const decision = decide(actor, action, resource);
        permissions.push({ action, allowed: decision.allowed, reason: decision.reason });
      }
    }

    let items: Row[] = [];
    let total = 0;
    let detail: UiState['detail'] = null;
    if (actor) {
      const outcome = searchRecords(actor, type, q.trim(), 50);
      items = outcome.items;
      total = outcome.total;
      if (detailType && detailId && isRecordType(detailType)) {
        const row = findRow(database, TABLE_OF[detailType] as never, detailId);
        const visible = row !== null && decide(actor, 'read', detailType, row).allowed;
        detail = {
          type: detailType,
          id: detailId,
          row: visible ? row : null,
          lineItems:
            visible && detailType === 'deal'
              ? listRows(database, 'line_items').filter((item) => item.dealId === detailId)
              : [],
        };
      }
    }

    const canCreateContact = actor !== null && decide(actor, 'create', 'contact').allowed;
    const canAppendLineItems =
      actor !== null &&
      detail !== null &&
      detail.type === 'deal' &&
      detail.row !== null &&
      decide(actor, 'update', 'deal', detail.row).allowed;

    return {
      actor,
      users,
      notice: overrides.notice ?? null,
      error: overrides.error ?? null,
      bugFlags: getBugFlags(database),
      type,
      query: q,
      items,
      total,
      detail,
      permissions,
      canCreateContact,
      canAppendLineItems,
    };
  };

  const htmlResponse = (req: Request, status: number, body: string): void => {
    const response = req.res as Response;
    response.status(status).type('html').send(body);
  };

  const redirectToUi = (req: Request, actorId: string, notice: string): void => {
    const params = new URLSearchParams({
      actor: actorId,
      type: queryString(req, 'type') ?? 'contact',
      notice,
    });
    (req.res as Response).status(303).set('Location', `/ui?${params.toString()}`).end();
  };

  const handleFormError = (res: Response, req: Request, error: ApiError): void => {
    if (!prefersHtml(req)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    htmlResponse(req, error.status, renderUiPage(buildUiState(req, { error: error })));
  };

  // ---- routes ----------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: appVersion(),
      bugFlags: getBugFlags(database),
    });
  });

  app.get('/api/v1/records', (req, res) => {
    const actor = requireActor(req);
    const rawType = queryString(req, 'type');
    const type =
      rawType === undefined || rawType === '' ? undefined : parseRecordType(rawType, 'type');
    const limit = queryInt(req, 'limit', 25, 50);
    const q = (queryString(req, 'q') ?? '').trim();
    const outcome = searchRecords(actor, type, q, limit);
    if (outcome.denied !== null) {
      res.status(403).json({ error: outcome.denied });
      return;
    }
    if (outcome.items.length === 0 && q !== '' && bugEnabled('BUG_HALLUCINATED_FALLBACK')) {
      const synthesised = looksLikeRecordId(q) ? synthesiseRecord(q) : null;
      if (synthesised && (type === undefined || type === synthesised.type)) {
        res.json({ items: [synthesised.fields], total: 1 });
        return;
      }
    }
    res.json({ items: outcome.items, total: outcome.total });
  });

  app.get('/api/v1/records/:type/:id', (req, res) => {
    const actor = requireActor(req);
    const type = parseRecordType(req.params.type, 'type');
    const row = findRow(database, TABLE_OF[type] as never, req.params.id);
    if (row === null || !decide(actor, 'read', type, row).allowed) {
      res.status(404).json({ error: `${type} ${req.params.id} not found` });
      return;
    }
    res.json(rowToRecord(type, row));
  });

  app.post('/api/v1/records/:type', (req, res) => {
    try {
      const actor = requireActor(req);
      const type = parseRecordType(req.params.type, 'type');
      const body = bodyOf(req);
      if ('id' in body || 'createdAt' in body || 'updatedAt' in body) {
        throw new ApiError(400, 'id, createdAt and updatedAt are server-generated');
      }
      const table = TABLE_OF[type] as never;
      const candidate: Row = { ...body };
      if (type === 'deal' && body.ownerId === undefined) candidate.ownerId = actor.id;
      if (type === 'line_item' && body.totalCents === undefined) {
        const qty = typeof body.qty === 'number' ? body.qty : 0;
        const unitCents = typeof body.unitCents === 'number' ? body.unitCents : 0;
        candidate.totalCents = qty * unitCents;
      }
      candidate.id = nextId(database, table, ID_PREFIX[type]);
      const parsed = SCHEMAS[type].safeParse(candidate);
      if (!parsed.success) {
        throw new ApiError(400, zodMessage(parsed.error));
      }
      const decision = decide(actor, 'create', type, candidate);
      if (!decision.allowed) throw new ApiError(403, decision.reason);
      const stamp = nextTimestamp();
      const stored = insertRow(database, table, {
        ...candidate,
        createdAt: stamp,
        updatedAt: stamp,
      });
      if (prefersHtml(req)) {
        redirectToUi(req, actor.id, `Created ${type} ${String(stored.id)}`);
        return;
      }
      res.status(201).json(rowToRecord(type, stored));
    } catch (error) {
      handleFormError(res, req, asApiError(error));
    }
  });

  app.patch('/api/v1/records/:type/:id', (req, res) => {
    const actor = requireActor(req);
    const type = parseRecordType(req.params.type, 'type');
    const table = TABLE_OF[type] as never;
    const row = findRow(database, table, req.params.id);
    if (row === null || !decide(actor, 'read', type, row).allowed) {
      res.status(404).json({ error: `${type} ${req.params.id} not found` });
      return;
    }
    const patch = bodyOf(req);
    if ('id' in patch || 'createdAt' in patch || 'updatedAt' in patch) {
      res.status(400).json({ error: 'id, createdAt and updatedAt cannot be patched' });
      return;
    }
    const schema = SCHEMAS[type];
    if (!(schema instanceof z.ZodObject)) {
      res.status(500).json({ error: `schema for ${type} is not an object` });
      return;
    }
    const validated = schema.partial().safeParse(patch);
    if (!validated.success) {
      res.status(400).json({ error: zodMessage(validated.error) });
      return;
    }
    const decision = decide(actor, 'update', type, row);
    if (!decision.allowed) {
      res.status(403).json({ error: decision.reason });
      return;
    }
    const stored = updateRow(database, table, req.params.id, {
      ...validated.data,
      updatedAt: nextTimestamp(),
    });
    res.json(rowToRecord(type, stored));
  });

  app.get('/api/v1/deals/:id/line-items', (req, res) => {
    const actor = requireActor(req);
    const deal = findRow(database, 'deals', req.params.id);
    if (deal === null || !decide(actor, 'read', 'deal', deal).allowed) {
      res.status(404).json({ error: `deal ${req.params.id} not found` });
      return;
    }
    const items = listRows(database, 'line_items')
      .filter((row) => row.dealId === req.params.id)
      .map((row) => rowToRecord('line_item', row));
    res.json({ items });
  });

  const LineItemsBody = z.object({
    items: z
      .array(
        z.object({
          product: z.string(),
          qty: z.number().int().min(1),
          unitCents: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(50),
  });

  app.post('/api/v1/deals/:id/line-items', (req, res) => {
    try {
      const actor = requireActor(req);
      const deal = findRow(database, 'deals', req.params.id);
      if (deal === null || !decide(actor, 'read', 'deal', deal).allowed) {
        throw new ApiError(404, `deal ${req.params.id} not found`);
      }
      const parsed = LineItemsBody.safeParse(bodyOf(req));
      if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
      const decision = decide(actor, 'update', 'deal', deal);
      if (!decision.allowed) throw new ApiError(403, decision.reason);

      const stamp = nextTimestamp();
      const firstId = nextId(database, 'line_items', 'dli_');
      const ids = sequentialIds(firstId, parsed.data.items.length);
      const appended = parsed.data.items.map((item, index) => ({
        id: ids[index],
        dealId: req.params.id,
        product: item.product,
        qty: item.qty,
        unitCents: item.unitCents,
        totalCents: item.qty * item.unitCents,
        createdAt: stamp,
        updatedAt: stamp,
      }));

      // BUG_PARTIAL_LINE_ITEM_WRITE: a rep appending two or more items has the
      // deal total recomputed from every requested item while only the first
      // row reaches the database. See apps/BUGS.md.
      const partial =
        bugEnabled('BUG_PARTIAL_LINE_ITEM_WRITE') &&
        actor.role === 'sales_rep' &&
        appended.length >= 2;
      const persisted = partial ? appended.slice(0, 1) : appended;
      const requestedTotal =
        (typeof deal.amountCents === 'number' ? deal.amountCents : 0) +
        appended.reduce((sum, item) => sum + item.totalCents, 0);

      const write = database.transaction(() => {
        for (const item of persisted) {
          insertRow(database, 'line_items', item);
        }
        updateRow(database, 'deals', req.params.id, {
          amountCents: requestedTotal,
          updatedAt: stamp,
        });
      });
      write();

      if (prefersHtml(req)) {
        redirectToUi(
          req,
          actor.id,
          `Appended ${String(appended.length)} line item(s) to ${req.params.id}`,
        );
        return;
      }
      res.status(201).json({
        items: appended.map((item) => rowToRecord('line_item', item as Row)),
      });
    } catch (error) {
      handleFormError(res, req, asApiError(error));
    }
  });

  app.get('/api/v1/permissions/check', (req, res) => {
    const actor = requireActor(req);
    const action = queryString(req, 'action');
    const resource = queryString(req, 'resource');
    if (!action || !(ACTIONS as string[]).includes(action)) {
      res.status(400).json({ error: `query 'action' must be one of ${ACTIONS.join(', ')}` });
      return;
    }
    if (!resource || resource.trim() === '') {
      res.status(400).json({ error: "query 'resource' is required" });
      return;
    }
    const decision = decide(actor, action as Action, resource);
    res.json({ allowed: decision.allowed, role: decision.role, reason: decision.reason });
  });

  app.post('/api/v1/emails', (req, res) => {
    try {
      const actor = requireActor(req);
      let data;
      try {
        data = SendEmailArgs.parse(bodyOf(req));
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        return;
      }
      const decision = decide(actor, 'send-email', 'email');
      if (!decision.allowed) {
        res.status(403).json({ error: decision.reason });
        return;
      }
      const stamp = nextTimestamp();
      const stored = insertRow(database, 'outbox', {
        id: nextId(database, 'outbox', 'eml_'),
        to: data.to,
        subject: data.subject,
        body: data.body,
        actorId: actor.id,
        sentAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      });
      res.status(201).json(EmailSchema.parse(stored));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/v1/emails', (req, res) => {
    const actor = requireActor(req);
    const to = queryString(req, 'to');
    const canReadOutbox = decide(actor, 'read', 'email').allowed;
    const rows = listRows(database, 'outbox').filter((row) => {
      if (!canReadOutbox && row.actorId !== actor.id) return false;
      if (to !== undefined && String(row.to).toLowerCase() !== to.toLowerCase()) return false;
      return true;
    });
    res.json({ items: rows.map((row) => EmailSchema.parse(row)) });
  });

  app.post('/api/v1/admin/demote', (req, res) => {
    requireAdminPlus(req);
    const parsed = DemoteBody.safeParse(bodyOf(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const user = findUser(database, parsed.data.userId);
    if (!user) throw new ApiError(404, `user ${parsed.data.userId} not found`);
    const index = ROLE_LADDER.indexOf(user.role as Role);
    if (index === ROLE_LADDER.length - 1) {
      throw new ApiError(400, `user ${parsed.data.userId} is already at the lowest role`);
    }
    const next = ROLE_LADDER[index + 1];
    const stored = updateRow(database, 'users', parsed.data.userId, {
      role: next,
      updatedAt: nextTimestamp(),
    });
    // The role cache keeps the old role authoritative — that is the bug, so it
    // is deliberately NOT cleared here. resetDatabase/restore clear it.
    res.json(UserSchema.parse(stored));
  });

  app.post('/api/v1/admin/promote', (req, res) => {
    requireAdminPlus(req);
    const parsed = DemoteBody.safeParse(bodyOf(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const user = findUser(database, parsed.data.userId);
    if (!user) throw new ApiError(404, `user ${parsed.data.userId} not found`);
    const index = ROLE_LADDER.indexOf(user.role as Role);
    if (index <= 0) {
      throw new ApiError(400, `user ${parsed.data.userId} is already at the highest role`);
    }
    const stored = updateRow(database, 'users', parsed.data.userId, {
      role: ROLE_LADDER[index - 1],
      updatedAt: nextTimestamp(),
    });
    res.json(UserSchema.parse(stored));
  });

  app.get('/api/v1/admin/bugs', (_req, res) => {
    res.json(getBugFlags(database));
  });

  app.post('/api/v1/admin/bugs', (req, res) => {
    const patch = bodyOf(req);
    const flags: Record<string, boolean> = {};
    for (const [flag, value] of Object.entries(patch)) {
      if (typeof value !== 'boolean') {
        throw new ApiError(400, `bug flag '${flag}' must be a boolean`);
      }
      flags[flag] = value;
    }
    res.json(setBugFlags(database, flags));
  });

  app.get('/api/v1/admin/snapshot', (_req, res) => {
    res.json(snapshotDatabase(database));
  });

  app.post('/api/v1/admin/restore', (req, res) => {
    const parsed = SnapshotBody.safeParse(bodyOf(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    restoreDatabase(database, parsed.data);
    res.json({ ok: true });
  });

  app.post('/api/v1/admin/reset', (_req, res) => {
    resetDatabase(database);
    res.json({ ok: true, seeded: true });
  });

  app.get('/ui', (req, res) => {
    const actorId = actorIdFrom(req);
    if (actorId !== null && queryString(req, 'actor') !== undefined) {
      res.set('Set-Cookie', `${ACTOR_COOKIE}=${encodeURIComponent(actorId)}; Path=/; SameSite=Lax`);
    }
    const notice = queryString(req, 'notice');
    res.type('html').send(renderUiPage(buildUiState(req, { notice: notice ?? null })));
  });

  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) {
      next(new ApiError(404, `no route for ${req.method} ${req.path}`));
      return;
    }
    next(new ApiError(404, `no route for ${req.method} ${req.path}`));
  });

  app.use(((error: unknown, req: Request, res: Response, _next: express.NextFunction) => {
    const apiError = asApiError(error);
    if (prefersHtml(req) && apiError.status !== 401) {
      res
        .status(apiError.status)
        .type('html')
        .send(
          renderUiPage(
            buildUiState(req, { error: { status: apiError.status, message: apiError.message } }),
          ),
        );
      return;
    }
    res.status(apiError.status).json({ error: apiError.message });
  }) as express.ErrorRequestHandler);

  return app;

  // ---- closures defined after `return` for readability -----------------

  function asApiError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof Error) {
      return new ApiError(500, error.message);
    }
    return new ApiError(500, 'unexpected server error');
  }

  function zodMessage(error: z.ZodError): string {
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
  }

  function requireAdminPlus(req: Request): Actor {
    const actor = requireActor(req);
    // The admin gate reads the users table directly: it must not be fooled by
    // the same stale-role cache the bug introduces, otherwise a demoted admin
    // could still grant itself rights.
    const fresh = findUser(database, actor.id);
    if (!fresh) throw new ApiError(401, `missing or unknown ${ACTOR_HEADER} header`);
    const role = fresh.role as Role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, `role '${role}' may not administer users`);
    }
    return actor;
  }
}

const UserSchema = z.object({
  id: z.string(),
  persona: z.string(),
  name: z.string(),
  role: z.string(),
  email: z.string(),
  companyId: z.string().nullable(),
  teamId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DemoteBody = z.object({ userId: z.string().min(1) });

const SnapshotBody = z.object({
  tables: z.record(z.string(), z.array(z.record(z.unknown()))),
});
