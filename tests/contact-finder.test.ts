import { describe, expect, it } from "vitest";

import {
  createContactFinderAgent,
  findContactEvidenceForProspect,
} from "../src/contact-finder/contact-finder-agent.js";
import type { ContactSearchSource } from "../src/contact-finder/types.js";
import { runDiscovery } from "../src/discovery/run-discovery.js";
import { InMemoryProspectRegistry } from "../src/persistence/in-memory-prospect-registry.js";

describe("Contact Finder Agent", () => {
  it("searches official business pages before approved profile and search-result sources", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoveryRun = await runDiscovery({
      request: {
        mode: "place_search",
        searchTerm: "salon",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/contact-salon",
              name: "Contact Salon",
              websiteUrl: "https://contact-salon.example",
              categories: ["salon"],
              sourcePayload: { placeId: "places/contact-salon" },
            },
          ];
        },
      },
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;
    const calls: string[] = [];
    const searchSources: ContactSearchSource[] = [
      {
        sourceType: "official_search_result",
        async search() {
          calls.push("official_search_result");
          return [
            {
              emailAddress: "search@contact-salon.example",
              sourceUrl: "https://contact-salon.example/search-result",
              sourceType: "official_search_result",
              confidence: 0.82,
              roleClassification: "role",
              acquisitionMethod: "published",
              reason: "Published on an official search-result landing page.",
            },
          ];
        },
      },
      {
        sourceType: "business_website",
        async search() {
          calls.push("business_website");
          return [
            {
              emailAddress: "hello@contact-salon.example",
              sourceUrl: "https://contact-salon.example/contact",
              sourceType: "business_website",
              confidence: 0.96,
              roleClassification: "role",
              acquisitionMethod: "published",
              reason: "Published on the official business contact page.",
            },
          ];
        },
      },
    ];

    const contactEvidence = await findContactEvidenceForProspect({
      prospectBusinessId,
      contactFinderAgent: createContactFinderAgent({ searchSources }),
      contactEvidenceStore: registry,
      prospectRegistry: registry,
    });

    expect(calls).toEqual(["business_website"]);
    expect(contactEvidence).toMatchObject([
      {
        emailAddress: "hello@contact-salon.example",
        sourceUrl: "https://contact-salon.example/contact",
        sourceType: "business_website",
        confidence: 0.96,
        roleClassification: "role",
        outreachApprovalStatus: "pending_operator_approval",
        reason: "Published on the official business contact page.",
      },
    ]);

    const pendingProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(pendingProspect.prospectStatus).toBe("finding_contact");
    expect(pendingProspect.contactEvidence).toHaveLength(1);

    await registry.approveContactEvidence({
      prospectBusinessId,
      contactEvidenceId: contactEvidence[0]!.id,
      actor: "operator",
      reason: "Operator verified this is the preferred business inbox.",
      approvedAt: new Date("2026-06-22T18:00:00.000Z"),
    });

    const approvedProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(approvedProspect.prospectStatus).toBe("drafting_outreach");
    expect(approvedProspect.contactEvidence).toEqual([
      expect.objectContaining({
        id: contactEvidence[0]!.id,
        outreachApprovalStatus: "approved",
        approvedBy: "operator",
        approvalReason: "Operator verified this is the preferred business inbox.",
      }),
    ]);

    await findContactEvidenceForProspect({
      prospectBusinessId,
      contactEvidenceStore: registry,
      prospectRegistry: registry,
      contactFinderAgent: {
        async findContact() {
          return [];
        },
      },
    });

    const rerunProspect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(rerunProspect.prospectStatus).toBe("drafting_outreach");
    expect(rerunProspect.contactEvidence).toEqual([
      expect.objectContaining({
        id: contactEvidence[0]!.id,
        outreachApprovalStatus: "approved",
      }),
    ]);
  });

  it("does not store guessed emails and marks Contact Unavailable when only unsuitable contacts are found", async () => {
    const registry = new InMemoryProspectRegistry();
    const discoveryRun = await runDiscovery({
      request: {
        mode: "place_search",
        searchTerm: "restaurant",
        searchLocation: { label: "Beacon, NY" },
        discoveryLimit: 1,
      },
      registry,
      discoverySource: {
        async searchPlaces() {
          return [
            {
              googlePlaceId: "places/no-contact-restaurant",
              name: "No Contact Restaurant",
              websiteUrl: "https://no-contact-restaurant.example",
              categories: ["restaurant"],
              sourcePayload: { placeId: "places/no-contact-restaurant" },
            },
          ];
        },
      },
    });
    const prospectBusinessId = discoveryRun.discoveredProspects[0]!.id;

    const contactEvidence = await findContactEvidenceForProspect({
      prospectBusinessId,
      contactEvidenceStore: registry,
      prospectRegistry: registry,
      contactFinderAgent: createContactFinderAgent({
        searchSources: [
          {
            sourceType: "business_website",
            async search() {
              return [
                {
                  emailAddress: "owner@personal-mail.example",
                  sourceUrl: "https://no-contact-restaurant.example/team",
                  sourceType: "business_website",
                  confidence: 0.68,
                  roleClassification: "personal",
                  acquisitionMethod: "published",
                  reason: "Published on a staff biography rather than as a business outreach path.",
                },
              ];
            },
          },
          {
            sourceType: "official_search_result",
            async search() {
              return [
                {
                  emailAddress: "info@no-contact-restaurant.example",
                  sourceUrl: "https://search.example/no-contact-restaurant",
                  sourceType: "official_search_result",
                  confidence: 0.2,
                  roleClassification: "role",
                  acquisitionMethod: "guessed",
                  reason: "Pattern-generated from the business domain, not found as published evidence.",
                },
              ];
            },
          },
        ],
      }),
    });

    expect(contactEvidence).toEqual([
      expect.objectContaining({
        emailAddress: "owner@personal-mail.example",
        roleClassification: "personal",
        outreachApprovalStatus: "blocked",
      }),
    ]);
    expect(contactEvidence.map((evidence) => evidence.emailAddress)).not.toContain(
      "info@no-contact-restaurant.example",
    );

    const prospect = await registry.getProspectBusinessDetail(prospectBusinessId);
    expect(prospect.prospectStatus).toBe("contact_unavailable");
    expect(prospect.contactEvidence).toEqual(contactEvidence);
  });
});
