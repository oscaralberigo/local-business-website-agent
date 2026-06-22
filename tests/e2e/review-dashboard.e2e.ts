import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AddressInfo } from "node:net";

import type { AuditEvent, AuditEventInput, AuditTrailGateway } from "../../src/audit/auditTrail.js";
import { createReviewDashboardApp } from "../../src/web/app.js";
import { InMemoryProspectRegistry } from "../../src/persistence/in-memory-prospect-registry.js";
import type { RuntimeConfiguration } from "../../src/config/runtimeConfiguration.js";
import type { BusinessDiscoverySource } from "../../src/discovery/types.js";
import type { BusinessContextResearcher } from "../../src/business-context/types.js";
import type { WebsiteReviewerAgent } from "../../src/website-assessment/types.js";
import type { ContactFinderAgent } from "../../src/contact-finder/types.js";
import type { OutreachDrafterAgent, EmailSendingProvider } from "../../src/outreach/types.js";
import type {
  PreviewArtifactStore,
  PreviewHost,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "../../src/preview-generation/types.js";

test("operator can review a mocked Prospect Business workflow and see audit visibility", async ({
  playwright,
}) => {
  const server = await startDashboardServer();
  const request = await playwright.request.newContext({ baseURL: server.baseUrl });

  try {
    await login(request);

    const discoveryResponse = await request.post("/api/discovery-runs", {
      data: {
        mode: "place_search",
        searchTerm: "coffee shop",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
    });
    expect(discoveryResponse.status()).toBe(201);
    const discoveryPayload = await discoveryResponse.json();
    const prospectBusinessId = discoveryPayload.discoveryRun.discoveredProspects[0].id as string;

    const discoveryRunsResponse = await request.get("/api/discovery-runs");
    expect(discoveryRunsResponse.status()).toBe(200);
    expect(await discoveryRunsResponse.text()).toContain("Detail Cafe");

    const prospectDetailResponse = await request.get(`/api/prospect-businesses/${prospectBusinessId}`);
    expect(prospectDetailResponse.status()).toBe(200);
    expect(await prospectDetailResponse.text()).toContain("places/detail-cafe");

    expect(
      (await request.post(`/api/prospect-businesses/${prospectBusinessId}/business-context-research`)).status(),
    ).toBe(201);

    expect(
      (await request.post(`/api/prospect-businesses/${prospectBusinessId}/website-assessment`, {
        data: {
          currentWebsiteUrl: "https://detail.example",
          deterministicChecks: {
            pageLoad: "reachable",
            https: "valid",
            mobileViewport: "rendered",
            contactInformationFound: true,
            servicesFound: true,
            brokenAssetsOrConsoleErrors: false,
            thirdPartyOnlyPresence: false,
          },
        },
      })).status(),
    ).toBe(201);

    const previewGenerationResponse = await request.post(
      `/api/prospect-businesses/${prospectBusinessId}/preview-website-generation`,
    );
    expect(previewGenerationResponse.status()).toBe(201);
    expect(await previewGenerationResponse.text()).toContain("ready_for_review");

    const previewPublicationResponse = await request.post(
      `/api/prospect-businesses/${prospectBusinessId}/preview-website/publication`,
      { data: { approvalReason: "Operator reviewed the Preview Website." } },
    );
    expect(previewPublicationResponse.status()).toBe(200);
    expect(await previewPublicationResponse.text()).toContain("published");

    const contactResponse = await request.post(
      `/api/prospect-businesses/${prospectBusinessId}/contact-finding`,
    );
    expect(contactResponse.status()).toBe(201);
    const contactPayload = await contactResponse.json();
    const contactEvidenceId = contactPayload.contactEvidence[0].id as string;

    expect(
      (await request.post(
        `/api/prospect-businesses/${prospectBusinessId}/contact-evidence/${contactEvidenceId}/approval`,
        { data: { reason: "Operator verified this is the right business inbox." } },
      )).status(),
    ).toBe(200);

    const draftResponse = await request.post(`/api/prospect-businesses/${prospectBusinessId}/draft-outreach`, {
      data: outreachSettings,
    });
    expect(draftResponse.status()).toBe(201);
    expect(await draftResponse.text()).toContain("Website preview for Detail Cafe");

    const sendResponse = await request.post(
      `/api/prospect-businesses/${prospectBusinessId}/outreach-email/send`,
      {
        data: {
          ...outreachSettings,
          fromEmail: "Logan Sinclair <logan@example.com>",
          approvalReason: "Operator reviewed the Draft Outreach.",
        },
      },
    );
    expect(sendResponse.status()).toBe(200);
    expect(await sendResponse.text()).toContain("sent");

    const finalDetailResponse = await request.get(`/api/prospect-businesses/${prospectBusinessId}`);
    expect(finalDetailResponse.status()).toBe(200);
    expect(await finalDetailResponse.text()).toContain("outreach_sent");

    const dashboardResponse = await request.get("/dashboard");
    expect(dashboardResponse.status()).toBe(200);
    const dashboardHtml = await dashboardResponse.text();
    expect(dashboardHtml).toContain("Audit Trail");
    expect(dashboardHtml).toContain("outreach.sent");
  } finally {
    await request.dispose();
    await server.close();
  }
});

async function startDashboardServer() {
  const app = createReviewDashboardApp({
    auditTrail: createInMemoryAuditTrail(),
    businessContextResearcher: detailCafeResearcher(),
    configuration: testConfiguration(),
    contactFinderAgent: detailCafeContactFinder(),
    discoverySource: discoverySourceWithDetailCafe(),
    emailProvider: detailCafeEmailProvider(),
    outreachDrafterAgent: detailCafeOutreachDrafter(),
    previewArtifactStore: detailCafePreviewArtifactStore(),
    previewHost: detailCafePreviewHost(),
    prospectRegistry: new InMemoryProspectRegistry(),
    websiteBuilderAgent: detailCafeWebsiteBuilder(),
    websiteDesignerAgent: detailCafeWebsiteDesigner(),
    websiteReviewerAgent: detailCafeWebsiteReviewer(),
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function login(request: APIRequestContext): Promise<void> {
  const loginPage = await request.get("/login");
  expect(loginPage.status()).toBe(200);
  expect(await loginPage.text()).toContain("Review Dashboard");

  const loginResponse = await request.post("/login", {
    form: {
      username: "operator",
      password: "correct-password",
    },
  });
  expect(loginResponse.status()).toBe(200);
  expect(await loginResponse.text()).toContain("Discovery Runs");
}

const outreachSettings = {
  senderIdentity: "Logan Sinclair",
  postalAddress: "100 Main St, Beacon, NY 12508",
  optOutWording: "Reply no thanks and I will not contact you again.",
};

function testConfiguration(): RuntimeConfiguration {
  return {
    environment: "test",
    port: 0,
    appBaseUrl: "http://127.0.0.1",
    previewBaseUrl: "https://previews.example.com",
    previewArtifactRoot: "previews",
    operatorUsername: "operator",
    operatorPassword: "correct-password",
    operatorSessionSecret: "test-session-secret-at-least-sixteen",
    databaseUrl: "postgres://example.invalid/local",
    databaseSsl: false,
    providers: {
      googlePlacesConfigured: false,
      openAiConfigured: false,
      resendConfigured: false,
    },
    reviewPolicy: {
      requireReviewBeforePreviewPublication: true,
      requireReviewBeforeOutreachSending: true,
    },
    discoveryLimit: 10,
  };
}

function discoverySourceWithDetailCafe(): BusinessDiscoverySource {
  return {
    async searchPlaces() {
      return [
        {
          googlePlaceId: "places/detail-cafe",
          name: "Detail Cafe",
          formattedAddress: "1 Main St, Beacon, NY",
          websiteUrl: "https://detail.example",
          phoneNumber: "+15555550100",
          categories: ["cafe"],
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
        evidence: [{ claim: "Contact details are hard to scan.", source: "mobile_screenshot" }],
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
        avoid: [],
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
        sourceFiles: [{ relativePath: "src/App.svelte", contents: "<main>Detail Cafe</main>" }],
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

function detailCafeOutreachDrafter(): OutreachDrafterAgent {
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
          `<p>${previewUrl}</p>`,
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
        complianceNotes: ["Operator review is required before sending."],
        requiresOperatorReview: true,
      };
    },
  };
}

function detailCafeEmailProvider(): EmailSendingProvider {
  return {
    async send() {
      return {
        provider: "resend",
        providerMessageId: "message-detail-cafe",
        sentAt: new Date("2026-06-22T21:00:00.000Z"),
      };
    },
  };
}

function createInMemoryAuditTrail(): AuditTrailGateway {
  const events: AuditEvent[] = [];
  return {
    async verifyConnection() {
      return { connected: true };
    },
    async record(event: AuditEventInput) {
      events.unshift({
        id: events.length + 1,
        occurredAt: new Date("2026-06-22T21:00:00.000Z"),
        metadata: {},
        ...event,
      });
    },
    async listRecent(limit = 20) {
      return events.slice(0, limit);
    },
  };
}
