import type {
  ExplorationBudget,
  WebsiteAssessmentInput,
  WebsiteDeterministicChecks,
  WebsiteExplorerAgent,
  WebsiteExplorationArtifactStore,
  WebsiteScreenshotInput,
} from "./types.js";

export type WebsiteLandingPageCapture = {
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

export type WebsiteLandingPageBrowser = {
  captureLandingPage(input: {
    currentWebsiteUrl: string;
    explorationBudget: ExplorationBudget;
  }): Promise<WebsiteLandingPageCapture>;
};

export function createLandingPageWebsiteExplorerAgent(input: {
  browser: WebsiteLandingPageBrowser;
  artifactStore: WebsiteExplorationArtifactStore;
}): WebsiteExplorerAgent {
  return {
    async explore({ prospectBusiness, currentWebsiteUrl, assessmentRunId, explorationBudget, reviewContextBudget }) {
      assertWithinAllowedDomains(currentWebsiteUrl, explorationBudget);

      const landingPage = await input.browser.captureLandingPage({
        currentWebsiteUrl,
        explorationBudget,
      });
      const reviewerReadyTextExcerpt = landingPage.visibleText.slice(
        0,
        reviewContextBudget.maxTextCharacters,
      );
      const evidence = await input.artifactStore.writeLandingPageEvidence({
        prospectBusinessId: prospectBusiness.id,
        assessmentRunId,
        pageUrl: landingPage.pageUrl,
        rawHtml: landingPage.rawHtml,
        reviewerReadyTextExcerpt,
        desktopScreenshot: landingPage.desktopScreenshot,
        mobileScreenshot: landingPage.mobileScreenshot,
        deterministicChecks: landingPage.deterministicChecks,
        browserObservations: landingPage.browserObservations,
      });
      const reviewContext: WebsiteAssessmentInput = {
        currentWebsiteUrl: landingPage.pageUrl,
        htmlText: reviewerReadyTextExcerpt,
        deterministicChecks: landingPage.deterministicChecks,
        desktopScreenshot: screenshotForReview(evidence.desktopScreenshot),
        mobileScreenshot: screenshotForReview(evidence.mobileScreenshot),
        websiteExplorationEvidence: [evidence],
      };

      return {
        evidence: [evidence],
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

function assertWithinAllowedDomains(currentWebsiteUrl: string, explorationBudget: ExplorationBudget): void {
  const hostname = new URL(currentWebsiteUrl).hostname;
  if (!explorationBudget.allowedDomains.includes(hostname)) {
    throw new Error(`Website Explorer Agent blocked navigation outside allowed domains: ${hostname}`);
  }
}
