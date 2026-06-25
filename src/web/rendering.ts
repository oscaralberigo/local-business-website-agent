import type { AuditEvent, ConnectivityStatus } from "../audit/auditTrail.js";
import type { ConfigReadoutItem, ReviewPolicy } from "../config/runtimeConfiguration.js";

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
  reviewPolicy: ReviewPolicy;
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
          <form id="review-policy-form" class="review-policy-form">
            <h3 id="review-policy-title">Review Policy</h3>
            <label class="toggle-row" for="require-review-before-preview-publication">
              <input
                id="require-review-before-preview-publication"
                name="require-review-before-preview-publication"
                type="checkbox"
                ${input.reviewPolicy.requireReviewBeforePreviewPublication ? "checked" : ""}
              />
              <span>Require review before preview publication</span>
            </label>
            <label class="toggle-row" for="require-review-before-outreach-sending">
              <input
                id="require-review-before-outreach-sending"
                name="require-review-before-outreach-sending"
                type="checkbox"
                ${input.reviewPolicy.requireReviewBeforeOutreachSending ? "checked" : ""}
              />
              <span>Require review before outreach sending</span>
            </label>
            <button type="submit">Save Review Policy</button>
            <div id="review-policy-message" class="form-message" role="status"></div>
          </form>
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
        const reviewPolicyForm = document.querySelector("#review-policy-form");
        const reviewPolicyMessage = document.querySelector("#review-policy-message");
        const reviewPolicy = {
          requireReviewBeforePreviewPublication: ${JSON.stringify(input.reviewPolicy.requireReviewBeforePreviewPublication)},
          requireReviewBeforeOutreachSending: ${JSON.stringify(input.reviewPolicy.requireReviewBeforeOutreachSending)},
        };

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
            <form class="failure workflow-retry-form" method="post" action="/api/workflow-failures/\${clientEscapeHtml(failure.id)}/retry">
              <span>\${clientEscapeHtml(failure.failedStep)}: \${clientEscapeHtml(failure.errorSummary)}</span>
              \${failure.retryable ? '<button class="secondary-button" type="submit">Retry</button>' : ""}
            </form>
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
          const workflowFailures = prospectBusiness.workflowFailures ?? [];
          const workflowFailureMarkup = workflowFailures.length > 0 ? \`
            <section class="workflow-failures" aria-label="Workflow Failures">
              <div class="detail-section-heading">
                <h3>Workflow Failures</h3>
              </div>
              <ul class="evidence-list">
                \${workflowFailures.map((failure) => \`
                  <li class="failure">
                    <form class="workflow-retry-form" method="post" action="/api/workflow-failures/\${clientEscapeHtml(failure.id)}/retry">
                      <span>\${clientEscapeHtml(failure.failedStep)}: \${clientEscapeHtml(failure.errorSummary)}\${failure.retryable ? " (retryable)" : ""}</span>
                      \${failure.retryable ? '<button class="secondary-button" type="submit">Retry</button>' : ""}
                    </form>
                  </li>
                \`).join("")}
              </ul>
            </section>
          \` : "";
          const assessment = prospectBusiness.websiteAssessment;
          const assessmentMarkup = assessment ? \`
            <section class="website-assessment" aria-label="Website Assessment">
              <div class="detail-section-heading">
                <h3>Website Assessment</h3>
                <span class="run-status">\${clientEscapeHtml(assessment.opportunityCategory)}</span>
              </div>
              <p>\${clientEscapeHtml(assessment.summary)}</p>
              <dl class="prospect-summary">
                <div><dt>Confidence</dt><dd>\${clientEscapeHtml(assessment.confidence)}</dd></div>
                <div><dt>Preview Eligibility</dt><dd>\${assessment.previewEligibility.effectiveEligible ? "Eligible" : "Not eligible"}</dd></div>
                <div><dt>Operator review</dt><dd>\${assessment.previewEligibility.requiresOperatorReview ? "Required" : "Not required"}</dd></div>
                <div><dt>Eligibility reason</dt><dd>\${clientEscapeHtml(assessment.previewEligibility.reason)}</dd></div>
                \${assessment.previewEligibility.override ? \`
                  <div><dt>Operator override</dt><dd>\${clientEscapeHtml(assessment.previewEligibility.override.reason)} by \${clientEscapeHtml(assessment.previewEligibility.override.actor)}</dd></div>
                \` : ""}
              </dl>
              <h4>Evidence</h4>
              <ul class="evidence-list">
                \${assessment.evidence.map((item) => \`
                  <li><strong>\${clientEscapeHtml(item.source)}</strong><span>\${clientEscapeHtml(item.claim)}</span></li>
                \`).join("")}
              </ul>
              <h4>Website Exploration Evidence</h4>
              \${assessment.websiteExplorationEvidence && assessment.websiteExplorationEvidence.length > 0
                ? \`<ul class="evidence-list">\${assessment.websiteExplorationEvidence.map((item) => \`
                  <li>
                    <strong>Landing page</strong>
                    <span>Page URL: \${clientEscapeHtml(item.pageUrl)}</span>
                    <span>HTML artifact: \${clientEscapeHtml(item.htmlArtifactUri)}</span>
                    <span>Desktop screenshot: \${clientEscapeHtml(item.desktopScreenshot.uri)}</span>
                    <span>Mobile screenshot: \${clientEscapeHtml(item.mobileScreenshot.uri)}</span>
                    <span>Excerpt: \${clientEscapeHtml(item.reviewerReadyTextExcerpt)}</span>
                    \${item.browserObservations.length > 0
                      ? \`<span>Browser observations: \${clientEscapeHtml(item.browserObservations.join(" "))}</span>\`
                      : ""
                    }
                  </li>
                \`).join("")}</ul>\`
                : \`<p class="empty-state">No Website Exploration Evidence recorded.</p>\`
              }
              <h4>Safe claims</h4>
              \${assessment.safeClaims.length > 0
                ? \`<ul class="evidence-list">\${assessment.safeClaims.map((claim) => \`<li>\${clientEscapeHtml(claim)}</li>\`).join("")}</ul>\`
                : \`<p class="empty-state">No outreach-safe claims recorded.</p>\`
              }
            </section>
          \` : \`
            <section class="website-assessment" aria-label="Website Assessment">
              <div class="detail-section-heading">
                <h3>Website Assessment</h3>
              </div>
              <p class="empty-state">No Website Assessment recorded yet.</p>
            </section>
          \`;
          const preview = prospectBusiness.previewWebsite;
          const previewMarkup = preview ? \`
            <section class="preview-website" aria-label="Preview Website">
              <div class="detail-section-heading">
                <h3>Preview Website</h3>
                <span class="run-status">\${clientEscapeHtml(preview.status)}</span>
              </div>
              <iframe
                class="preview-frame"
                title="Preview Website for \${clientEscapeHtml(prospectBusiness.name)}"
                src="/preview-artifacts/\${clientEscapeHtml(preview.slug)}/\${clientEscapeHtml(String(preview.artifact.indexFile || "dist/index.html"))}">
              </iframe>
              <dl class="prospect-summary">
                <div><dt>Slug</dt><dd>\${clientEscapeHtml(preview.slug)}</dd></div>
                <div><dt>Primary goal</dt><dd>\${clientEscapeHtml(preview.designPlan.primaryGoal)}</dd></div>
                <div><dt>Build status</dt><dd>\${clientEscapeHtml(preview.buildMetadata.status)}</dd></div>
                \${preview.publication ? \`
                  <div><dt>Preview URL</dt><dd><a href="\${clientEscapeHtml(preview.publication.previewUrl)}" rel="nofollow noopener" target="_blank">\${clientEscapeHtml(preview.publication.previewUrl)}</a></dd></div>
                \` : ""}
              </dl>
              <h4>Source references</h4>
              \${preview.sourceReferences.length > 0
                ? \`<ul class="evidence-list">\${preview.sourceReferences.map((reference) => \`
                    <li><strong>\${clientEscapeHtml(reference.sourceId)} / \${clientEscapeHtml(reference.factId)}</strong><span>\${clientEscapeHtml(reference.statement)}</span></li>
                  \`).join("")}</ul>\`
                : \`<p class="empty-state">No source references recorded.</p>\`
              }
              <form class="operator-edit-form" data-preview-edit-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                <h4>Operator Edits</h4>
                \${preview.operatorEditableFields.map((field) => \`
                  <label>
                    <span>\${clientEscapeHtml(field.label)}</span>
                    <input name="\${clientEscapeHtml(field.path)}" value="\${clientEscapeHtml(field.value)}" />
                  </label>
                \`).join("")}
                <button type="submit">Save Preview Edits</button>
                <div class="form-message" role="status"></div>
              </form>
              \${preview.status === "published" && preview.publication ? \`
                <form class="preview-publication-form" data-preview-unpublication-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                  <button type="submit">Unpublish Preview</button>
                  <div class="form-message" role="status"></div>
                </form>
              \` : \`
                <form class="preview-publication-form" data-preview-publication-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                  <label>
                    <span>Preview Approval reason</span>
                    <textarea name="approvalReason"\${reviewPolicy.requireReviewBeforePreviewPublication ? " required" : ""}></textarea>
                  </label>
                  <button type="submit">Publish Preview</button>
                  <div class="form-message" role="status"></div>
                </form>
              \`}
            </section>
          \` : \`
            <section class="preview-website" aria-label="Preview Website">
              <div class="detail-section-heading">
                <h3>Preview Website</h3>
              </div>
              <p class="empty-state">No Preview Website generated yet.</p>
            </section>
          \`;
          const draftOutreach = prospectBusiness.draftOutreach;
          const outreachEmails = prospectBusiness.outreachEmails ?? [];
          const outreachEmailMarkup = outreachEmails.length > 0
            ? \`<ul class="evidence-list">\${outreachEmails.map((email) => \`
                <li>
                  \${clientEscapeHtml(email.sendStatus)} via \${clientEscapeHtml(email.provider)}
                  \${email.providerMessageId ? \` (\${clientEscapeHtml(email.providerMessageId)})\` : ""}
                  to \${clientEscapeHtml(email.recipientEmailAddress)}
                </li>
              \`).join("")}</ul>\`
            : \`<p class="empty-state">No Outreach Email sends recorded.</p>\`;
          const draftOutreachMarkup = draftOutreach ? \`
            <section class="draft-outreach" aria-label="Draft Outreach">
              <div class="detail-section-heading">
                <h3>Draft Outreach</h3>
                <span class="run-status">\${draftOutreach.requiresOperatorReview ? "Operator review required" : "Ready"}</span>
              </div>
              <dl class="prospect-summary">
                <div><dt>Subject</dt><dd>\${clientEscapeHtml(draftOutreach.subject)}</dd></div>
                <div><dt>Claims used</dt><dd>\${clientEscapeHtml(draftOutreach.claimsUsed.map((claim) => claim.claim).join("; "))}</dd></div>
              </dl>
              <h4>Compliance notes</h4>
              \${draftOutreach.complianceNotes.length > 0
                ? \`<ul class="evidence-list">\${draftOutreach.complianceNotes.map((note) => \`<li>\${clientEscapeHtml(note)}</li>\`).join("")}</ul>\`
                : \`<p class="empty-state">No compliance notes recorded.</p>\`
              }
              <form class="operator-edit-form" data-outreach-edit-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                <h4>Operator Edits</h4>
                <label>
                  <span>Subject</span>
                  <input name="subject" value="\${clientEscapeHtml(draftOutreach.subject)}" />
                </label>
                <label>
                  <span>Text body</span>
                  <textarea name="bodyText">\${clientEscapeHtml(draftOutreach.bodyText)}</textarea>
                </label>
                <label>
                  <span>HTML body</span>
                  <textarea name="bodyHtml">\${clientEscapeHtml(draftOutreach.bodyHtml)}</textarea>
                </label>
                <button type="submit">Save Outreach Edits</button>
                <div class="form-message" role="status"></div>
              </form>
              <form class="outreach-send-form" data-outreach-send-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                <h4>Send Outreach</h4>
                <label>
                  <span>From email</span>
                  <input name="fromEmail" required />
                </label>
                <label>
                  <span>Sender identity</span>
                  <input name="senderIdentity" required />
                </label>
                <label>
                  <span>Postal address</span>
                  <input name="postalAddress" required />
                </label>
                <label>
                  <span>Opt-out wording</span>
                  <textarea name="optOutWording" required></textarea>
                </label>
                <label>
                  <span>Outreach Approval reason</span>
                  <textarea name="approvalReason"\${reviewPolicy.requireReviewBeforeOutreachSending ? " required" : ""}></textarea>
                </label>
                <button type="submit">Send Outreach</button>
                <div class="form-message" role="status"></div>
              </form>
              <h4>Send history</h4>
              \${outreachEmailMarkup}
            </section>
          \` : \`
            <section class="draft-outreach" aria-label="Draft Outreach">
              <div class="detail-section-heading">
                <h3>Draft Outreach</h3>
              </div>
              <p class="empty-state">No Draft Outreach prepared yet.</p>
            </section>
          \`;
          const replyTracking = prospectBusiness.replyTracking;
          const replyTrackingMarkup = \`
            <section class="reply-tracking" aria-label="Reply Tracking">
              <div class="detail-section-heading">
                <h3>Reply Tracking</h3>
                \${replyTracking ? \`<span class="run-status">replied</span>\` : ""}
              </div>
              <dl class="prospect-summary">
                <div><dt>Reply timestamp</dt><dd>\${clientEscapeHtml(replyTracking?.repliedAt || "")}</dd></div>
                <div><dt>Reply summary</dt><dd>\${clientEscapeHtml(replyTracking?.summary || "")}</dd></div>
                <div><dt>Reply notes</dt><dd>\${clientEscapeHtml(replyTracking?.notes || "")}</dd></div>
              </dl>
              <form class="operator-edit-form" data-reply-tracking-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                <label>
                  <span>Reply timestamp</span>
                  <input name="repliedAt" type="datetime-local" required />
                </label>
                <label>
                  <span>Reply summary</span>
                  <input name="summary" value="\${clientEscapeHtml(replyTracking?.summary || "")}" required />
                </label>
                <label>
                  <span>Reply notes</span>
                  <textarea name="notes">\${clientEscapeHtml(replyTracking?.notes || "")}</textarea>
                </label>
                <button type="submit">Record Reply</button>
                <div class="form-message" role="status"></div>
              </form>
            </section>
          \`;
          const workConversion = prospectBusiness.workConversion;
          const workConversionMarkup = \`
            <section class="work-conversion" aria-label="Work Conversion">
              <div class="detail-section-heading">
                <h3>Work Conversion</h3>
                \${workConversion ? \`<span class="run-status">\${clientEscapeHtml(workConversion.conversionStatus)}</span>\` : ""}
              </div>
              <dl class="prospect-summary">
                <div><dt>Conversion status</dt><dd>\${clientEscapeHtml(workConversion?.conversionStatus || "")}</dd></div>
                <div><dt>Estimated value (cents)</dt><dd>\${clientEscapeHtml(workConversion?.estimatedValueCents || "")}</dd></div>
                <div><dt>Conversion notes</dt><dd>\${clientEscapeHtml(workConversion?.notes || "")}</dd></div>
              </dl>
              <form class="operator-edit-form" data-work-conversion-form data-prospect-id="\${clientEscapeHtml(prospectBusiness.id)}">
                <label>
                  <span>Conversion status</span>
                  <select name="conversionStatus" required>
                    <option value="serious_opportunity"\${workConversion?.conversionStatus === "serious_opportunity" ? " selected" : ""}>Serious opportunity</option>
                    <option value="work_won"\${workConversion?.conversionStatus === "work_won" ? " selected" : ""}>Work won</option>
                    <option value="work_lost"\${workConversion?.conversionStatus === "work_lost" ? " selected" : ""}>Work lost</option>
                  </select>
                </label>
                <label>
                  <span>Estimated value (cents)</span>
                  <input name="estimatedValueCents" type="number" min="0" step="1" value="\${clientEscapeHtml(workConversion?.estimatedValueCents || "")}" />
                </label>
                <label>
                  <span>Conversion notes</span>
                  <textarea name="notes">\${clientEscapeHtml(workConversion?.notes || "")}</textarea>
                </label>
                <button type="submit">Record Conversion</button>
                <div class="form-message" role="status"></div>
              </form>
            </section>
          \`;

          return \`
            <section class="prospect-detail" aria-label="Prospect Business detail">
              <dl class="prospect-summary">
                <div><dt>Google Place ID</dt><dd>\${clientEscapeHtml(prospectBusiness.googlePlaceId)}</dd></div>
                <div><dt>First discovered</dt><dd>\${clientEscapeHtml(prospectBusiness.firstDiscoveredRun.searchTerm)} in \${clientEscapeHtml(prospectBusiness.firstDiscoveredRun.searchLocation.label)}</dd></div>
                <div><dt>Latest discovered</dt><dd>\${clientEscapeHtml(prospectBusiness.latestDiscoveredRun.searchTerm)} in \${clientEscapeHtml(prospectBusiness.latestDiscoveredRun.searchLocation.label)}</dd></div>
              </dl>
              <ol class="appearance-history">\${history}</ol>
              \${replyTrackingMarkup}
              \${workConversionMarkup}
              \${workflowFailureMarkup}
              \${assessmentMarkup}
              \${previewMarkup}
              \${draftOutreachMarkup}
            </section>
          \`;
        }

        reviewPolicyForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const submit = reviewPolicyForm.querySelector("button");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (reviewPolicyMessage) {
            reviewPolicyMessage.textContent = "Saving Review Policy...";
          }

          const formData = new FormData(reviewPolicyForm);
          const body = {
            requireReviewBeforePreviewPublication: formData.has("require-review-before-preview-publication"),
            requireReviewBeforeOutreachSending: formData.has("require-review-before-outreach-sending"),
          };

          try {
            const response = await fetch("/api/review-policy", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Review Policy update failed");
            }
            reviewPolicy.requireReviewBeforePreviewPublication = payload.reviewPolicy.requireReviewBeforePreviewPublication;
            reviewPolicy.requireReviewBeforeOutreachSending = payload.reviewPolicy.requireReviewBeforeOutreachSending;
            if (reviewPolicyMessage) {
              reviewPolicyMessage.textContent = "Review Policy saved.";
            }
          } catch (error) {
            if (reviewPolicyMessage) {
              reviewPolicyMessage.textContent = error instanceof Error ? error.message : "Review Policy update failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

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

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-preview-edit-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Saving Preview Website edits...";
          }

          const formData = new FormData(form);
          const edits = Array.from(formData.entries()).map(([path, value]) => ({
            path,
            value: String(value),
          }));

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/preview-website/operator-edits\`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ edits }),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Preview Website edits failed");
            }
            if (message) {
              message.textContent = "Preview Website edits saved.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Preview Website edits failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-preview-publication-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Publishing Preview Website...";
          }

          const formData = new FormData(form);
          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/preview-website/publication\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ approvalReason: String(formData.get("approvalReason") || "") }),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Preview Website publication failed");
            }
            if (message) {
              message.textContent = "Preview Website published.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Preview Website publication failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-preview-unpublication-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Unpublishing Preview Website...";
          }

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/preview-website/publication\`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Preview Website unpublication failed");
            }
            if (message) {
              message.textContent = "Preview Website unpublished.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Preview Website unpublication failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-outreach-edit-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Saving Draft Outreach edits...";
          }

          const formData = new FormData(form);
          const body = {
            subject: String(formData.get("subject") || ""),
            bodyText: String(formData.get("bodyText") || ""),
            bodyHtml: String(formData.get("bodyHtml") || ""),
          };

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/draft-outreach/operator-edits\`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Draft Outreach edits failed");
            }
            if (message) {
              message.textContent = "Draft Outreach edits saved.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Draft Outreach edits failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-outreach-send-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Sending Outreach...";
          }

          const formData = new FormData(form);
          const body = {
            fromEmail: String(formData.get("fromEmail") || ""),
            senderIdentity: String(formData.get("senderIdentity") || ""),
            postalAddress: String(formData.get("postalAddress") || ""),
            optOutWording: String(formData.get("optOutWording") || ""),
            approvalReason: String(formData.get("approvalReason") || ""),
          };

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/outreach-email/send\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Outreach Email sending failed");
            }
            if (message) {
              message.textContent = \`Outreach Email sent. Provider message: \${payload.outreachEmail.providerMessageId || "recorded"}\`;
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Outreach Email sending failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-reply-tracking-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Recording Reply Tracking...";
          }

          const formData = new FormData(form);
          const repliedAt = String(formData.get("repliedAt") || "");
          const body = {
            repliedAt: repliedAt ? new Date(repliedAt).toISOString() : "",
            summary: String(formData.get("summary") || ""),
            notes: String(formData.get("notes") || ""),
          };

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/reply-tracking\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Reply Tracking update failed");
            }
            if (message) {
              message.textContent = "Reply Tracking recorded.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Reply Tracking update failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
          }
        });

        discoveryRuns.addEventListener("submit", async (event) => {
          const form = event.target instanceof Element ? event.target.closest("[data-work-conversion-form]") : null;
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          event.preventDefault();
          const submit = form.querySelector("button");
          const message = form.querySelector(".form-message");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = true;
          }
          if (message) {
            message.textContent = "Recording Work Conversion...";
          }

          const formData = new FormData(form);
          const estimatedValue = String(formData.get("estimatedValueCents") || "");
          const body = {
            conversionStatus: String(formData.get("conversionStatus") || ""),
            estimatedValueCents: estimatedValue ? Number(estimatedValue) : undefined,
            notes: String(formData.get("notes") || ""),
          };

          try {
            const response = await fetch(\`/api/prospect-businesses/\${encodeURIComponent(form.dataset.prospectId || "")}/work-conversion\`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || "Work Conversion update failed");
            }
            if (message) {
              message.textContent = "Work Conversion recorded.";
            }
          } catch (error) {
            if (message) {
              message.textContent = error instanceof Error ? error.message : "Work Conversion update failed";
            }
          } finally {
            if (submit instanceof HTMLButtonElement) {
              submit.disabled = false;
            }
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
  const metadataEntries = Object.entries(event.metadata);
  const metadataMarkup = metadataEntries.length > 0
    ? `<code>${escapeHtml(JSON.stringify(event.metadata))}</code>`
    : "";

  return `
    <li>
      <time datetime="${escapeHtml(event.occurredAt.toISOString())}">${escapeHtml(
        event.occurredAt.toLocaleString("en-US", { timeZone: "UTC" })
      )} UTC</time>
      <strong>${escapeHtml(event.eventType)}</strong>
      <span>${escapeHtml(event.summary)}</span>
      ${metadataMarkup}
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

      h3,
      h4 {
        margin: 0;
      }

      .detail-section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .website-assessment,
      .reply-tracking,
      .work-conversion {
        display: grid;
        gap: 10px;
        border-top: 1px solid #e0e5eb;
        padding-top: 12px;
      }

      .preview-website {
        display: grid;
        gap: 12px;
        border-top: 1px solid #e0e5eb;
        padding-top: 12px;
      }

      .preview-frame {
        width: 100%;
        min-height: 520px;
        border: 1px solid #c8d1dc;
        border-radius: 8px;
        background: #ffffff;
      }

      .operator-edit-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        padding-top: 4px;
      }

      .operator-edit-form h4,
      .operator-edit-form button,
      .operator-edit-form .form-message {
        grid-column: 1 / -1;
      }

      .evidence-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding-left: 20px;
      }

      .evidence-list li {
        overflow-wrap: anywhere;
      }

      .evidence-list strong,
      .evidence-list span {
        display: block;
      }

      @media (max-width: 840px) {
        .topbar,
        .section-heading,
        .dashboard-grid,
        .config-list div,
        .discovery-form,
        .run-header,
        .detail-section-heading,
        .run-metadata,
        .prospect-summary,
        .operator-edit-form {
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
