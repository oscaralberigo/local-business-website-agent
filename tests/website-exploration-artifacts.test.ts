import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileSystemWebsiteExplorationArtifactStore } from "../src/website-assessment/file-system-website-exploration-artifact-store.js";

describe("Website Exploration Artifacts", () => {
  it("writes landing-page HTML, screenshots, and an evidence manifest under the Website Assessment run", async () => {
    const root = await mkdtemp(join(tmpdir(), "website-exploration-artifacts-"));
    const store = new FileSystemWebsiteExplorationArtifactStore({ rootDirectory: root });

    try {
      const evidence = await store.writeLandingPageEvidence({
        prospectBusinessId: "prospect-1",
        assessmentRunId: "assessment-run-1",
        pageUrl: "https://detail.example/",
        rawHtml: "<!doctype html><main>Detail Cafe</main>",
        reviewerReadyTextExcerpt: "Detail Cafe serves espresso and pastries.",
        desktopScreenshot: {
          contents: Buffer.from("desktop screenshot"),
          capturedAt: new Date("2026-06-22T18:00:00.000Z"),
        },
        mobileScreenshot: {
          contents: Buffer.from("mobile screenshot"),
          capturedAt: new Date("2026-06-22T18:01:00.000Z"),
        },
        deterministicChecks: {
          pageLoad: "reachable",
          https: "valid",
          mobileViewport: "rendered",
          contactInformationFound: true,
          servicesFound: true,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
        browserObservations: ["Landing page loads with cafe menu sections."],
      });

      expect(evidence).toMatchObject({
        pageUrl: "https://detail.example/",
        htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/landing.html",
        reviewerReadyTextExcerpt: "Detail Cafe serves espresso and pastries.",
        desktopScreenshot: {
          uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-desktop.png",
          capturedAt: new Date("2026-06-22T18:00:00.000Z"),
        },
        mobileScreenshot: {
          uri: "website-assessments/prospect-1/assessment-run-1/screenshots/landing-mobile.png",
          capturedAt: new Date("2026-06-22T18:01:00.000Z"),
        },
      });
      await expect(
        readFile(
          join(root, "website-assessments/prospect-1/assessment-run-1/pages/landing.html"),
          "utf8",
        ),
      ).resolves.toContain("Detail Cafe");
      await expect(
        readFile(join(root, "website-assessments/prospect-1/assessment-run-1/screenshots/landing-desktop.png")),
      ).resolves.toEqual(Buffer.from("desktop screenshot"));
      await expect(
        readFile(join(root, "website-assessments/prospect-1/assessment-run-1/screenshots/landing-mobile.png")),
      ).resolves.toEqual(Buffer.from("mobile screenshot"));
      await expect(
        readFile(
          join(root, "website-assessments/prospect-1/assessment-run-1/evidence-manifest.json"),
          "utf8",
        ),
      ).resolves.toContain("\"pageUrl\": \"https://detail.example/\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
