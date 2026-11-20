/**
 * Server-rendered HTML for `GET /ui`.
 * ---------------------------------------------------------------------------
 * Owned by agent 2a (apps/under-test/**).
 *
 * Plain template strings, no build step, no framework, no client-side
 * JavaScript: every interaction is a form post or a link, which is exactly what
 * a browser-based manual pass and Playwright need. Rendering is permission
 * aware — a read_only actor never sees the create form, and a denied write
 * shows the server's own 403 message rather than a generic error.
 */
import type { Action, Actor } from './permissions.ts';
import type { Row } from './db.ts';

export interface UiPermissionRow {
  action: Action;
  allowed: boolean;
  reason: string;
}

export interface UiState {
  actor: Actor | null;
  users: { id: string; name: string; role: string }[];
  notice: string | null;
  error: { status: number; message: string } | null;
  bugFlags: Record<string, boolean>;
  type: string;
  query: string;
  items: Row[];
  total: number;
  detail: { type: string; id: string; row: Row | null; lineItems: Row[] } | null;
  permissions: UiPermissionRow[];
  canCreateContact: boolean;
  canAppendLineItems: boolean;
}

// Built by concatenation: this file is written through a code tool that decodes
// HTML entity text, and a literal entity here would silently become the bare
// character and stop escaping anything.
const ESCAPES: Record<string, string> = {
  '&': '&' + 'amp;',
  '<': '&' + 'lt;',
  '>': '&' + 'gt;',
  '"': '&' + 'quot;',
  "'": '&' + '#39;',
};

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function money(cents: unknown): string {
  const value = typeof cents === 'number' ? cents : 0;
  return (value / 100).toFixed(2);
}

/** Column shown as the record's headline in lists and detail panels. */
function labelOf(type: string, row: Row): string {
  if (type === 'company') return String(row.name);
  if (type === 'contact') return String(row.name);
  if (type === 'deal') return String(row.title);
  if (type === 'activity') return String(row.notes).slice(0, 60);
  if (type === 'invoice') return `${String(row.id)} (${String(row.status)})`;
  if (type === 'line_item') return String(row.product);
  return String(row.id);
}

function renderFields(type: string, row: Row): string {
  const entries = Object.entries(row).filter(([key]) => key !== 'synthesised');
  const body = entries
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(
          key === 'amountCents' || key === 'totalCents' || key === 'unitCents'
            ? money(value)
            : value,
        )}</td></tr>`,
    )
    .join('');
  return `<table class="fields"><caption>${escapeHtml(type)} ${escapeHtml(row.id)}</caption><tbody>${body}</tbody></table>`;
}

function renderRowLink(actor: string, type: string, row: Row): string {
  return `<a href="/ui?actor=${escapeHtml(actor)}&type=${escapeHtml(type)}&detail=${escapeHtml(
    type,
  )}:${escapeHtml(String(row.id))}">${escapeHtml(labelOf(type, row))}</a>`;
}

function renderList(state: UiState): string {
  if (state.items.length === 0) {
    return `<p class="empty">No ${escapeHtml(state.type)} records match that search.</p>`;
  }
  const rows = state.items
    .map((row) => {
      const cells = [String(row.id), labelOf(state.type, row)]
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join('');
      return `<tr><td>${renderRowLink(String(state.actor?.id), state.type, row)}</td>${cells}</tr>`;
    })
    .join('');
  return `<table class="records"><thead><tr><th scope="col">Record</th><th scope="col">Id</th><th scope="col">Summary</th></tr></thead><tbody>${rows}</tbody></table>
<p class="count">${String(state.items.length)} shown of ${String(state.total)} matching rows.</p>`;
}

function renderDetail(state: UiState): string {
  const detail = state.detail;
  if (!detail) return '';
  if (!detail.row) {
    return `<section class="panel"><h2>Record</h2><p class="empty">No ${escapeHtml(
      detail.type,
    )} record with id ${escapeHtml(detail.id)} is visible to this actor.</p></section>`;
  }
  const parts: string[] = [renderFields(detail.type, detail.row)];

  if (detail.type === 'deal') {
    const dealTotal = typeof detail.row.amountCents === 'number' ? detail.row.amountCents : 0;
    const lineTotal = detail.lineItems.reduce(
      (acc, item) => acc + (typeof item.totalCents === 'number' ? item.totalCents : 0),
      0,
    );
    const consistent = dealTotal === lineTotal;
    const items = detail.lineItems
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.product)}</td><td>${escapeHtml(
            item.qty,
          )}</td><td>${money(item.unitCents)}</td><td>${money(item.totalCents)}</td></tr>`,
      )
      .join('');
    parts.push(
      `<table class="records"><caption>Line items</caption><thead><tr><th scope="col">Id</th><th scope="col">Product</th><th scope="col">Qty</th><th scope="col">Unit</th><th scope="col">Total</th></tr></thead><tbody>${items}</tbody></table>`,
    );
    parts.push(
      consistent
        ? `<p class="ok">Deal total ${money(dealTotal)} matches the ${String(detail.lineItems.length)} line items.</p>`
        : `<p class="warn">Deal total ${money(dealTotal)} does not match the line items (${money(
            lineTotal,
          )}).</p>`,
    );
  }

  if (state.canAppendLineItems && detail.type === 'deal') {
    const inputs = ['product', 'qty', 'unitCents']
      .map(
        (field) =>
          `<p><label for="li-${field}">${escapeHtml(field)}</label><input id="li-${field}" name="${escapeHtml(
            field,
          )}" required></p>`,
      )
      .join('');
    parts.push(
      `<form class="stack" method="post" action="/api/v1/deals/${escapeHtml(
        detail.id,
      )}/line-items"><h3>Append a line item</h3>${inputs}<button type="submit">Append</button></form>`,
    );
  }

  return `<section class="panel"><h2>Record</h2>${parts.join('')}</section>`;
}

function renderCreateForm(state: UiState): string {
  if (!state.canCreateContact) {
    return `<section class="panel"><h2>New contact</h2><p class="empty">This actor may not create contacts.</p></section>`;
  }
  const fields = ['name', 'companyId', 'email', 'phone', 'role']
    .map(
      (field) =>
        `<p><label for="new-${field}">${escapeHtml(field)}</label><input id="new-${field}" name="${escapeHtml(
          field,
        )}" required></p>`,
    )
    .join('');
  return `<section class="panel"><h2>New contact</h2><form class="stack" method="post" action="/api/v1/records/contact">${fields}<button type="submit">Create contact</button></form></section>`;
}

function renderPermissions(state: UiState): string {
  if (state.permissions.length === 0) return '';
  const rows = state.permissions
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.action)}</td><td>${
          entry.allowed ? '<span class="yes">allowed</span>' : '<span class="no">denied</span>'
        }</td><td>${escapeHtml(entry.reason)}</td></tr>`,
    )
    .join('');
  return `<section class="panel"><h2>What this actor may do</h2><table class="records"><thead><tr><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Server reason</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function renderUiPage(state: UiState): string {
  const actorId = state.actor?.id ?? '';
  const actorName = state.actor ? `${state.actor.id} (${state.actor.role})` : 'none selected';
  const flags = Object.entries(state.bugFlags)
    .map(
      ([flag, on]) =>
        `<code class="${on ? 'flag on' : 'flag off'}">${escapeHtml(flag)}=${on ? '1' : '0'}</code>`,
    )
    .join(' ');
  const switcher = state.users
    .map(
      (user) =>
        `<option value="${escapeHtml(user.id)}"${
          user.id === actorId ? ' selected' : ''
        }>${escapeHtml(user.name)} — ${escapeHtml(user.role)}</option>`,
    )
    .join('');
  const banner = state.error
    ? `<p class="banner error">${escapeHtml(state.error.status)} ${escapeHtml(state.error.message)}</p>`
    : state.notice
      ? `<p class="banner ok">${escapeHtml(state.notice)}</p>`
      : '';

  const body = state.actor
    ? `${renderPermissions(state)}
${renderList(state)}
${renderDetail(state)}
${renderCreateForm(state)}`
    : `<p class="empty">Pick a demo actor above to load the mini-CRM.</p>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mini-CRM — app under test</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #f4f5f7; color: #1c1f24; }
header { background: #1c2b3a; color: #fff; padding: 1rem 1.5rem; }
header h1 { font-size: 1.1rem; margin: 0 0 .35rem; }
header p { margin: .15rem 0; font-size: .85rem; }
main { padding: 1.5rem; max-width: 60rem; margin: 0 auto; }
.panel { background: #fff; border: 1px solid #d7dbe0; border-radius: .4rem; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
.panel h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 .75rem; color: #46536b; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
caption { text-align: left; font-weight: 600; padding-bottom: .4rem; }
th, td { border-bottom: 1px solid #e6e9ed; padding: .35rem .5rem; text-align: left; vertical-align: top; }
.fields th { width: 12rem; color: #46536b; font-weight: 500; }
label { display: block; font-size: .8rem; color: #46536b; margin-bottom: .15rem; }
input, select, button { font: inherit; padding: .3rem .45rem; border: 1px solid #b9c0c9; border-radius: .25rem; }
button { background: #1c2b3a; color: #fff; border-color: #1c2b3a; cursor: pointer; }
.stack p { margin: 0 0 .6rem; }
.banner { padding: .6rem .8rem; border-radius: .3rem; font-size: .9rem; }
.banner.ok { background: #e4f5e9; border: 1px solid #9fd3ae; }
.banner.error { background: #fdeaea; border: 1px solid #e2a3a3; }
.ok { color: #1d6b3a; }
.warn { color: #8a5300; }
.empty { color: #6b7684; font-style: italic; }
.count { font-size: .8rem; color: #6b7684; }
.flag { font-size: .75rem; padding: .1rem .3rem; border-radius: .2rem; }
.flag.on { background: #fdeaea; color: #8a1c1c; }
.flag.off { background: #e4f5e9; color: #1d6b3a; }
.yes { color: #1d6b3a; font-weight: 600; }
.no { color: #8a1c1c; font-weight: 600; }
</style>
</head>
<body>
<header>
<h1>Mini-CRM — app under test</h1>
<p>Express + SQLite demo data, permission-aware server-rendered UI. <a href="/health">/health</a> JSON.</p>
<p>Demo actor: ${escapeHtml(actorName)} · latent bug flags: ${flags}</p>
<form method="get" action="/ui">
<label for="actor">Demo actor</label>
<select id="actor" name="actor">${switcher}</select>
<button type="submit">Switch actor</button>
</form>
</header>
<main>
${banner}
${body}
</main>
</body>
</html>`;
}
