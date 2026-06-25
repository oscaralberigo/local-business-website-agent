import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { FileSystemWebsiteExplorationArtifactStore } from "../src/website-assessment/file-system-website-exploration-artifact-store.js";
import { createPlaywrightWebsiteLandingPageBrowser } from "../src/website-assessment/playwright-website-landing-page-browser.js";
import {
  createLandingPageWebsiteExplorerAgent,
  type WebsiteLandingPageBrowser,
} from "../src/website-assessment/website-explorer-agent.js";

describe("Website Explorer Agent", () => {
  it("captures landing-page Website Exploration Evidence through a bounded browser adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "website-explorer-agent-"));
    const browser: WebsiteLandingPageBrowser = {
      capturePages: vi.fn(async () => [
        {
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
        },
      ]),
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

      expect(browser.capturePages).toHaveBeenCalledWith({
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

  it("stores useful same-site pages beyond the landing page when the Exploration Budget allows it", async () => {
    const root = await mkdtemp(join(tmpdir(), "website-explorer-agent-"));
    const browser: WebsiteLandingPageBrowser = {
      capturePages: vi.fn(async () => [
        {
          pageUrl: "https://detail.example/",
          rawHtml: "<!doctype html><main><h1>Detail Cafe</h1><a href=\"/menu\">Menu</a></main>",
          visibleText: "Detail Cafe landing page.",
          desktopScreenshot: {
            contents: Buffer.from("landing desktop"),
            capturedAt: new Date("2026-06-22T18:00:00.000Z"),
          },
          mobileScreenshot: {
            contents: Buffer.from("landing mobile"),
            capturedAt: new Date("2026-06-22T18:01:00.000Z"),
          },
          deterministicChecks: {
            pageLoad: "reachable" as const,
            https: "valid" as const,
            mobileViewport: "rendered" as const,
            contactInformationFound: false,
            servicesFound: false,
            brokenAssetsOrConsoleErrors: false,
            thirdPartyOnlyPresence: false,
          },
          browserObservations: ["Selected same-site navigation to https://detail.example/menu (menu evidence)."],
        },
        {
          pageUrl: "https://detail.example/menu",
          rawHtml: "<!doctype html><main><h1>Menu</h1><p>Espresso and pastries</p></main>",
          visibleText: "Menu Espresso and pastries.",
          desktopScreenshot: {
            contents: Buffer.from("menu desktop"),
            capturedAt: new Date("2026-06-22T18:02:00.000Z"),
          },
          mobileScreenshot: {
            contents: Buffer.from("menu mobile"),
            capturedAt: new Date("2026-06-22T18:03:00.000Z"),
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
          browserObservations: ["Exploration stopped: completed."],
        },
      ]),
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
          maxPages: 2,
          maxScreenshots: 4,
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
          maxTextCharacters: 100,
        },
      });

      expect(output.evidence).toHaveLength(2);
      expect(output.reviewContext).toMatchObject({
        htmlText: "Detail Cafe landing page.\n\n---\n\nMenu Espresso and pastries.",
        deterministicChecks: {
          servicesFound: true,
        },
        websiteExplorationEvidence: [
          expect.objectContaining({
            pageUrl: "https://detail.example/",
            htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/landing.html",
          }),
          expect.objectContaining({
            pageUrl: "https://detail.example/menu",
            htmlArtifactUri: "website-assessments/prospect-1/assessment-run-1/pages/page-2-menu.html",
          }),
        ],
      });
      await expect(
        readFile(
          join(root, "website-assessments/prospect-1/assessment-run-1/pages/page-2-menu.html"),
          "utf8",
        ),
      ).resolves.toContain("Espresso and pastries");
      await expect(
        readFile(
          join(root, "website-assessments/prospect-1/assessment-run-1/evidence-manifest.json"),
          "utf8",
        ),
      ).resolves.toContain("\"pageUrl\": \"https://detail.example/menu\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses local fixture websites to enforce same-site exploration budgets and forbidden actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "website-explorer-agent-fixture-"));
    const formSubmissions: string[] = [];
    const fixture = await startFixtureWebsite((request, response) => {
      if (request.method === "POST") {
        formSubmissions.push(request.url ?? "");
        response.writeHead(405).end();
        return;
      }

      if (request.url === "/") {
        response.setHeader("content-type", "text/html");
        response.end(`
          <!doctype html>
          <main>
            <h1>Fixture Cafe</h1>
            <a href="/menu">Menu</a>
            <a href="/about">About</a>
            <a href="https://example.net/services">External services</a>
            <a href="https://www.google.com/search?q=fixture+cafe">Search result</a>
            <a href="/brochure.pdf">Download brochure</a>
            <a href="/login">Login</a>
            <a href="/checkout">Checkout</a>
            <form method="post" action="/contact"><button>Send</button></form>
          </main>
        `);
        return;
      }

      if (request.url === "/menu") {
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><main><h1>Menu</h1><p>Espresso, pastries, and catering services.</p></main>");
        return;
      }

      response.writeHead(404).end("not found");
    });

    const explorerAgent = createLandingPageWebsiteExplorerAgent({
      browser: createPlaywrightWebsiteLandingPageBrowser(),
      artifactStore: new FileSystemWebsiteExplorationArtifactStore({ rootDirectory: root }),
    });

    try {
      const output = await exploreOrSkipIfPlaywrightHostIsUnavailable(() => explorerAgent.explore({
        prospectBusiness: {
          id: "prospect-1",
          googlePlaceId: "places/fixture-cafe",
          name: "Fixture Cafe",
          websiteUrl: fixture.url,
          categories: ["cafe"],
          prospectStatus: "discovered",
          sourceData: { placeId: "places/fixture-cafe" },
          firstSeenAt: new Date("2026-06-22T17:00:00.000Z"),
          lastSeenAt: new Date("2026-06-22T17:00:00.000Z"),
        },
        currentWebsiteUrl: fixture.url,
        assessmentRunId: "assessment-run-1",
        explorationBudget: {
          maxPages: 2,
          maxScreenshots: 4,
          timeoutMs: 10000,
          allowedDomains: [new URL(fixture.url).hostname],
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
          maxTextCharacters: 2000,
        },
      }));
      if (!output) {
        return;
      }

      expect(output.evidence.map((evidence) => new URL(evidence.pageUrl).pathname)).toEqual(["/", "/menu"]);
      expect(formSubmissions).toEqual([]);
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Skipped unrelated external domain https://example.net/services",
      );
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Skipped search-engine link https://www.google.com/search?q=fixture+cafe",
      );
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Skipped download link",
      );
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Skipped login/payment flow link",
      );
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Skipped 1 form(s); Website Explorer Agent does not submit forms.",
      );
      expect(output.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Exploration stopped: max_pages.",
      );
    } finally {
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records max screenshot and timeout stop reasons against local fixture websites", async () => {
    const screenshotRoot = await mkdtemp(join(tmpdir(), "website-explorer-agent-fixture-"));
    const timeoutRoot = await mkdtemp(join(tmpdir(), "website-explorer-agent-fixture-"));
    const fixture = await startFixtureWebsite((request, response) => {
      if (request.url === "/") {
        response.setHeader("content-type", "text/html");
        response.end(`
          <!doctype html>
          <main>
            <h1>Fixture Bakery</h1>
            <a href="/menu">Menu</a>
          </main>
        `);
        return;
      }

      if (request.url === "/menu") {
        setTimeout(() => {
          response.setHeader("content-type", "text/html");
          response.end("<!doctype html><main><h1>Menu</h1><p>Croissants and cakes.</p></main>");
        }, 1000);
        return;
      }

      response.writeHead(404).end("not found");
    });

    try {
      const screenshotLimitedAgent = createLandingPageWebsiteExplorerAgent({
        browser: createPlaywrightWebsiteLandingPageBrowser(),
        artifactStore: new FileSystemWebsiteExplorationArtifactStore({ rootDirectory: screenshotRoot }),
      });
      const screenshotLimitedOutput = await exploreOrSkipIfPlaywrightHostIsUnavailable(() =>
        screenshotLimitedAgent.explore({
          prospectBusiness: {
            id: "prospect-1",
            googlePlaceId: "places/fixture-bakery",
            name: "Fixture Bakery",
            websiteUrl: fixture.url,
            categories: ["bakery"],
            prospectStatus: "discovered",
            sourceData: { placeId: "places/fixture-bakery" },
            firstSeenAt: new Date("2026-06-22T17:00:00.000Z"),
            lastSeenAt: new Date("2026-06-22T17:00:00.000Z"),
          },
          currentWebsiteUrl: fixture.url,
          assessmentRunId: "assessment-run-1",
          explorationBudget: {
            maxPages: 3,
            maxScreenshots: 2,
            timeoutMs: 10000,
            allowedDomains: [new URL(fixture.url).hostname],
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
            maxTextCharacters: 2000,
          },
        }),
      );
      if (!screenshotLimitedOutput) {
        return;
      }
      expect(screenshotLimitedOutput.evidence).toHaveLength(1);
      expect(screenshotLimitedOutput.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Exploration stopped: max_screenshots.",
      );

      const timeoutLimitedAgent = createLandingPageWebsiteExplorerAgent({
        browser: createPlaywrightWebsiteLandingPageBrowser(),
        artifactStore: new FileSystemWebsiteExplorationArtifactStore({ rootDirectory: timeoutRoot }),
      });
      const timeoutLimitedOutput = await exploreOrSkipIfPlaywrightHostIsUnavailable(() =>
        timeoutLimitedAgent.explore({
          prospectBusiness: {
            id: "prospect-1",
            googlePlaceId: "places/fixture-bakery",
            name: "Fixture Bakery",
            websiteUrl: fixture.url,
            categories: ["bakery"],
            prospectStatus: "discovered",
            sourceData: { placeId: "places/fixture-bakery" },
            firstSeenAt: new Date("2026-06-22T17:00:00.000Z"),
            lastSeenAt: new Date("2026-06-22T17:00:00.000Z"),
          },
          currentWebsiteUrl: fixture.url,
          assessmentRunId: "assessment-run-2",
          explorationBudget: {
            maxPages: 2,
            maxScreenshots: 4,
            timeoutMs: 500,
            allowedDomains: [new URL(fixture.url).hostname],
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
            maxTextCharacters: 2000,
          },
        }),
      );
      if (!timeoutLimitedOutput) {
        return;
      }
      expect(timeoutLimitedOutput.evidence).toHaveLength(1);
      expect(timeoutLimitedOutput.evidence.flatMap((evidence) => evidence.browserObservations).join("\n")).toContain(
        "Exploration stopped: timeout.",
      );
    } finally {
      await fixture.close();
      await rm(screenshotRoot, { recursive: true, force: true });
      await rm(timeoutRoot, { recursive: true, force: true });
    }
  });
});

async function exploreOrSkipIfPlaywrightHostIsUnavailable<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Host system is missing dependencies to run browsers") ||
        error.message.includes("Executable doesn't exist") ||
        error.message.includes("Please run the following command to download new browsers"))
    ) {
      console.warn("Skipping Playwright-backed fixture assertion because host browser dependencies are unavailable.");
      return undefined;
    }
    throw error;
  }
}

async function startFixtureWebsite(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture website did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
