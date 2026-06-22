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
        <section class="panel discovery-panel" aria-labelledby="discovery-title">
          <div class="section-heading">
            <h2 id="discovery-title">Discovery Runs</h2>
          </div>
          <form id="discovery-form" class="discovery-form">
            <label class="wide-field">
              <span>Search location</span>
              <input name="label" required placeholder="Beacon, NY" />
            </label>
            <label>
              <span>Mode</span>
              <select name="mode">
                <option value="place_search">Place search</option>
                <option value="radius_search">Radius search</option>
              </select>
            </label>
            <label class="wide-field">
              <span>Category or search term</span>
              <input name="searchTerm" required placeholder="coffee shop" />
            </label>
            <label>
              <span>Discovery limit</span>
              <input name="discoveryLimit" type="number" min="1" max="60" value="10" required />
            </label>
            <label>
              <span>Latitude</span>
              <input name="latitude" type="number" step="any" placeholder="41.5048" />
            </label>
            <label>
              <span>Longitude</span>
              <input name="longitude" type="number" step="any" placeholder="-73.9696" />
            </label>
            <label>
              <span>Radius metres</span>
              <input name="radiusMeters" type="number" min="1" step="1" placeholder="2500" />
            </label>
            <button type="submit">Start Discovery Run</button>
            <div id="discovery-message" class="form-message" role="status"></div>
          </form>
          <div id="discovery-runs" class="discovery-runs">Loading Discovery Runs...</div>
        </section>
      </main>
      <script>
        const discoveryForm = document.querySelector("#discovery-form");
        const discoveryRuns = document.querySelector("#discovery-runs");
        const discoveryMessage = document.querySelector("#discovery-message");

        function optionalNumber(formData, name) {
          const value = formData.get(name);
          return value === null || value === "" ? undefined : Number(value);
        }

        function clientEscapeHtml(value) {
          return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
          })[char]);
        }

        async function loadDiscoveryRuns() {
          const response = await fetch("/api/discovery-runs");
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "Discovery Runs unavailable");
          }
          discoveryRuns.innerHTML = payload.discoveryRuns.map(renderDiscoveryRun).join("") || "<p class=\\"empty-state\\">No Discovery Runs yet.</p>";
        }

        function renderDiscoveryRun(run) {
          const prospects = run.discoveredProspects.map((prospect) => \`
            <tr>
              <td>\${clientEscapeHtml(prospect.name)}</td>
              <td>\${clientEscapeHtml(prospect.formattedAddress)}</td>
              <td>\${clientEscapeHtml(prospect.websiteUrl || "")}</td>
              <td>\${clientEscapeHtml(prospect.prospectStatus)}</td>
              <td><button class="secondary-button" type="button" data-prospect-id="\${clientEscapeHtml(prospect.id)}">View detail</button></td>
            </tr>
            <tr class="prospect-detail-row" hidden>
              <td colspan="5"></td>
            </tr>
          \`).join("");
          const failures = run.workflowFailures.map((failure) => \`
            <p class="failure">\${clientEscapeHtml(failure.failedStep)}: \${clientEscapeHtml(failure.errorSummary)}</p>
          \`).join("");
          return \`
            <article class="discovery-run">
              <div class="run-header">
                <strong>\${clientEscapeHtml(run.searchTerm)} in \${clientEscapeHtml(run.searchLocation.label)}</strong>
                <span class="run-status \${run.status === "failed" ? "run-status-error" : ""}">\${clientEscapeHtml(run.status)}</span>
              </div>
              <dl class="run-metadata">
                <div><dt>Mode</dt><dd>\${clientEscapeHtml(run.mode)}</dd></div>
                <div><dt>Discovery limit</dt><dd>\${clientEscapeHtml(run.discoveryLimit)}</dd></div>
                <div><dt>Result metadata</dt><dd><code>\${clientEscapeHtml(JSON.stringify(run.resultMetadata))}</code></dd></div>
              </dl>
              <table>
                <thead><tr><th>Prospect Business</th><th>Address</th><th>Website</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>\${prospects || "<tr><td colspan=\\"5\\">No prospects recorded.</td></tr>"}</tbody>
              </table>
              \${failures}
            </article>
          \`;
        }

        function renderProspectDetail(prospectBusiness) {
          const history = prospectBusiness.appearanceHistory.map((appearance) => \`
            <li>
              <strong>\${clientEscapeHtml(appearance.discoveryRun.searchTerm)} in \${clientEscapeHtml(appearance.discoveryRun.searchLocation.label)}</strong>
              <span>Run \${clientEscapeHtml(appearance.discoveryRun.id)} · rank \${clientEscapeHtml(appearance.rank)} · \${clientEscapeHtml(appearance.discoveryRun.mode)}</span>
              <code>\${clientEscapeHtml(JSON.stringify(appearance.providerPayload))}</code>
            </li>
          \`).join("");

          return \`
            <section class="prospect-detail" aria-label="Prospect Business detail">
              <dl class="prospect-summary">
                <div><dt>Google Place ID</dt><dd>\${clientEscapeHtml(prospectBusiness.googlePlaceId)}</dd></div>
                <div><dt>First discovered</dt><dd>\${clientEscapeHtml(prospectBusiness.firstDiscoveredRun.searchTerm)} in \${clientEscapeHtml(prospectBusiness.firstDiscoveredRun.searchLocation.label)}</dd></div>
                <div><dt>Latest discovered</dt><dd>\${clientEscapeHtml(prospectBusiness.latestDiscoveredRun.searchTerm)} in \${clientEscapeHtml(prospectBusiness.latestDiscoveredRun.searchLocation.label)}</dd></div>
              </dl>
              <ol class="appearance-history">\${history}</ol>
            </section>
          \`;
        }

        discoveryForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const submit = discoveryForm.querySelector("button");
          submit.disabled = true;
          discoveryMessage.textContent = "Starting Discovery Run...";
          const formData = new FormData(discoveryForm);
          const body = {
            mode: formData.get("mode"),
            searchTerm: formData.get("searchTerm"),
            discoveryLimit: Number(formData.get("discoveryLimit")),
            searchLocation: {
              label: formData.get("label"),
              latitude: optionalNumber(formData, "latitude"),
              longitude: optionalNumber(formData, "longitude"),
              radiusMeters: optionalNumber(formData, "radiusMeters"),
            },
          };
          try {
            const response = await fetch("/api/discovery-runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Discovery Run failed");
            }
            discoveryMessage.textContent = "Discovery Run recorded.";
            await loadDiscoveryRuns();
          } catch (error) {
            discoveryMessage.textContent = error instanceof Error ? error.message : "Discovery Run failed";
          } finally {
            submit.disabled = false;
          }
        });

        discoveryRuns.addEventListener("click", async (event) => {
          const button = event.target instanceof Element ? event.target.closest("[data-prospect-id]") : null;
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }

          const detailRow = button.closest("tr")?.nextElementSibling;
          const detailCell = detailRow?.querySelector("td");
          if (!(detailRow instanceof HTMLTableRowElement) || !detailCell) {
            return;
          }

          if (!detailRow.hidden && detailCell.innerHTML !== "") {
            detailRow.hidden = true;
            return;
          }

          button.disabled = true;
          detailRow.hidden = false;
          detailCell.innerHTML = "<p class=\\"empty-state\\">Loading Prospect Business detail...</p>";
          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(button.dataset.prospectId || "")}\`);
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Prospect Business detail unavailable");
            }
            detailCell.innerHTML = renderProspectDetail(payload.prospectBusiness);
          } catch (error) {
            detailCell.innerHTML = \`<p class="failure">\${clientEscapeHtml(error instanceof Error ? error.message : "Prospect Business detail unavailable")}</p>\`;
          } finally {
            button.disabled = false;
          }
        });

        loadDiscoveryRuns().catch((error) => {
          discoveryRuns.innerHTML = \`<p class="empty-state">\${clientEscapeHtml(error.message)}</p>\`;
        });
      </script>
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

      select {
        min-height: 44px;
        border: 1px solid #b8c2cf;
        border-radius: 6px;
        background: #ffffff;
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

      button:disabled {
        cursor: progress;
        opacity: 0.72;
      }

      .secondary-button {
        min-height: 32px;
        background: #eef3f7;
        color: #24313f;
        border: 1px solid #c8d1dc;
        padding: 6px 10px;
        white-space: nowrap;
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

      .discovery-panel {
        grid-column: 1 / -1;
      }

      .discovery-form {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        align-items: end;
      }

      .wide-field {
        grid-column: span 2;
      }

      .form-message {
        min-height: 24px;
        color: #5b6470;
        font-weight: 700;
      }

      .discovery-runs {
        display: grid;
        gap: 14px;
        margin-top: 20px;
      }

      .discovery-run {
        border: 1px solid #e0e5eb;
        border-radius: 8px;
        background: #fbfcfd;
        padding: 16px;
      }

      .run-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }

      .run-status {
        border-radius: 999px;
        background: #e6f5ee;
        color: #0f5d48;
        padding: 3px 9px;
        font-size: 0.8rem;
        font-weight: 750;
        text-transform: uppercase;
      }

      .run-status-error,
      .failure {
        color: #9b1c1c;
      }

      .run-metadata {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 0 0 14px;
      }

      .run-metadata div {
        display: grid;
        gap: 4px;
        padding: 0;
        border: 0;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }

      th,
      td {
        border-top: 1px solid #e0e5eb;
        padding: 8px 6px;
        text-align: left;
        vertical-align: top;
      }

      .prospect-detail-row td {
        background: #ffffff;
      }

      .prospect-detail {
        display: grid;
        gap: 12px;
      }

      .prospect-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 0;
      }

      .prospect-summary div {
        display: grid;
        gap: 4px;
      }

      .appearance-history {
        display: grid;
        gap: 8px;
        margin: 0;
        padding-left: 20px;
      }

      .appearance-history li {
        display: grid;
        gap: 4px;
      }

      .appearance-history span {
        color: #5b6470;
      }

      @media (max-width: 840px) {
        .topbar,
        .section-heading,
        .dashboard-grid,
        .config-list div,
        .discovery-form,
        .run-header,
        .run-metadata,
        .prospect-summary {
          display: grid;
          grid-template-columns: 1fr;
        }

        .wide-field {
          grid-column: auto;
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
