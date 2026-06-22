export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Business Website Agent</title>
    <style>
      :root {
        color-scheme: light;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #172026;
        background: #f6f7f4;
      }
      body {
        margin: 0;
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 24px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.15;
      }
      h2 {
        margin: 0 0 14px;
        font-size: 18px;
      }
      section {
        border-top: 1px solid #d9ded6;
        padding-top: 20px;
        margin-top: 22px;
      }
      form {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 12px;
        align-items: end;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 13px;
        color: #3f4a45;
      }
      input,
      select,
      button {
        min-height: 40px;
        border-radius: 6px;
        border: 1px solid #c6cec5;
        background: #fff;
        color: #172026;
        font: inherit;
        padding: 0 10px;
      }
      button {
        border-color: #245b52;
        background: #245b52;
        color: #fff;
        font-weight: 650;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .wide {
        grid-column: span 2;
      }
      .full {
        grid-column: 1 / -1;
      }
      .runs {
        display: grid;
        gap: 14px;
      }
      .run {
        border: 1px solid #d9ded6;
        border-radius: 8px;
        background: #fff;
        padding: 16px;
      }
      .run__header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 10px;
      }
      .status {
        border-radius: 999px;
        padding: 3px 9px;
        background: #e8eee8;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .status.failed {
        background: #f7dfd9;
        color: #872d1b;
      }
      dl {
        display: grid;
        grid-template-columns: 140px 1fr;
        gap: 6px 12px;
        margin: 0 0 12px;
      }
      dt {
        color: #607069;
      }
      dd {
        margin: 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th,
      td {
        text-align: left;
        border-top: 1px solid #e4e8e1;
        padding: 8px 6px;
        vertical-align: top;
      }
      .failure {
        margin-top: 10px;
        color: #872d1b;
      }
      @media (max-width: 760px) {
        header,
        .run__header {
          display: grid;
        }
        form {
          grid-template-columns: 1fr;
        }
        .wide,
        .full {
          grid-column: auto;
        }
        dl {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Discovery Runs</h1>
        </div>
      </header>

      <form id="discovery-form">
        <label class="wide">
          Search location
          <input name="label" required placeholder="Beacon, NY" />
        </label>
        <label>
          Mode
          <select name="mode">
            <option value="place_search">Place search</option>
            <option value="radius_search">Radius search</option>
          </select>
        </label>
        <label class="wide">
          Category or search term
          <input name="searchTerm" required placeholder="coffee shop" />
        </label>
        <label>
          Discovery limit
          <input name="discoveryLimit" type="number" min="1" max="60" value="10" required />
        </label>
        <label>
          Latitude
          <input name="latitude" type="number" step="any" placeholder="41.5048" />
        </label>
        <label>
          Longitude
          <input name="longitude" type="number" step="any" placeholder="-73.9696" />
        </label>
        <label>
          Radius metres
          <input name="radiusMeters" type="number" min="1" step="1" placeholder="2500" />
        </label>
        <button type="submit">Start Discovery Run</button>
        <div class="full" id="form-message" role="status"></div>
      </form>

      <section>
        <h2>Run Details</h2>
        <div class="runs" id="runs"></div>
      </section>
    </main>
    <script>
      const form = document.querySelector("#discovery-form");
      const runs = document.querySelector("#runs");
      const message = document.querySelector("#form-message");

      function optionalNumber(formData, name) {
        const value = formData.get(name);
        return value === null || value === "" ? undefined : Number(value);
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[char]);
      }

      async function loadRuns() {
        const response = await fetch("/api/discovery-runs");
        const payload = await response.json();
        runs.innerHTML = payload.discoveryRuns.map(renderRun).join("") || "No Discovery Runs yet.";
      }

      function renderRun(run) {
        const prospects = run.discoveredProspects.map((prospect) => \`
          <tr>
            <td>\${escapeHtml(prospect.name)}</td>
            <td>\${escapeHtml(prospect.formattedAddress)}</td>
            <td>\${escapeHtml(prospect.websiteUrl || "")}</td>
            <td>\${escapeHtml(prospect.prospectStatus)}</td>
          </tr>
        \`).join("");
        const failures = run.workflowFailures.map((failure) => \`
          <div class="failure">\${escapeHtml(failure.failedStep)}: \${escapeHtml(failure.errorSummary)}</div>
        \`).join("");
        return \`
          <article class="run">
            <div class="run__header">
              <strong>\${escapeHtml(run.searchTerm)} in \${escapeHtml(run.searchLocation.label)}</strong>
              <span class="status \${run.status === "failed" ? "failed" : ""}">\${escapeHtml(run.status)}</span>
            </div>
            <dl>
              <dt>Mode</dt><dd>\${escapeHtml(run.mode)}</dd>
              <dt>Discovery Limit</dt><dd>\${escapeHtml(run.discoveryLimit)}</dd>
              <dt>Query Metadata</dt><dd><code>\${escapeHtml(JSON.stringify(run.queryMetadata))}</code></dd>
              <dt>Result Metadata</dt><dd><code>\${escapeHtml(JSON.stringify(run.resultMetadata))}</code></dd>
            </dl>
            <table>
              <thead><tr><th>Prospect Business</th><th>Address</th><th>Website</th><th>Prospect Status</th></tr></thead>
              <tbody>\${prospects}</tbody>
            </table>
            \${failures}
          </article>
        \`;
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector("button");
        submit.disabled = true;
        message.textContent = "Starting Discovery Run...";
        const formData = new FormData(form);
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
          message.textContent = "Discovery Run recorded.";
          await loadRuns();
        } catch (error) {
          message.textContent = error.message;
        } finally {
          submit.disabled = false;
        }
      });

      loadRuns().catch((error) => {
        runs.textContent = error.message;
      });
    </script>
  </body>
</html>`;
}
