import { describe, expect, it } from "vitest";

import {
  createTemplateOutreachDrafterAgent,
  draftOutreachForProspect,
  evaluateOutreachCompliance,
} from "../src/outreach/outreach-drafter-agent.js";
import type { ProspectBusinessDetail } from "../src/discovery/types.js";

describe("Outreach Drafter Agent", () => {
  it("drafts structured first-website outreach with a published Preview URL and required footer details", async () => {
    const draft = await draftOutreachForProspect({
      prospectBusiness: prospectBusiness({
        websiteAssessment: {
          opportunityCategory: "no_website",
          safeClaims: ["I could not find a standalone website for Example Bakery."],
        },
      }),
      drafterAgent: createTemplateOutreachDrafterAgent(),
      senderIdentity: "Logan Sinclair, independent website designer",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
    });

    expect(draft).toMatchObject({
      prospectBusinessId: "prospect-1",
      subject: "Website preview for Example Bakery",
      claimsUsed: [
        {
          claim: "I could not find a standalone website for Example Bakery.",
          source: "website_assessment.safe_claims",
        },
      ],
      requiresOperatorReview: true,
    });
    expect(draft.bodyText).toContain("first website concept");
    expect(draft.bodyText).toContain("https://previews.example.com/published-previews/abc123/");
    expect(draft.bodyText).toContain("Logan Sinclair, independent website designer");
    expect(draft.bodyText).toContain("100 Main St, Beacon, NY 12508");
    expect(draft.bodyText).toContain("Reply no thanks and I will not contact you again.");
    expect(draft.bodyHtml).toContain("https://previews.example.com/published-previews/abc123/");
    expect(draft.complianceNotes).toContain("Operator review is required before sending.");
  });

  it("blocks outreach when compliance requirements fail", () => {
    const decision = evaluateOutreachCompliance({
      prospectBusiness: prospectBusiness({
        prospectStatus: "contact_unavailable",
        contactEvidence: [],
        previewWebsite: {
          status: "ready_for_review",
        },
      }),
      draft: {
        bodyText: "No footer here.",
        bodyHtml: "<p>No footer here.</p>",
        claimsUsed: [{ claim: "Unsupported claim.", source: "operator_note" }],
      },
      senderIdentity: "Logan Sinclair, independent website designer",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
      suppressionStatus: "suppressed",
      doNotContact: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual([
      "Approved suitable Contact Evidence is required before outreach.",
      "Published Preview URL is required before outreach.",
      "Draft Outreach must include sender identity, postal address, and opt-out wording.",
      "Draft Outreach claims must all map to safe Supported Claims.",
      "Suppressed prospects cannot receive outreach.",
      "Do-not-contact prospects cannot receive outreach.",
    ]);
  });

  it("blocks drafts that omit the published Preview URL from either email body", () => {
    const decision = evaluateOutreachCompliance({
      prospectBusiness: prospectBusiness(),
      draft: {
        bodyText:
          "Hi Example Bakery team,\nLogan Sinclair, independent website designer\n100 Main St, Beacon, NY 12508\nReply no thanks and I will not contact you again.",
        bodyHtml:
          "<p>Hi Example Bakery team</p><p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair, independent website designer</p><p>100 Main St, Beacon, NY 12508</p><p>Reply no thanks and I will not contact you again.</p>",
        claimsUsed: [],
      },
      senderIdentity: "Logan Sinclair, independent website designer",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("Draft Outreach must include the published Preview URL.");
  });

  it("blocks drafts that split footer requirements across text and HTML bodies", () => {
    const decision = evaluateOutreachCompliance({
      prospectBusiness: prospectBusiness(),
      draft: {
        bodyText:
          "https://previews.example.com/published-previews/abc123/\nLogan Sinclair, independent website designer\nReply no thanks and I will not contact you again.",
        bodyHtml:
          "<p>https://previews.example.com/published-previews/abc123/</p><p>Logan Sinclair, independent website designer</p><p>100 Main St, Beacon, NY 12508</p>",
        claimsUsed: [],
      },
      senderIdentity: "Logan Sinclair, independent website designer",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "Draft Outreach must include sender identity, postal address, and opt-out wording.",
    );
  });
});

function prospectBusiness(overrides: Record<string, unknown> = {}): ProspectBusinessDetail {
  return {
    id: "prospect-1",
    googlePlaceId: "places/example-bakery",
    name: "Example Bakery",
    formattedAddress: "1 Bakery Way, Beacon, NY",
    categories: ["bakery"],
    prospectStatus: "drafting_outreach",
    sourceData: { placeId: "places/example-bakery" },
    firstSeenAt: new Date("2026-06-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-06-21T11:00:00.000Z"),
    firstDiscoveredRun: {
      id: "run-1",
      source: "google_places",
      mode: "place_search",
      searchTerm: "bakery",
      searchLocation: { label: "Beacon, NY" },
      discoveryLimit: 10,
      status: "completed",
      queryMetadata: {},
      resultMetadata: {},
    },
    latestDiscoveredRun: {
      id: "run-1",
      source: "google_places",
      mode: "place_search",
      searchTerm: "bakery",
      searchLocation: { label: "Beacon, NY" },
      discoveryLimit: 10,
      status: "completed",
      queryMetadata: {},
      resultMetadata: {},
    },
    appearanceHistory: [],
    contactEvidence: [
      {
        id: "contact-1",
        prospectBusinessId: "prospect-1",
        emailAddress: "hello@example-bakery.example",
        sourceUrl: "https://example-bakery.example/contact",
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
    previewWebsite: {
      id: "preview-1",
      prospectBusinessId: "prospect-1",
      slug: "example-bakery-prospect-1",
      status: "published",
      designPlan: {
        siteType: "multi_section",
        primaryGoal: "enquiry",
        targetCustomer: "People in Beacon looking for baked goods.",
        pitchAngle: "first_website",
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
        sourceRoot: "previews/example-bakery-prospect-1/source",
        staticRoot: "previews/example-bakery-prospect-1/dist",
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
        pageLoad: "not_checked",
        https: "not_checked",
        mobileViewport: "not_checked",
        contactInformationFound: false,
        servicesFound: false,
        brokenAssetsOrConsoleErrors: false,
        thirdPartyOnlyPresence: false,
      },
      opportunityCategory: "no_website",
      confidence: 0.82,
      summary: "No standalone website was found.",
      evidence: [],
      recommendedPitchAngle: "first_website",
      safeClaims: ["I could not find a standalone website for Example Bakery."],
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
    ...overrides,
  } as unknown as ProspectBusinessDetail;
}
