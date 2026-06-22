import { describe, expect, it, vi } from "vitest";

import type { ProspectBusinessDetail } from "../src/discovery/types.js";
import { sendApprovedOutreachEmail } from "../src/outreach/send-outreach-email.js";
import type {
  EmailSendingProvider,
  OutreachEmail,
  OutreachEmailStore,
  OutreachSuppressionStore,
} from "../src/outreach/types.js";

describe("Outreach Email sending", () => {
  it("sends an approved compliant Draft Outreach and persists provider metadata", async () => {
    const prospectBusiness = prospectBusinessReadyForOutreach();
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "resend",
        providerMessageId: "resend-message-123",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      })),
    };
    const outreachEmailStore = createOutreachEmailStore();
    const suppressionStore: OutreachSuppressionStore = {
      getOutreachSuppressionStatus: vi.fn(async () => ({ status: "clear" as const })),
    };

    const outreachEmail = await sendApprovedOutreachEmail({
      prospectBusiness,
      emailProvider,
      outreachEmailStore,
      suppressionStore,
      workflowFailureStore: {
        recordOutreachWorkflowFailure: vi.fn(),
      },
      actor: "operator",
      fromEmail: "Logan Sinclair <logan@example.com>",
      senderIdentity: "Logan Sinclair",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
      approvalReason: "Operator approved this Draft Outreach for sending.",
    });

    expect(emailProvider.send).toHaveBeenCalledWith({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@detail.example",
      subject: "Website preview for Detail Cafe",
      text: prospectBusiness.draftOutreach?.bodyText,
      html: prospectBusiness.draftOutreach?.bodyHtml,
    });
    expect(outreachEmail).toMatchObject({
      prospectBusinessId: "prospect-1",
      draftOutreachId: "draft-1",
      recipientEmailAddress: "hello@detail.example",
      provider: "resend",
      providerMessageId: "resend-message-123",
      sendStatus: "sent",
      suppressionStatus: "clear",
      sentAt: new Date("2026-06-22T21:00:00.000Z"),
    });
    expect(outreachEmail.failureMetadata).toBeUndefined();
  });

  it("blocks suppressed prospects before calling the Email Sending Provider", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(),
    };
    const outreachEmailStore: OutreachEmailStore = {
      saveOutreachEmail: vi.fn(),
    };

    await expect(
      sendApprovedOutreachEmail({
        prospectBusiness: prospectBusinessReadyForOutreach(),
        emailProvider,
        outreachEmailStore,
        suppressionStore: {
          getOutreachSuppressionStatus: vi.fn(async () => ({
            status: "suppressed" as const,
            reason: "Recipient previously opted out.",
          })),
        },
        workflowFailureStore: {
          recordOutreachWorkflowFailure: vi.fn(),
        },
        actor: "operator",
        fromEmail: "Logan Sinclair <logan@example.com>",
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
        approvalReason: "Operator approved this Draft Outreach for sending.",
      }),
    ).rejects.toThrow("Suppressed prospects cannot receive outreach.");

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(outreachEmailStore.saveOutreachEmail).not.toHaveBeenCalled();
  });

  it("blocks do-not-contact prospects before calling the Email Sending Provider", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(),
    };
    const outreachEmailStore: OutreachEmailStore = {
      saveOutreachEmail: vi.fn(),
    };

    await expect(
      sendApprovedOutreachEmail({
        prospectBusiness: prospectBusinessReadyForOutreach(),
        emailProvider,
        outreachEmailStore,
        suppressionStore: {
          getOutreachSuppressionStatus: vi.fn(async () => ({
            status: "do_not_contact" as const,
            reason: "Operator marked the Prospect Business as do-not-contact.",
          })),
        },
        workflowFailureStore: {
          recordOutreachWorkflowFailure: vi.fn(),
        },
        actor: "operator",
        fromEmail: "Logan Sinclair <logan@example.com>",
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
        approvalReason: "Operator approved this Draft Outreach for sending.",
      }),
    ).rejects.toThrow("Do-not-contact prospects cannot receive outreach.");

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(outreachEmailStore.saveOutreachEmail).not.toHaveBeenCalled();
  });

  it("persists failure metadata and records a retryable Workflow Failure when provider send fails", async () => {
    const providerFailure = new Error("Resend accepted no requests right now.");
    const outreachEmailStore: OutreachEmailStore = {
      saveOutreachEmail: vi.fn(async (input) => ({
        id: "outreach-email-failure-1",
        createdAt: new Date("2026-06-22T21:05:00.000Z"),
        updatedAt: new Date("2026-06-22T21:05:00.000Z"),
        ...input,
      })),
    };
    const workflowFailureStore = {
      recordOutreachWorkflowFailure: vi.fn(async () => undefined),
    };

    await expect(
      sendApprovedOutreachEmail({
        prospectBusiness: prospectBusinessReadyForOutreach(),
        emailProvider: {
          send: vi.fn(async () => {
            throw providerFailure;
          }),
        },
        outreachEmailStore,
        suppressionStore: {
          getOutreachSuppressionStatus: vi.fn(async () => ({ status: "clear" as const })),
        },
        workflowFailureStore,
        actor: "operator",
        fromEmail: "Logan Sinclair <logan@example.com>",
        senderIdentity: "Logan Sinclair",
        postalAddress: "100 Main St, Beacon, NY 12508",
        optOutWording: "Reply no thanks and I will not contact you again.",
        approvalReason: "Operator approved this Draft Outreach for sending.",
      }),
    ).rejects.toThrow("Resend accepted no requests right now.");

    expect(outreachEmailStore.saveOutreachEmail).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      draftOutreachId: "draft-1",
      recipientEmailAddress: "hello@detail.example",
      provider: "resend",
      sendStatus: "failed",
      suppressionStatus: "clear",
      failureMetadata: {
        message: "Resend accepted no requests right now.",
        retryable: true,
        code: "email_provider_failure",
      },
    });
    expect(workflowFailureStore.recordOutreachWorkflowFailure).toHaveBeenCalledWith({
      prospectBusinessId: "prospect-1",
      failedStep: "outreach_email_send",
      errorSummary: "Resend accepted no requests right now.",
      retryable: true,
      provider: "resend",
    });
  });
});

function createOutreachEmailStore(): OutreachEmailStore {
  const emails: OutreachEmail[] = [];
  return {
    async saveOutreachEmail(input) {
      const now = new Date("2026-06-22T21:00:00.000Z");
      const email = {
        id: `outreach-email-${emails.length + 1}`,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      emails.push(email);
      return email;
    },
  };
}

function prospectBusinessReadyForOutreach(): ProspectBusinessDetail {
  return {
    id: "prospect-1",
    googlePlaceId: "places/detail-cafe",
    name: "Detail Cafe",
    formattedAddress: "1 Main St, Beacon, NY",
    categories: ["cafe"],
    prospectStatus: "outreach_ready_for_review",
    sourceData: { placeId: "places/detail-cafe" },
    firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
    firstDiscoveredRun: discoveryRunStub("run-1"),
    latestDiscoveredRun: discoveryRunStub("run-1"),
    appearanceHistory: [],
    contactEvidence: [
      {
        id: "contact-1",
        prospectBusinessId: "prospect-1",
        emailAddress: "hello@detail.example",
        sourceUrl: "https://detail.example/contact",
        sourceType: "business_website",
        confidence: 0.95,
        roleClassification: "role",
        outreachApprovalStatus: "approved",
        reason: "Published on the official contact page.",
        foundAt: new Date("2026-06-22T18:30:00.000Z"),
        approvedAt: new Date("2026-06-22T18:35:00.000Z"),
        approvedBy: "operator",
        approvalReason: "Operator verified this is the correct inbox.",
      },
    ],
    draftOutreach: {
      id: "draft-1",
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Detail Cafe",
      bodyText:
        "Hi Detail Cafe team,\nhttps://previews.example.com/published-previews/abc123/\nLogan Sinclair\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
      bodyHtml:
        "<p>Hi Detail Cafe team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
      claimsUsed: [
        {
          claim: "The current website could make contact details easier to find.",
          source: "website_assessment.safe_claims",
        },
      ],
      complianceNotes: ["Operator review is required before sending."],
      requiresOperatorReview: true,
      createdAt: new Date("2026-06-22T20:00:00.000Z"),
      updatedAt: new Date("2026-06-22T20:00:00.000Z"),
    },
    previewWebsite: {
      id: "preview-1",
      prospectBusinessId: "prospect-1",
      slug: "detail-cafe-prospect-1",
      status: "published",
      designPlan: {
        siteType: "multi_section",
        primaryGoal: "enquiry",
        targetCustomer: "People in Beacon looking for cafes.",
        pitchAngle: "modern_upgrade",
        sections: [],
        navigation: { style: "prominent_cta", items: [] },
        features: [],
        avoid: [],
        operatorReviewNotes: [],
      },
      contentJson: {},
      sourceReferences: [],
      buildMetadata: {
        builder: "svelte",
        command: "npm run build:previews",
        status: "built",
      },
      artifact: {
        sourceRoot: "previews/detail-cafe-prospect-1/source",
        staticRoot: "previews/detail-cafe-prospect-1/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      },
      operatorEditableFields: [],
      publication: {
        previewUrl: "https://previews.example.com/published-previews/abc123/",
        previewUrlPath: "/published-previews/abc123/",
        deploymentId: "abc123",
        buildId: "npm-run-build-previews",
        noindex: true,
        publishedAt: new Date("2026-06-22T19:00:00.000Z"),
        approvedBy: "operator",
        approvalReason: "Approved for publication.",
      },
      createdAt: new Date("2026-06-22T19:00:00.000Z"),
      updatedAt: new Date("2026-06-22T19:00:00.000Z"),
    },
    websiteAssessment: {
      id: "assessment-1",
      prospectBusinessId: "prospect-1",
      deterministicChecks: {
        pageLoad: "reachable",
        https: "valid",
        mobileViewport: "rendered",
        contactInformationFound: true,
        servicesFound: true,
        brokenAssetsOrConsoleErrors: false,
        thirdPartyOnlyPresence: false,
      },
      opportunityCategory: "outdated_or_low_quality",
      confidence: 0.77,
      summary: "The site is reachable, but key cafe details are hard to scan on mobile.",
      evidence: [],
      recommendedPitchAngle: "modern_upgrade",
      safeClaims: ["The current website could make contact details easier to find."],
      reviewNotes: [],
      previewEligibility: {
        eligibleByDefault: true,
        effectiveEligible: true,
        requiresOperatorReview: false,
        overriddenByOperator: false,
        reason: "This Opportunity Category is preview-eligible by default.",
      },
      assessedAt: new Date("2026-06-22T16:50:00.000Z"),
    },
  };
}

function discoveryRunStub(id: string) {
  return {
    id,
    source: "google_places" as const,
    mode: "place_search" as const,
    searchTerm: "coffee shop",
    searchLocation: { label: "Beacon, NY" },
    discoveryLimit: 10,
    status: "completed" as const,
    queryMetadata: {},
    resultMetadata: {},
  };
}
