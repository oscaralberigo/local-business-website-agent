import type {
  ExplorationBudget,
  WebsiteAssessmentInput,
  WebsiteDeterministicChecks,
  WebsiteExplorerAgent,
  WebsiteExplorationArtifactStore,
  WebsiteExplorationEvidence,
  WebsiteScreenshotInput,
} from "./types.js";

export type WebsitePageCapture = {
  pageUrl: string;
  rawHtml: string;
  visibleText: string;
  desktopScreenshot: {
    contents: Buffer;
    capturedAt: Date;
  };
  mobileScreenshot: {
    contents: Buffer;
    capturedAt: Date;
  };
  deterministicChecks: WebsiteDeterministicChecks;
  browserObservations: string[];
};

export type WebsiteLandingPageCapture = WebsitePageCapture;

export type WebsiteLandingPageBrowser = {
  capturePages(input: {
    currentWebsiteUrl: string;
    explorationBudget: ExplorationBudget;
  }): Promise<WebsitePageCapture[]>;
};

export function createLandingPageWebsiteExplorerAgent(input: {
  browser: WebsiteLandingPageBrowser;
  artifactStore: WebsiteExplorationArtifactStore;
}): WebsiteExplorerAgent {
  return {
    async explore({ prospectBusiness, currentWebsiteUrl, assessmentRunId, explorationBudget, reviewContextBudget }) {
      assertWithinAllowedDomains(currentWebsiteUrl, explorationBudget);

      const pageCaptures = await input.browser.capturePages({
        currentWebsiteUrl,
        explorationBudget,
      });
      if (pageCaptures.length === 0) {
        throw new Error("Website Explorer Agent did not capture any Website Exploration Evidence.");
      }

      const evidence: WebsiteExplorationEvidence[] = [];
      for (const [index, pageCapture] of pageCaptures.entries()) {
        const reviewerReadyTextExcerpt = pageCapture.visibleText.slice(
          0,
          reviewContextBudget.maxTextCharacters,
        );
        evidence.push(await input.artifactStore.writePageEvidence({
          prospectBusinessId: prospectBusiness.id,
          assessmentRunId,
          pageArtifactName: pageArtifactNameFor(pageCapture.pageUrl, index),
          pageUrl: pageCapture.pageUrl,
          rawHtml: pageCapture.rawHtml,
          reviewerReadyTextExcerpt,
          desktopScreenshot: pageCapture.desktopScreenshot,
          mobileScreenshot: pageCapture.mobileScreenshot,
          deterministicChecks: pageCapture.deterministicChecks,
          browserObservations: pageCapture.browserObservations,
        }));
      }

      const landingPage = pageCaptures[0]!;
      const reviewText = pageCaptures
        .map((pageCapture) => pageCapture.visibleText)
        .join("\n\n---\n\n")
        .slice(0, reviewContextBudget.maxTextCharacters);
      const reviewContext: WebsiteAssessmentInput = {
        currentWebsiteUrl: landingPage.pageUrl,
        htmlText: reviewText,
        deterministicChecks: aggregateDeterministicChecks(
          pageCaptures.map((pageCapture) => pageCapture.deterministicChecks),
        ),
        desktopScreenshot: screenshotForReview(evidence[0]!.desktopScreenshot),
        mobileScreenshot: screenshotForReview(evidence[0]!.mobileScreenshot),
        websiteExplorationEvidence: evidence,
      };

      return {
        evidence,
        reviewContext,
      };
    },
  };
}

function screenshotForReview(screenshot: WebsiteScreenshotInput): WebsiteScreenshotInput {
  return {
    uri: screenshot.uri,
    capturedAt: screenshot.capturedAt,
  };
}

function aggregateDeterministicChecks(checks: WebsiteDeterministicChecks[]): WebsiteDeterministicChecks {
  const first = checks[0]!;
  return {
    pageLoad: checks.every((check) => check.pageLoad === "reachable") ? "reachable" : first.pageLoad,
    https: checks.every((check) => check.https === "valid") ? "valid" : first.https,
    mobileViewport: checks.every((check) => check.mobileViewport === "rendered") ? "rendered" : first.mobileViewport,
    contactInformationFound: checks.some((check) => check.contactInformationFound),
    servicesFound: checks.some((check) => check.servicesFound),
    brokenAssetsOrConsoleErrors: checks.some((check) => check.brokenAssetsOrConsoleErrors),
    thirdPartyOnlyPresence: checks.every((check) => check.thirdPartyOnlyPresence),
  };
}

function pageArtifactNameFor(pageUrl: string, index: number): string {
  if (index === 0) {
    return "landing";
  }

  const pathname = new URL(pageUrl).pathname;
  const slug = pathname
    .split("/")
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `page-${index + 1}${slug ? `-${slug}` : ""}`;
}

function assertWithinAllowedDomains(currentWebsiteUrl: string, explorationBudget: ExplorationBudget): void {
  const hostname = new URL(currentWebsiteUrl).hostname;
  if (!explorationBudget.allowedDomains.includes(hostname)) {
    throw new Error(`Website Explorer Agent blocked navigation outside allowed domains: ${hostname}`);
  }
}
