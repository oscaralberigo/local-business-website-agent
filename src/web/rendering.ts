import type { AuditEvent, ConnectivityStatus } from "../audit/auditTrail.js";
import type { ConfigReadoutItem } from "../config/runtimeConfiguration.js";

export function renderLoginPage(error?: string): string {
  return renderPage({
    title: "Review Dashboard Login",
    body: `
      <main class="login-shell">
        <section class="login-panel" aria-labelledby="login-title">
          <h1 id="login-title">Review Dashboard</h1>
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
          <form method="post" action="/login" class="login-form">
            <label>
              <span>Operator username</span>
              <input name="username" autocomplete="username" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <button type="submit">Log in</button>
          </form>
        </section>
      </main>
    `
  });
}

export function renderDashboardPage(input: {
  auditEvents: AuditEvent[];
  configReadout: ConfigReadoutItem[];
  database: ConnectivityStatus;
}): string {
  return renderPage({
    title: "Review Dashboard",
    body: `
      <header class="topbar">
        <div>
          <p class="eyebrow">Single-operator app</p>
          <h1>Review Dashboard</h1>
        </div>
        <span class="${input.database.connected ? "status status-ok" : "status status-error"}">
          Postgres connection: ${input.database.connected ? "Connected" : "Unavailable"}
        </span>
      </header>
      <main class="dashboard-grid">
        <section class="panel" aria-labelledby="settings-title">
          <div class="section-heading">
            <h2 id="settings-title">Settings / Config Readout</h2>
          </div>
          <dl class="config-list">
            ${input.configReadout
              .map(
                (item) => `
                  <div>
                    <dt>${escapeHtml(item.label)}</dt>
                    <dd>${escapeHtml(item.value)}</dd>
                  </div>
                `
              )
              .join("")}
          </dl>
        </section>
        <section class="panel" aria-labelledby="audit-title">
          <div class="section-heading audit-heading">
            <h2 id="audit-title">Audit Trail</h2>
            <form method="post" action="/audit-trail/baseline">
              <button type="submit">Record baseline event</button>
            </form>
          </div>
          ${
            input.auditEvents.length > 0
              ? `<ol class="audit-list">${input.auditEvents.map(renderAuditEvent).join("")}</ol>`
              : `<p class="empty-state">No audit events recorded yet.</p>`
          }
        </section>
      </main>
    `
  });
}

function renderAuditEvent(event: AuditEvent): string {
  return `
    <li>
      <time datetime="${escapeHtml(event.occurredAt.toISOString())}">${escapeHtml(
        event.occurredAt.toLocaleString("en-US", { timeZone: "UTC" })
      )} UTC</time>
      <strong>${escapeHtml(event.eventType)}</strong>
      <span>${escapeHtml(event.summary)}</span>
      <small>Actor: ${escapeHtml(event.actor)}</small>
    </li>
  `;
}

function renderPage(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #1e242c;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
      }

      button,
      input {
        font: inherit;
      }

      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .login-panel,
      .panel {
        background: #ffffff;
        border: 1px solid #d7dde5;
        border-radius: 8px;
        box-shadow: 0 18px 50px rgba(23, 34, 45, 0.08);
      }

      .login-panel {
        width: min(100%, 420px);
        padding: 28px;
      }

      h1,
      h2,
      p {
        margin-top: 0;
      }

      h1 {
        font-size: 2rem;
        line-height: 1.1;
        margin-bottom: 8px;
      }

      h2 {
        font-size: 1.1rem;
        margin-bottom: 0;
      }

      .login-form {
        display: grid;
        gap: 16px;
        margin-top: 24px;
      }

      label {
        display: grid;
        gap: 8px;
        font-weight: 650;
      }

      input {
        width: 100%;
        min-height: 44px;
        border: 1px solid #b8c2cf;
        border-radius: 6px;
        padding: 10px 12px;
      }

      button {
        min-height: 40px;
        border: 0;
        border-radius: 6px;
        background: #176b5b;
        color: #ffffff;
        font-weight: 750;
        padding: 10px 14px;
        cursor: pointer;
      }

      .error {
        margin: 16px 0 0;
        color: #9b1c1c;
        font-weight: 700;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 24px;
        padding: 24px;
        border-bottom: 1px solid #d7dde5;
        background: #ffffff;
      }

      .eyebrow {
        margin-bottom: 4px;
        color: #5b6470;
        font-size: 0.8rem;
        font-weight: 750;
        text-transform: uppercase;
      }

      .status {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        border-radius: 999px;
        padding: 6px 12px;
        font-weight: 750;
        white-space: nowrap;
      }

      .status-ok {
        background: #e6f5ee;
        color: #0f5d48;
      }

      .status-error {
        background: #fdecec;
        color: #9b1c1c;
      }

      .dashboard-grid {
        display: grid;
        grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.1fr);
        gap: 20px;
        padding: 24px;
      }

      .panel {
        padding: 20px;
      }

      .section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
      }

      .audit-heading {
        align-items: flex-start;
      }

      .config-list {
        display: grid;
        gap: 0;
        margin: 0;
      }

      .config-list div {
        display: grid;
        grid-template-columns: minmax(160px, 0.75fr) minmax(180px, 1fr);
        gap: 12px;
        padding: 12px 0;
        border-top: 1px solid #e7ebf0;
      }

      dt {
        color: #5b6470;
        font-weight: 700;
      }

      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .audit-list {
        display: grid;
        gap: 12px;
        margin: 0;
        padding-left: 20px;
      }

      .audit-list li {
        padding: 12px;
        border: 1px solid #e0e5eb;
        border-radius: 8px;
        background: #fbfcfd;
      }

      .audit-list time,
      .audit-list small,
      .audit-list span,
      .audit-list strong {
        display: block;
      }

      .audit-list time,
      .audit-list small {
        color: #5b6470;
        font-size: 0.85rem;
      }

      .empty-state {
        color: #5b6470;
      }

      @media (max-width: 840px) {
        .topbar,
        .section-heading,
        .dashboard-grid,
        .config-list div {
          display: grid;
          grid-template-columns: 1fr;
        }

        .dashboard-grid {
          padding: 16px;
        }

        .topbar {
          padding: 16px;
        }

        .status {
          justify-content: center;
          white-space: normal;
        }
      }
    </style>
  </head>
  <body>${input.body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
