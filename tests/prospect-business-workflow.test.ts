import { describe, expect, it, vi } from "vitest";

import type { AuditEventInput, AuditTrailGateway } from "../src/audit/auditTrail.js";
import type { BusinessContextResearcher } from "../src/business-context/types.js";
import type { ContactFinderAgent } from "../src/contact-finder/types.js";
import type { BusinessDiscoverySource, StartDiscoveryRunInput } from "../src/discovery/types.js";
import type { EmailSendingProvider } from "../src/outreach/types.js";
import { InMemoryProspectRegistry } from "../src/persistence/in-memory-prospect-registry.js";
import type {
  PreviewArtifactStore,
  PreviewHost,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "../src/preview-generation/types.js";
import { runDiscovery } from "../src/discovery/run-discovery.js";
import { runProspectBusinessWorkflow } from "../src/workflow/prospect-business-workflow.js";
import type { WebsiteExplorerAgent, WebsiteReviewerAgent } from "../src/website-assessment/types.js";

describe("Prospect Business workflow", () => {
  it("completes a mocked eligible Prospect Business lifecycle from Discovery Run to sent Outreach Email", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      })),
    };

    const { auditTrail, result } = await runDetailCafeWorkflow({
      emailProvider,
    });

    expect(result.discoveryRun.status).toBe("completed");
    expect(result.prospectBusiness).toMatchObject({
      name: "Detail Cafe",
      prospectStatus: "outreach_sent",
      websiteAssessment: {
        opportunityCategory: "outdated_or_low_quality",
      },
      previewWebsite: {
        status: "published",
        publication: {
          previewUrl: "https://previews.example.com/published-previews/detail-cafe/",
          noindex: true,
        },
      },
      draftOutreach: {
        subject: "Website preview for Detail Cafe",
      },
    });
    expect(result.prospectBusiness.contactEvidence).toEqual([
      expect.objectContaining({
        emailAddress: "hello@detail.example",
        outreachApprovalStatus: "approved",
      }),
    ]);
    expect(result.prospectBusiness.outreachEmails).toEqual([
      expect.objectContaining({
        recipientEmailAddress: "hello@detail.example",
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sendStatus: "sent",
      }),
    ]);
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
    expect(auditTrail.events.map((event) => event.eventType)).toEqual([
      "discovery_run.completed",
      "business_context.researched",
      "website_assessment.completed",
      "preview_website.generated",
      "preview_website.published",
      "contact_evidence.approved",
      "draft_outreach.created",
      "outreach_email.sent",
    ]);
  });

  it("runs the Website Explorer Agent before the Website Reviewer Agent in Website Assessment", async () => {
    const callOrder: string[] = [];
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      })),
    };
    const websiteExplorerAgent: WebsiteExplorerAgent = {
      explore: vi.fn(async () => {
        callOrder.push("explorer");
        return {
          evidence: [
            {
              pageUrl: "https://detail.example/",
              htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/landing.html",
              reviewerReadyTextExcerpt: "Detail Cafe serves house-roasted coffee.",
              desktopScreenshot: {
                uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-desktop.png",
                capturedAt: new Date("2026-06-22T18:00:00.000Z"),
              },
              mobileScreenshot: {
                uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-mobile.png",
                capturedAt: new Date("2026-06-22T18:01:00.000Z"),
              },
              deterministicChecks: {
                pageLoad: "reachable" as const,
                https: "valid" as const,
                mobileViewport: "rendered" as const,
                contactInformationFound: true,
                servicesFound: true,
                brokenAssetsOrConsoleErrors: false,
                thirdPartyOnlyPresence: false,
              },
              browserObservations: ["Landing page names the cafe and menu."],
            },
          ],
          reviewContext: {
            currentWebsiteUrl: "https://detail.example/",
            htmlText: "Detail Cafe serves house-roasted coffee.",
            deterministicChecks: {
              pageLoad: "reachable" as const,
              https: "valid" as const,
              mobileViewport: "rendered" as const,
              contactInformationFound: true,
              servicesFound: true,
              brokenAssetsOrConsoleErrors: false,
              thirdPartyOnlyPresence: false,
            },
            desktopScreenshot: {
              uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-desktop.png",
              capturedAt: new Date("2026-06-22T18:00:00.000Z"),
            },
            mobileScreenshot: {
              uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-mobile.png",
              capturedAt: new Date("2026-06-22T18:01:00.000Z"),
            },
          },
        };
      }),
    };
    const websiteReviewerAgent: WebsiteReviewerAgent = {
      review: vi.fn(async () => {
        callOrder.push("reviewer");
        return {
          opportunityCategory: "outdated_or_low_quality" as const,
          confidence: 0.85,
          summary: "The current website is reachable, but key contact details are hard to scan on mobile.",
          evidence: [
            {
              claim: "The mobile page makes contact details hard to scan.",
              source: "mobile_screenshot" as const,
            },
          ],
          recommendedPitchAngle: "modern_upgrade" as const,
          outreachSafeClaims: ["The current website could make contact details easier to find."],
          operatorReviewNotes: [],
        };
      }),
    };

    const { result } = await runDetailCafeWorkflow({
      emailProvider,
      websiteExplorerAgent,
      websiteReviewerAgent,
    });

    expect(callOrder).toEqual(["explorer", "reviewer"]);
    expect(websiteExplorerAgent.explore).toHaveBeenCalledWith({
      prospectBusiness: expect.objectContaining({
        name: "Detail Cafe",
        websiteUrl: "https://detail.example",
      }),
      currentWebsiteUrl: "https://detail.example",
      assessmentRunId: expect.any(String),
      explorationBudget: expect.objectContaining({ maxPages: 3, maxScreenshots: 6 }),
      reviewContextBudget: expect.objectContaining({ maxTextCharacters: expect.any(Number) }),
    });
    expect(websiteReviewerAgent.review).toHaveBeenCalledWith({
      prospectBusiness: expect.objectContaining({ name: "Detail Cafe" }),
      input: expect.objectContaining({
        currentWebsiteUrl: "https://detail.example/",
        htmlText: "Detail Cafe serves house-roasted coffee.",
        websiteExplorationEvidence: [
          expect.objectContaining({
            pageUrl: "https://detail.example/",
            browserObservations: ["Landing page names the cafe and menu."],
          }),
        ],
      }),
    });
    expect(result.prospectBusiness.websiteAssessment).toMatchObject({
      websiteExplorationEvidence: [
        {
          pageUrl: "https://detail.example/",
          htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/landing.html",
        },
      ],
    });
  });

  it("records rediscovery as a new Discovery Appearance without rerunning the completed workflow", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      })),
    };
    const { registry, result } = await runDetailCafeWorkflow({ emailProvider });

    const rediscoveryRun = await runDiscovery({
      request: {
        ...discoveryRequest,
        searchTerm: "espresso bar",
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/detail-cafe",
              name: "Detail Cafe and Bakery",
              formattedAddress: "9 Updated Main St, Beacon, NY",
              websiteUrl: "https://new-detail.example",
              categories: ["cafe", "bakery"],
              sourcePayload: { version: "rediscovered" },
            },
          ];
        },
      },
    });

    const prospectBusiness = await registry.getProspectBusinessDetail(result.prospectBusiness.id);

    expect(rediscoveryRun.discoveredProspects[0]?.id).toBe(result.prospectBusiness.id);
    expect(prospectBusiness).toMatchObject({
      name: "Detail Cafe and Bakery",
      formattedAddress: "9 Updated Main St, Beacon, NY",
      websiteUrl: "https://new-detail.example",
      prospectStatus: "outreach_sent",
      previewWebsite: {
        status: "published",
      },
      draftOutreach: {
        subject: "Website preview for Detail Cafe",
      },
    });
    expect(prospectBusiness.appearanceHistory.map((appearance) => appearance.discoveryRun.id)).toEqual([
      result.discoveryRun.id,
      rediscoveryRun.id,
    ]);
    expect(prospectBusiness.appearanceHistory.map((appearance) => appearance.providerPayload)).toEqual([
      { id: "places/detail-cafe" },
      { version: "rediscovered" },
    ]);
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
  });

  it("marks Contact Unavailable and blocks outreach by default", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(),
    };

    const { result } = await runDetailCafeWorkflow({
      emailProvider,
      contactFinderAgent: {
        async findContact() {
          return [];
        },
      },
    });

    expect(result.prospectBusiness).toMatchObject({
      prospectStatus: "contact_unavailable",
      draftOutreach: undefined,
      outreachEmails: [],
    });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it("keeps manual Reply Tracking and Work Conversion hooks available after Outreach Email sending", async () => {
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(async () => ({
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      })),
    };
    const { registry, result } = await runDetailCafeWorkflow({ emailProvider });

    const repliedProspect = await registry.recordManualReply({
      prospectBusinessId: result.prospectBusiness.id,
      repliedAt: new Date("2026-06-23T14:00:00.000Z"),
      summary: "Detail Cafe asked about next steps.",
      actor: "operator",
    });
    const convertedProspect = await registry.recordManualWorkConversion({
      prospectBusinessId: result.prospectBusiness.id,
      conversionStatus: "work_won",
      estimatedValueCents: 250000,
      notes: "Operator recorded a paid website project.",
      actor: "operator",
    });

    expect(repliedProspect).toMatchObject({
      prospectStatus: "replied",
      replyTracking: {
        summary: "Detail Cafe asked about next steps.",
        recordedBy: "operator",
      },
    });
    expect(convertedProspect).toMatchObject({
      prospectStatus: "work_won",
      workConversion: {
        conversionStatus: "work_won",
        estimatedValueCents: 250000,
        recordedBy: "operator",
      },
    });
  });

  it("blocks auto-publication at the Compliance Gate even when Review Policy disables Human Review", async () => {
    const registry = new InMemoryProspectRegistry();
    const previewHost = detailCafePreviewHost();
    previewHost.publish = vi.fn(previewHost.publish);
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(),
    };

    await expect(
      runDetailCafeWorkflow({
        registry,
        emailProvider,
        previewHost,
        businessContextResearcher: {
          async research() {
            return {
              researchMode: "expanded",
              sources: [
                {
                  id: "source-1",
                  sourceType: "business_website",
                  title: "Detail Cafe website",
                  url: "https://detail.example",
                  termsCompliance: {
                    allowed: true,
                    checkedAt: new Date("2026-06-22T15:00:00.000Z"),
                  },
                },
              ],
              facts: [
                {
                  id: "fact-1",
                  sourceId: "source-1",
                  label: "Menu specialty",
                  value: "Detail Cafe serves house-roasted coffee.",
                  allowedForGeneration: true,
                },
              ],
              excludedResearchData: [
                {
                  sourceId: "source-1",
                  label: "Personal contact",
                  valueSummary: "A staff member's personal email address.",
                  reason: "personal_contact",
                },
              ],
            };
          },
        },
      }),
    ).rejects.toThrow("Forbidden Research Data must be excluded before publication.");

    const failedProspect = await registry.getProspectBusinessDetail(
      (await registry.listDiscoveryRuns())[0]!.discoveredProspects[0]!.id,
    );
    expect(failedProspect.prospectStatus).toBe("failed");
    expect(failedProspect.workflowFailures).toEqual([
      expect.objectContaining({
        failedStep: "preview_publication_compliance_gate",
        errorSummary: "Forbidden Research Data must be excluded before publication.",
        retryable: false,
      }),
    ]);
    expect(previewHost.publish).not.toHaveBeenCalled();
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it("blocks auto-send at the Compliance Gate even when Review Policy disables Human Review", async () => {
    const registry = new InMemoryProspectRegistry();
    const emailProvider: EmailSendingProvider = {
      send: vi.fn(),
    };

    await expect(
      runDetailCafeWorkflow({
        registry,
        emailProvider,
        outreachDrafterAgent: {
          async draft({ prospectBusiness }) {
            return {
              prospectBusinessId: prospectBusiness.id,
              subject: "Website preview for Detail Cafe",
              bodyText: "Hi Detail Cafe team,\nUnsupported claim.",
              bodyHtml: "<p>Hi Detail Cafe team,</p><p>Unsupported claim.</p>",
              claimsUsed: [
                {
                  claim: "Unsupported claim.",
                  source: "operator_note",
                },
              ],
              complianceNotes: [],
              requiresOperatorReview: false,
            };
          },
        },
      }),
    ).rejects.toThrow("Draft Outreach must include the published Preview URL.");

    const failedProspect = await registry.getProspectBusinessDetail(
      (await registry.listDiscoveryRuns())[0]!.discoveredProspects[0]!.id,
    );
    expect(failedProspect.prospectStatus).toBe("failed");
    expect(failedProspect.workflowFailures).toEqual([
      expect.objectContaining({
        failedStep: "outreach_compliance_gate",
        retryable: false,
      }),
    ]);
    expect(emailProvider.send).not.toHaveBeenCalled();
  });
});

const discoveryRequest: StartDiscoveryRunInput = {
  mode: "place_search",
  searchTerm: "independent coffee shop",
  searchLocation: {
    label: "Beacon, NY",
    latitude: 41.5048,
    longitude: -73.9696,
    radiusMeters: 2000,
  },
  discoveryLimit: 1,
};

function discoverySourceWithDetailCafe(): BusinessDiscoverySource {
  return {
    async searchPlaces() {
      return [
        {
          googlePlaceId: "places/detail-cafe",
          name: "Detail Cafe",
          formattedAddress: "1 Main St, Beacon, NY",
          latitude: 41.5,
          longitude: -73.96,
          websiteUrl: "https://detail.example",
          phoneNumber: "+15555550100",
          categories: ["cafe"],
          rating: 4.7,
          userRatingCount: 118,
          sourcePayload: { id: "places/detail-cafe" },
        },
      ];
    },
  };
}

function detailCafeResearcher(): BusinessContextResearcher {
  return {
    async research() {
      return {
        researchMode: "expanded",
        sources: [
          {
            id: "source-1",
            sourceType: "business_website",
            title: "Detail Cafe website",
            url: "https://detail.example",
            termsCompliance: {
              allowed: true,
              checkedAt: new Date("2026-06-22T15:00:00.000Z"),
            },
          },
        ],
        facts: [
          {
            id: "fact-1",
            sourceId: "source-1",
            label: "Menu specialty",
            value: "Detail Cafe serves house-roasted coffee.",
            allowedForGeneration: true,
          },
        ],
        excludedResearchData: [],
      };
    },
  };
}

function detailCafeWebsiteReviewer(): WebsiteReviewerAgent {
  return {
    async review() {
      return {
        opportunityCategory: "outdated_or_low_quality",
        confidence: 0.85,
        summary: "The current website is reachable, but key contact details are hard to scan on mobile.",
        evidence: [
          {
            claim: "The mobile page makes contact details hard to scan.",
            source: "mobile_screenshot",
          },
        ],
        recommendedPitchAngle: "modern_upgrade",
        outreachSafeClaims: ["The current website could make contact details easier to find."],
        operatorReviewNotes: [],
      };
    },
  };
}

function detailCafeWebsiteDesigner(): WebsiteDesignerAgent {
  return {
    async design() {
      return {
        siteType: "multi_section",
        primaryGoal: "menu_view",
        targetCustomer: "People in Beacon looking for coffee before visiting.",
        pitchAngle: "modern_upgrade",
        sections: [
          {
            id: "hero",
            title: "Welcome",
            purpose: "Make the business clear immediately.",
            requiredEvidence: ["Detail Cafe serves house-roasted coffee."],
            contentGuidance: "Lead with the cafe name and a concise menu-oriented call to action.",
          },
        ],
        navigation: { style: "prominent_cta", items: ["Menu", "Visit"] },
        features: [],
        avoid: ["Do not invent prices, hours, reviews, awards, credentials, or testimonials."],
        operatorReviewNotes: [],
      };
    },
  };
}

function detailCafeWebsiteBuilder(): WebsiteBuilderAgent {
  return {
    async build() {
      return {
        contentJson: {
          hero: {
            headline: "Detail Cafe",
            supportedClaim: "Detail Cafe serves house-roasted coffee.",
          },
        },
        sourceFiles: [
          {
            relativePath: "src/App.svelte",
            contents: "<main><h1>Detail Cafe</h1></main>",
          },
        ],
        staticAssets: [
          {
            relativePath: "dist/index.html",
            contents:
              "<!doctype html><meta name=\"robots\" content=\"noindex\"><main>Detail Cafe</main>",
          },
        ],
        buildMetadata: {
          builder: "svelte",
          command: "npm run build:previews",
          status: "built",
        },
      };
    },
  };
}

function detailCafePreviewArtifactStore(): PreviewArtifactStore {
  return {
    async writeArtifacts() {
      return {
        sourceRoot: "detail-cafe/source",
        staticRoot: "detail-cafe/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      };
    },
  };
}

function detailCafePreviewHost(): PreviewHost {
  return {
    async publish() {
      return {
        previewUrl: "https://previews.example.com/published-previews/detail-cafe/",
        previewUrlPath: "/published-previews/detail-cafe/",
        deploymentId: "deployment-detail-cafe",
        buildId: "npm-run-build-previews",
        noindex: true,
        publishedAt: new Date("2026-06-22T19:00:00.000Z"),
        approvedBy: "",
        approvalReason: "",
      };
    },
    async unpublish() {},
  };
}

function detailCafeContactFinder(): ContactFinderAgent {
  return {
    async findContact() {
      return [
        {
          emailAddress: "hello@detail.example",
          sourceUrl: "https://detail.example/contact",
          sourceType: "business_website",
          confidence: 0.95,
          roleClassification: "role",
          acquisitionMethod: "published",
          reason: "Published on the official contact page.",
        },
      ];
    },
  };
}

async function runDetailCafeWorkflow(overrides: {
  registry?: InMemoryProspectRegistry;
  auditTrail?: AuditTrailGateway & { events: AuditEventInput[] };
  businessContextResearcher?: BusinessContextResearcher;
  contactFinderAgent?: ContactFinderAgent;
  emailProvider: EmailSendingProvider;
  outreachDrafterAgent?: Parameters<typeof runProspectBusinessWorkflow>[0]["outreachDrafterAgent"];
  previewHost?: PreviewHost;
  websiteExplorerAgent?: WebsiteExplorerAgent;
  websiteReviewerAgent?: WebsiteReviewerAgent;
}) {
  const registry = overrides.registry ?? new InMemoryProspectRegistry();
  const auditTrail = overrides.auditTrail ?? createInMemoryAuditTrail();
  const result = await runProspectBusinessWorkflow({
    discovery: {
      request: discoveryRequest,
      discoverySource: discoverySourceWithDetailCafe(),
    },
    registry,
    auditTrail,
    businessContextResearcher: overrides.businessContextResearcher ?? detailCafeResearcher(),
    websiteExplorerAgent: overrides.websiteExplorerAgent,
    websiteReviewerAgent: overrides.websiteReviewerAgent ?? detailCafeWebsiteReviewer(),
    websiteDesignerAgent: detailCafeWebsiteDesigner(),
    websiteBuilderAgent: detailCafeWebsiteBuilder(),
    previewArtifactStore: detailCafePreviewArtifactStore(),
    previewHost: overrides.previewHost ?? detailCafePreviewHost(),
    contactFinderAgent: overrides.contactFinderAgent ?? detailCafeContactFinder(),
    outreachDrafterAgent: overrides.outreachDrafterAgent ?? detailCafeOutreachDrafter(),
    emailProvider: overrides.emailProvider,
    reviewPolicy: {
      requireReviewBeforePreviewPublication: false,
      requireReviewBeforeOutreachSending: false,
    },
    operator: {
      actor: "operator",
      autoApproveContactEvidence: true,
    },
    outreachSettings: {
      fromEmail: "Logan Sinclair <logan@example.com>",
      senderIdentity: "Logan Sinclair",
      postalAddress: "100 Main St, Beacon, NY 12508",
      optOutWording: "Reply no thanks and I will not contact you again.",
    },
  });

  return { auditTrail, registry, result };
}

function detailCafeOutreachDrafter(): Parameters<typeof runProspectBusinessWorkflow>[0]["outreachDrafterAgent"] {
  return {
    async draft({ prospectBusiness, senderIdentity, postalAddress, optOutWording }) {
      const previewUrl = prospectBusiness.previewWebsite?.publication?.previewUrl ?? "";
      return {
        prospectBusinessId: prospectBusiness.id,
        subject: "Website preview for Detail Cafe",
        bodyText: [
          "Hi Detail Cafe team,",
          "The current website could make contact details easier to find.",
          previewUrl,
          senderIdentity,
          postalAddress,
          optOutWording,
        ].join("\n"),
        bodyHtml: [
          "<p>Hi Detail Cafe team,</p>",
          "<p>The current website could make contact details easier to find.</p>",
          `<p><a href="${previewUrl}">${previewUrl}</a></p>`,
          `<p>${senderIdentity}</p>`,
          `<p>${postalAddress}</p>`,
          `<p>${optOutWording}</p>`,
        ].join(""),
        claimsUsed: [
          {
            claim: "The current website could make contact details easier to find.",
            source: "website_assessment.safe_claims",
          },
        ],
        complianceNotes: ["Review Policy allowed automatic sending after Compliance Gate checks."],
        requiresOperatorReview: false,
      };
    },
  };
}

function createInMemoryAuditTrail(): AuditTrailGateway & { events: AuditEventInput[] } {
  const events: AuditEventInput[] = [];
  return {
    events,
    async verifyConnection() {
      return { connected: true };
    },
    async record(event) {
      events.push(event);
    },
    async listRecent() {
      return events.map((event, index) => ({
        id: index + 1,
        occurredAt: new Date("2026-06-22T21:00:00.000Z"),
        metadata: {},
        ...event,
      }));
    },
  };
}
