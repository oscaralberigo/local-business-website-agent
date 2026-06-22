import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { runDiscovery } from "../src/discovery/run-discovery.js";
import type { BusinessDiscoverySource, GooglePlaceResult, StartDiscoveryRunInput } from "../src/discovery/types.js";
import { PostgresProspectRegistry } from "../src/persistence/postgres-prospect-registry.js";

const discoveryRequest: StartDiscoveryRunInput = {
  mode: "place_search",
  searchTerm: "coffee shop",
  searchLocation: {
    label: "Beacon, NY",
  },
  discoveryLimit: 1,
};

describe("Postgres Prospect Registry", () => {
  it("deduplicates Prospect Businesses by Google Place ID and records each Discovery Appearance", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const firstRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/postgres-cafe",
        name: "Postgres Cafe",
        formattedAddress: "1 Main St",
        websiteUrl: "https://first.example",
        categories: ["cafe"],
        sourcePayload: { version: "first" },
      }),
    });

    const secondRun = await runDiscovery({
      request: {
        ...discoveryRequest,
        searchTerm: "bakery",
      },
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/postgres-cafe",
        name: "Postgres Cafe Bakery",
        formattedAddress: "2 Main St",
        websiteUrl: "https://latest.example",
        categories: ["cafe", "bakery"],
        sourcePayload: { version: "latest" },
      }),
    });

    expect(secondRun.discoveredProspects[0]?.id).toBe(firstRun.discoveredProspects[0]?.id);
    expect(secondRun.discoveredProspects[0]).toMatchObject({
      name: "Postgres Cafe Bakery",
      formattedAddress: "2 Main St",
      websiteUrl: "https://latest.example",
      sourceData: { version: "latest" },
    });

    const prospectDetail = await registry.getProspectBusinessDetail(
      secondRun.discoveredProspects[0]!.id,
    );

    expect(prospectDetail.firstDiscoveredRun.id).toBe(firstRun.id);
    expect(prospectDetail.latestDiscoveredRun.id).toBe(secondRun.id);
    expect(prospectDetail.appearanceHistory.map((appearance) => appearance.discoveryRun.id)).toEqual([
      firstRun.id,
      secondRun.id,
    ]);

    const prospectCount = await pool.query(
      "select count(*)::int as count from prospect_businesses where google_place_id = $1",
      ["places/postgres-cafe"],
    );
    expect(prospectCount.rows[0].count).toBe(1);

    await pool.end();
  });

  it("persists Business Context sources, facts, exclusions, and derived Supported Claims", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/context-cafe",
        name: "Context Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/context-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const businessContext = await registry.saveBusinessContext({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [
        {
          id: "source-allowed",
          sourceType: "business_website",
          url: "https://context.example/about",
          retrievedAt: new Date("2026-06-22T15:00:00.000Z"),
          termsCompliance: {
            allowed: true,
            checkedAt: new Date("2026-06-22T15:00:00.000Z"),
            robotsDirective: "index,follow",
          },
        },
        {
          id: "source-disallowed",
          sourceType: "search_results",
          url: "https://search.example/result",
          retrievedAt: new Date("2026-06-22T15:01:00.000Z"),
          termsCompliance: {
            allowed: false,
            checkedAt: new Date("2026-06-22T15:01:00.000Z"),
            notes: "Source terms disallowed generated use.",
          },
        },
      ],
      facts: [
        {
          sourceId: "source-allowed",
          label: "Menu specialty",
          value: "Context Cafe serves house-roasted coffee.",
          allowedForGeneration: true,
        },
        {
          sourceId: "source-disallowed",
          label: "Blocked fact",
          value: "Context Cafe has a hidden terrace.",
          allowedForGeneration: true,
        },
      ],
      excludedResearchData: [
        {
          sourceId: "source-allowed",
          label: "Staff profile",
          valueSummary: "A staff personal profile was excluded.",
          reason: "staff_personal_profile",
          excludedAt: new Date("2026-06-22T15:02:00.000Z"),
        },
      ],
    });

    expect(businessContext.supportedClaims).toHaveLength(1);
    expect(businessContext.supportedClaims[0]).toMatchObject({
      statement: "Context Cafe serves house-roasted coffee.",
      evidence: [{ sourceId: "source-allowed" }],
    });

    await expectCount(pool, "business_context_sources", prospectBusinessId, 2);
    await expectCount(pool, "business_context_facts", prospectBusinessId, 1);
    await expectCount(pool, "excluded_research_data", prospectBusinessId, 2);
    await expectCount(pool, "supported_claims", prospectBusinessId, 1);

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.businessContext).toMatchObject({
      prospectBusinessId,
      researchMode: "expanded",
      sources: [{ id: "source-allowed" }, { id: "source-disallowed" }],
      facts: [{ sourceId: "source-allowed" }],
      excludedResearchData: [
        { reason: "staff_personal_profile" },
        { reason: "source_terms_disallowed" },
      ],
      supportedClaims: [
        {
          statement: "Context Cafe serves house-roasted coffee.",
          evidence: [{ sourceId: "source-allowed" }],
        },
      ],
    });

    await pool.end();
  });

  it("persists Website Assessment evidence and operator Preview Eligibility overrides", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/modern-cafe",
        name: "Modern Cafe",
        websiteUrl: "https://modern-cafe.example",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/modern-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    await registry.saveWebsiteAssessment({
      prospectBusinessId,
      input: {
        currentWebsiteUrl: "https://modern-cafe.example",
        htmlText: "<main>Modern Cafe menu and booking</main>",
        deterministicChecks: {
          pageLoad: "reachable",
          https: "valid",
          mobileViewport: "rendered",
          contactInformationFound: true,
          servicesFound: true,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
        desktopScreenshot: {
          uri: "s3://screenshots/modern-cafe-desktop.png",
          capturedAt: new Date("2026-06-22T16:30:00.000Z"),
        },
        mobileScreenshot: {
          uri: "s3://screenshots/modern-cafe-mobile.png",
          capturedAt: new Date("2026-06-22T16:31:00.000Z"),
        },
      },
      reviewerOutput: {
        opportunityCategory: "modern_sufficient",
        confidence: 0.91,
        summary: "The website is modern, mobile-friendly, and includes clear contact paths.",
        evidence: [
          {
            claim: "The mobile screenshot shows clear navigation and contact details.",
            source: "mobile_screenshot",
          },
        ],
        recommendedPitchAngle: "no_outreach",
        outreachSafeClaims: [],
        operatorReviewNotes: ["No preview should be generated by default."],
      },
      assessedAt: new Date("2026-06-22T16:32:00.000Z"),
    });

    const storedProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(storedProspect.prospectStatus).toBe("not_preview_eligible");
    expect(storedProspect.websiteAssessment).toMatchObject({
      prospectBusinessId,
      currentWebsiteUrl: "https://modern-cafe.example",
      opportunityCategory: "modern_sufficient",
      evidence: [{ source: "mobile_screenshot" }],
      safeClaims: [],
      reviewNotes: ["No preview should be generated by default."],
      previewEligibility: {
        eligibleByDefault: false,
        effectiveEligible: false,
        requiresOperatorReview: false,
        overriddenByOperator: false,
      },
    });

    const overriddenAssessment = await registry.overridePreviewEligibility({
      prospectBusinessId,
      eligible: true,
      reason: "Operator wants to show a premium redesign concept.",
      actor: "operator",
      overriddenAt: new Date("2026-06-22T16:40:00.000Z"),
    });

    expect(overriddenAssessment.previewEligibility).toMatchObject({
      eligibleByDefault: false,
      effectiveEligible: true,
      overriddenByOperator: true,
      override: {
        reason: "Operator wants to show a premium redesign concept.",
        actor: "operator",
      },
    });

    const updatedProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(updatedProspect.prospectStatus).toBe("assessment_complete");

    await pool.end();
  });

  it("persists Contact Evidence and lets the operator add a verified contact path", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/contact-cafe",
        name: "Contact Cafe",
        websiteUrl: "https://contact-cafe.example",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/contact-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const contactEvidence = await registry.saveContactEvidence({
      prospectBusinessId,
      foundAt: new Date("2026-06-22T18:10:00.000Z"),
      candidates: [
        {
          emailAddress: "hello@contact-cafe.example",
          sourceUrl: "https://contact-cafe.example/contact",
          sourceType: "business_website",
          confidence: 0.94,
          roleClassification: "role",
          acquisitionMethod: "published",
          reason: "Published on the official contact page.",
        },
      ],
    });

    expect(contactEvidence).toEqual([
      expect.objectContaining({
        sourceUrl: "https://contact-cafe.example/contact",
        sourceType: "business_website",
        confidence: 0.94,
        roleClassification: "role",
        outreachApprovalStatus: "pending_operator_approval",
      }),
    ]);

    const manuallyAdded = await registry.addVerifiedContactEvidence({
      prospectBusinessId,
      emailAddress: "bookings@contact-cafe.example",
      sourceUrl: "https://contact-cafe.example/private-operator-notes",
      sourceType: "business_website",
      reason: "Operator verified this inbox during a manual review.",
      actor: "operator",
      approvedAt: new Date("2026-06-22T18:20:00.000Z"),
    });

    expect(manuallyAdded).toMatchObject({
      emailAddress: "bookings@contact-cafe.example",
      outreachApprovalStatus: "approved",
      approvedBy: "operator",
      approvalReason: "Operator verified this inbox during a manual review.",
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.prospectStatus).toBe("drafting_outreach");
    expect(prospectDetail.contactEvidence).toEqual([
      expect.objectContaining({
        emailAddress: "hello@contact-cafe.example",
        outreachApprovalStatus: "pending_operator_approval",
      }),
      expect.objectContaining({
        emailAddress: "bookings@contact-cafe.example",
        outreachApprovalStatus: "approved",
        approvedBy: "operator",
      }),
    ]);

    await expectCount(pool, "contact_evidence", prospectBusinessId, 2);

    await pool.end();
  });

  it("persists Draft Outreach and operator edits for review", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/outreach-cafe",
        name: "Outreach Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/outreach-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const draftOutreach = await registry.saveDraftOutreach({
      prospectBusinessId,
      subject: "Website preview for Outreach Cafe",
      bodyText:
        "Hi Outreach Cafe team,\nhttps://previews.example.com/published-previews/abc123/\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Outreach Cafe team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [
        {
          claim: "The current website could make contact details easier to find.",
          source: "website_assessment.safe_claims",
        },
      ],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
    });

    expect(draftOutreach).toMatchObject({
      subject: "Website preview for Outreach Cafe",
      requiresOperatorReview: true,
    });

    const editedDraft = await registry.updateDraftOutreachOperatorEdits({
      prospectBusinessId,
      actor: "operator",
      edits: {
        subject: "A website idea for Outreach Cafe",
        bodyText: `${draftOutreach.bodyText}\n\nOperator-added note.`,
      },
    });

    expect(editedDraft).toMatchObject({
      id: draftOutreach.id,
      subject: "A website idea for Outreach Cafe",
      bodyText: expect.stringContaining("Operator-added note."),
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.prospectStatus).toBe("outreach_ready_for_review");
    expect(prospectDetail.draftOutreach).toMatchObject({
      id: draftOutreach.id,
      subject: "A website idea for Outreach Cafe",
    });

    await expectCount(pool, "draft_outreach", prospectBusinessId, 1);
    await pool.end();
  });

  it("persists Outreach Email send metadata, suppression checks, and Workflow Failures", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/send-cafe",
        name: "Send Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/send-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const draftOutreach = await registry.saveDraftOutreach({
      prospectBusinessId,
      subject: "Website preview for Send Cafe",
      bodyText:
        "Hi Send Cafe team,\nhttps://previews.example.com/published-previews/abc123/\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Send Cafe team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
    });
    const outreachEmail = await registry.saveOutreachEmail({
      prospectBusinessId,
      draftOutreachId: draftOutreach.id,
      recipientEmailAddress: "hello@send-cafe.example",
      provider: "resend",
      providerMessageId: "resend-message-123",
      sendStatus: "sent",
      suppressionStatus: "clear",
      sentAt: new Date("2026-06-22T21:00:00.000Z"),
    });

    await registry.recordOutreachSuppression({
      prospectBusinessId,
      emailAddress: "hello@send-cafe.example",
      status: "do_not_contact",
      reason: "Operator marked the Prospect Business as do-not-contact.",
    });
    await registry.recordOutreachWorkflowFailure({
      prospectBusinessId,
      failedStep: "outreach_email_send",
      errorSummary: "Resend rate limit.",
      retryable: true,
      provider: "resend",
    });

    await expect(
      registry.getOutreachSuppressionStatus({
        prospectBusinessId,
        emailAddress: "hello@send-cafe.example",
      }),
    ).resolves.toEqual({
      status: "do_not_contact",
      reason: "Operator marked the Prospect Business as do-not-contact.",
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.prospectStatus).toBe("outreach_sent");
    expect(prospectDetail.outreachEmails).toEqual([
      expect.objectContaining({
        id: outreachEmail.id,
        provider: "resend",
        providerMessageId: "resend-message-123",
        sendStatus: "sent",
        suppressionStatus: "clear",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      }),
    ]);
    expect(prospectDetail.workflowFailures).toEqual([
      expect.objectContaining({
        prospectBusinessId,
        failedStep: "outreach_email_send",
        errorSummary: "Resend rate limit.",
        retryable: true,
        provider: "resend",
      }),
    ]);

    await expectCount(pool, "outreach_emails", prospectBusinessId, 1);
    await pool.end();
  });

  it("persists manual Reply Tracking and moves Prospect Status to replied", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/reply-cafe",
        name: "Reply Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/reply-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const prospectDetail = await registry.recordManualReply({
      prospectBusinessId,
      repliedAt: new Date("2026-06-22T22:15:00.000Z"),
      summary: "The owner replied and asked for pricing.",
      notes: "Follow up manually with a small-cafe package estimate.",
      actor: "operator",
    });

    expect(prospectDetail.prospectStatus).toBe("replied");
    expect(prospectDetail.replyTracking).toMatchObject({
      prospectBusinessId,
      repliedAt: new Date("2026-06-22T22:15:00.000Z"),
      summary: "The owner replied and asked for pricing.",
      notes: "Follow up manually with a small-cafe package estimate.",
      recordedBy: "operator",
      recordedAt: expect.any(Date),
    });

    await expect(registry.getProspectBusinessDetail(prospectBusinessId)).resolves.toMatchObject({
      prospectStatus: "replied",
      replyTracking: {
        summary: "The owner replied and asked for pricing.",
        recordedBy: "operator",
      },
    });
    await expectCount(pool, "reply_tracking", prospectBusinessId, 1);
    await pool.end();
  });

  it("persists manual Work Conversion and moves Prospect Status to work_won", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/work-won-cafe",
        name: "Work Won Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/work-won-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const prospectDetail = await registry.recordManualWorkConversion({
      prospectBusinessId,
      conversionStatus: "work_won",
      estimatedValueCents: 250000,
      notes: "Owner approved a starter website package.",
      actor: "operator",
    });

    expect(prospectDetail.prospectStatus).toBe("work_won");
    expect(prospectDetail.workConversion).toMatchObject({
      prospectBusinessId,
      conversionStatus: "work_won",
      estimatedValueCents: 250000,
      notes: "Owner approved a starter website package.",
      recordedBy: "operator",
      recordedAt: expect.any(Date),
    });

    await expect(registry.getProspectBusinessDetail(prospectBusinessId)).resolves.toMatchObject({
      prospectStatus: "work_won",
      workConversion: {
        conversionStatus: "work_won",
        estimatedValueCents: 250000,
        recordedBy: "operator",
      },
    });
    await expectCount(pool, "work_conversions", prospectBusinessId, 1);
    await pool.end();
  });

  it("includes Follow-Up Outreach metadata hooks without automated follow-up sending", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/follow-up-cafe",
        name: "Follow Up Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/follow-up-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    await pool.query(
      `insert into follow_up_outreach_metadata
        (prospect_business_id, follow_up_status, next_follow_up_at, notes, recorded_by)
       values ($1, 'manual_follow_up_needed', $2, $3, 'operator')`,
      [
        prospectBusinessId,
        new Date("2026-06-29T15:00:00.000Z"),
        "Operator may follow up manually next week.",
      ],
    );

    const result = await pool.query(
      `select follow_up_status, next_follow_up_at, notes, recorded_by
       from follow_up_outreach_metadata
       where prospect_business_id = $1`,
      [prospectBusinessId],
    );

    expect(result.rows[0]).toMatchObject({
      follow_up_status: "manual_follow_up_needed",
      next_follow_up_at: new Date("2026-06-29T15:00:00.000Z"),
      notes: "Operator may follow up manually next week.",
      recorded_by: "operator",
    });
    await expectCount(pool, "outreach_emails", prospectBusinessId, 0);
    await pool.end();
  });

  it("persists retryable Workflow State from a failed Discovery Run step", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const failedRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: {
        async searchPlaces() {
          throw new Error("Google Places timed out.");
        },
      },
    });

    expect(failedRun.status).toBe("failed");
    expect(failedRun.workflowFailures).toEqual([
      expect.objectContaining({
        discoveryRunId: failedRun.id,
        failedStep: "google_places_discovery",
        errorSummary: "Google Places timed out.",
        retryable: true,
        operatorVisibleStatus: "visible",
        provider: "google_places",
        createdAt: expect.any(Date),
      }),
    ]);

    const workflowState = await registry.retryWorkflowFailure({
      workflowFailureId: failedRun.workflowFailures[0]!.id,
      actor: "operator",
    });

    expect(workflowState).toMatchObject({
      workflowKey: `discovery-run:${failedRun.id}`,
      discoveryRunId: failedRun.id,
      currentStep: "google_places_discovery",
      status: "retrying",
      attemptCount: 1,
      lastFailureId: failedRun.workflowFailures[0]!.id,
      stateData: {
        retryRequestedBy: "operator",
      },
    });

    await expect(registry.getWorkflowStateForDiscoveryRun(failedRun.id)).resolves.toMatchObject({
      workflowKey: `discovery-run:${failedRun.id}`,
      currentStep: "google_places_discovery",
      status: "retrying",
      attemptCount: 1,
    });

    await expect(registry.getDiscoveryRunDetail(failedRun.id)).resolves.toMatchObject({
      workflowFailures: [
        expect.objectContaining({
          operatorVisibleStatus: "retrying",
        }),
      ],
    });

    await pool.end();
  });

  it("stores Prompt Versions with agent output summaries in Workflow State", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/prompt-version-cafe",
        name: "Prompt Version Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/prompt-version-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    await registry.saveWorkflowState({
      workflowKey: `prospect-business:${prospectBusinessId}`,
      prospectBusinessId,
      currentStep: "website_designer_agent",
      status: "paused_for_review",
      promptVersions: {
        websiteDesignerAgent: "website-designer-agent@2026-06-22",
      },
      agentOutputSummaries: [
        {
          agent: "website_designer_agent",
          model: "gpt-4.1",
          outputJsonSummary: {
            primaryGoal: "menu_view",
            sections: ["hero", "visit", "menu"],
          },
        },
      ],
      sourceReferences: [
        {
          sourceId: "google-places:prompt-version-cafe",
          statement: "Prompt Version Cafe is categorized as a cafe.",
        },
      ],
      stateData: {
        reviewReason: "Preview Website design requires Human Review before building.",
      },
      pausedAt: new Date("2026-06-22T22:00:00.000Z"),
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.workflowState).toMatchObject({
      workflowKey: `prospect-business:${prospectBusinessId}`,
      currentStep: "website_designer_agent",
      status: "paused_for_review",
      promptVersions: {
        websiteDesignerAgent: "website-designer-agent@2026-06-22",
      },
      agentOutputSummaries: [
        {
          agent: "website_designer_agent",
          model: "gpt-4.1",
          outputJsonSummary: {
            primaryGoal: "menu_view",
          },
        },
      ],
      sourceReferences: [
        {
          sourceId: "google-places:prompt-version-cafe",
        },
      ],
      pausedAt: new Date("2026-06-22T22:00:00.000Z"),
    });

    await pool.end();
  });

  it("persists Preview Website metadata, generated content, source references, and artifact paths", async () => {
    const database = newDb();
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const registry = new PostgresProspectRegistry(pool);
    await pool.query(await readFile(new URL("../src/persistence/schema.sql", import.meta.url), "utf8"));

    const discoveryRun = await runDiscovery({
      request: discoveryRequest,
      registry,
      discoverySource: sourceReturning({
        googlePlaceId: "places/preview-cafe",
        name: "Preview Cafe",
        categories: ["cafe"],
        sourcePayload: { placeId: "places/preview-cafe" },
      }),
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const previewWebsite = await registry.savePreviewWebsite({
      prospectBusinessId,
      slug: "preview-cafe-example",
      status: "ready_for_review",
      designPlan: {
        siteType: "multi_section",
        primaryGoal: "menu_view",
        targetCustomer: "Local coffee customers checking the menu before visiting.",
        pitchAngle: "modern_upgrade",
        sections: [
          {
            id: "hero",
            title: "Coffee near Main Street",
            purpose: "Lead with the supported cafe category and location.",
            requiredEvidence: ["Preview Cafe is categorized as a cafe."],
            contentGuidance: "Use restrained copy and avoid unsupported menu claims.",
          },
        ],
        navigation: {
          style: "prominent_cta",
          items: ["Home", "Menu", "Visit"],
        },
        features: [
          {
            name: "Menu CTA",
            purpose: "Let visitors inspect the menu if the operator verifies a URL.",
            evidence: "Operator editable placeholder.",
          },
        ],
        avoid: ["Do not invent prices, awards, reviews, or opening hours."],
        operatorReviewNotes: ["Verify the menu CTA before publication."],
      },
      contentJson: {
        hero: {
          headline: "Coffee near Main Street",
          body: "Preview Cafe is categorized as a cafe.",
        },
      },
      sourceReferences: [
        {
          sourceId: "source-1",
          factId: "fact-1",
          statement: "Preview Cafe is categorized as a cafe.",
        },
      ],
      buildMetadata: {
        builder: "svelte",
        command: "npm run build:previews",
        status: "built",
      },
      artifact: {
        sourceRoot: "previews/preview-cafe-example/source",
        staticRoot: "previews/preview-cafe-example/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
          value: "Coffee near Main Street",
        },
      ],
    });

    expect(previewWebsite).toMatchObject({
      prospectBusinessId,
      slug: "preview-cafe-example",
      status: "ready_for_review",
      designPlan: {
        primaryGoal: "menu_view",
        navigation: { items: ["Home", "Menu", "Visit"] },
      },
      contentJson: {
        hero: {
          headline: "Coffee near Main Street",
        },
      },
      sourceReferences: [
        {
          sourceId: "source-1",
          factId: "fact-1",
        },
      ],
      buildMetadata: {
        builder: "svelte",
        status: "built",
      },
      artifact: {
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
    });

    const prospectDetail = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospectDetail.prospectStatus).toBe("preview_ready_for_review");
    expect(prospectDetail.previewWebsite).toMatchObject({
      slug: "preview-cafe-example",
      status: "ready_for_review",
      operatorEditableFields: [
        {
          path: "contentJson.hero.headline",
          label: "Hero headline",
        },
      ],
    });

    const editedPreviewWebsite = await registry.updatePreviewWebsiteOperatorEdits({
      prospectBusinessId,
      actor: "operator",
      edits: [
        {
          path: "contentJson.hero.headline",
          value: "Coffee and pastries near Main Street",
        },
      ],
    });

    expect(editedPreviewWebsite.contentJson).toMatchObject({
      hero: {
        headline: "Coffee and pastries near Main Street",
      },
    });
    expect(editedPreviewWebsite.operatorEditableFields).toContainEqual({
      path: "contentJson.hero.headline",
      label: "Hero headline",
      value: "Coffee and pastries near Main Street",
    });

    await expect(
      registry.updatePreviewWebsiteOperatorEdits({
        prospectBusinessId,
        actor: "operator",
        edits: [
          {
            path: "buildMetadata.command",
            value: "rm -rf previews",
          },
        ],
      }),
    ).rejects.toThrow("not reviewable");

    const publishedPreviewWebsite = await registry.publishPreviewWebsite({
      prospectBusinessId,
      actor: "operator",
      approvalReason: "Preview copy and source references are ready.",
      publication: {
        previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
        previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
        deploymentId: "preview-deployment-1",
        buildId: "npm-run-build-previews",
        noindex: true,
        publishedAt: new Date("2026-06-22T20:00:00.000Z"),
        approvedBy: "operator",
        approvalReason: "Preview copy and source references are ready.",
      },
    });

    expect(publishedPreviewWebsite).toMatchObject({
      status: "published",
      publication: {
        previewUrl: "https://previews.example.com/published-previews/6d4a8a4b9de2484da8e04dd3/",
        deploymentId: "preview-deployment-1",
        buildId: "npm-run-build-previews",
        noindex: true,
        approvedBy: "operator",
      },
    });
    await expect(
      registry.getProspectBusinessDetail(prospectBusinessId),
    ).resolves.toMatchObject({
      prospectStatus: "preview_published",
      previewWebsite: {
        status: "published",
        publication: {
          previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
        },
      },
    });

    const unpublishedPreviewWebsite = await registry.unpublishPreviewWebsite({
      prospectBusinessId,
      actor: "operator",
    });

    expect(unpublishedPreviewWebsite).toMatchObject({
      status: "ready_for_review",
      publication: {
        previewUrlPath: "/published-previews/6d4a8a4b9de2484da8e04dd3/",
        unpublishedBy: "operator",
      },
    });
    await expect(
      registry.getProspectBusinessDetail(prospectBusinessId),
    ).resolves.toMatchObject({
      prospectStatus: "preview_ready_for_review",
      previewWebsite: {
        status: "ready_for_review",
        publication: {
          unpublishedBy: "operator",
        },
      },
    });

    await expectCount(pool, "preview_websites", prospectBusinessId, 1);

    await pool.end();
  });
});

function sourceReturning(place: GooglePlaceResult): BusinessDiscoverySource {
  return {
    async searchPlaces() {
      return [place];
    },
  };
}

async function expectCount(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ count: number }> }> },
  tableName: string,
  prospectBusinessId: string,
  expectedCount: number,
) {
  const result = await pool.query(
    `select count(*)::int as count from ${tableName} where prospect_business_id = $1`,
    [prospectBusinessId],
  );
  expect(result.rows[0].count).toBe(expectedCount);
}
