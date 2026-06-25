import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FileSystemWebsiteExplorationArtifactStore } from "../src/website-assessment/file-system-website-exploration-artifact-store.js";
import {
  createLandingPageWebsiteExplorerAgent,
  type WebsiteLandingPageBrowser,
} from "../src/website-assessment/website-explorer-agent.js";

describe("Website Explorer Agent", () => {
  it("captures landing-page Website Exploration Evidence through a bounded browser adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "website-explorer-agent-"));
    const browser: WebsiteLandingPageBrowser = {
      captureLandingPage: vi.fn(async () => ({
        pageUrl: "https://detail.example/",
        rawHtml: "<!doctype html><main><h1>Detail Cafe</h1><a href=\"/menu\">Menu</a></main>",
        visibleText: "Detail Cafe Menu Espresso Pastries",
        desktopScreenshot: {
          contents: Buffer.from("desktop screenshot"),
          capturedAt: new Date("2026-06-22T18:00:00.000Z"),
        },
        mobileScreenshot: {
          contents: Buffer.from("mobile screenshot"),
          capturedAt: new Date("2026-06-22T18:01:00.000Z"),
        },
        deterministicChecks: {
          pageLoad: "reachable" as const,
          https: "valid" as const,
          mobileViewport: "rendered" as const,
          contactInformationFound: false,
          servicesFound: true,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
        browserObservations: ["The landing page exposes a menu link but no clear phone number."],
      })),
    };
    const explorerAgent = createLandingPageWebsiteExplorerAgent({
      browser,
      artifactStore: new FileSystemWebsiteExplorationArtifactStore({ rootDirectory: root }),
    });

    try {
      const output = await explorerAgent.explore({
        prospectBusiness: {
          id: "prospect-1",
          googlePlaceId: "places/detail-cafe",
          name: "Detail Cafe",
          websiteUrl: "https://detail.example",
          categories: ["cafe"],
          prospectStatus: "discovered",
          sourceData: { placeId: "places/detail-cafe" },
          firstSeenAt: new Date("2026-06-22T17:00:00.000Z"),
          lastSeenAt: new Date("2026-06-22T17:00:00.000Z"),
        },
        currentWebsiteUrl: "https://detail.example",
        assessmentRunId: "assessment-run-1",
        explorationBudget: {
          maxPages: 1,
          maxScreenshots: 2,
          timeoutMs: 30000,
          allowedDomains: ["detail.example"],
          forbiddenActions: [
            "search_engines",
            "unrelated_external_domains",
            "form_submission",
            "login_bypass",
            "payments",
            "downloads",
          ],
        },
        reviewContextBudget: {
          maxTextCharacters: 18,
        },
      });

      expect(browser.captureLandingPage).toHaveBeenCalledWith({
        currentWebsiteUrl: "https://detail.example",
        explorationBudget: expect.objectContaining({ maxPages: 1, maxScreenshots: 2 }),
      });
      expect(output.reviewContext).toMatchObject({
        currentWebsiteUrl: "https://detail.example/",
        htmlText: "Detail Cafe Menu E",
        deterministicChecks: {
          contactInformationFound: false,
          servicesFound: true,
        },
        websiteExplorationEvidence: [
          {
            pageUrl: "https://detail.example/",
            reviewerReadyTextExcerpt: "Detail Cafe Menu E",
            browserObservations: ["The landing page exposes a menu link but no clear phone number."],
          },
        ],
      });
      expect(output.evidence[0]).toMatchObject({
        htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/landing.html",
        desktopScreenshot: {
          uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-desktop.png",
        },
        mobileScreenshot: {
          uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-mobile.png",
        },
      });
      await expect(
        readFile(
          join(root, "website-assessments/prospect-1/assessment-run-1/pages/landing.html"),
          "utf8",
        ),
      ).resolves.toContain("Detail Cafe");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
