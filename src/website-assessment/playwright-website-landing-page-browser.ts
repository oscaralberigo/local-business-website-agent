import {
  chromium,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Response,
} from "playwright";

import type { ExplorationBudget } from "./types.js";
import type { WebsiteLandingPageBrowser, WebsitePageCapture } from "./website-explorer-agent.js";

export function createPlaywrightWebsiteLandingPageBrowser(): WebsiteLandingPageBrowser {
  return {
    async capturePages({ currentWebsiteUrl, explorationBudget }) {
      const browser = await chromium.launch({ headless: true });
      const capturedPages: CapturedPage[] = [];
      const visitedUrls = new Set<string>();
      const queuedUrls = new Set<string>([normalizeUrl(currentWebsiteUrl)]);
      const pendingUrls = [currentWebsiteUrl];
      const deadline = Date.now() + explorationBudget.timeoutMs;
      let screenshotsUsed = 0;
      let stopReason: ExplorationStopReason | undefined;

      try {
        while (pendingUrls.length > 0 && capturedPages.length < explorationBudget.maxPages) {
          if (Date.now() >= deadline) {
            stopReason = "timeout";
            break;
          }
          if (screenshotsUsed + 2 > explorationBudget.maxScreenshots) {
            stopReason = "max_screenshots";
            break;
          }

          const nextUrl = pendingUrls.shift()!;
          queuedUrls.delete(normalizeUrl(nextUrl));
          if (visitedUrls.has(normalizeUrl(nextUrl))) {
            continue;
          }

          const capturedPage = await capturePage({
            url: nextUrl,
            explorationBudget,
            deadline,
            browser,
          });
          if (!capturedPage) {
            stopReason = "timeout";
            break;
          }

          visitedUrls.add(normalizeUrl(capturedPage.pageUrl));
          capturedPages.push(capturedPage);
          screenshotsUsed += 2;

          const selectedLinks = selectNextLinks({
            links: capturedPage.links,
            currentPageUrl: capturedPage.pageUrl,
            explorationBudget,
            visitedUrls,
            queuedUrls,
          });
          for (const skippedObservation of selectedLinks.skippedObservations) {
            capturedPage.browserObservations.push(skippedObservation);
          }
          for (const selectedLink of selectedLinks.selectedLinks) {
            pendingUrls.push(selectedLink.url);
            queuedUrls.add(normalizeUrl(selectedLink.url));
            capturedPage.browserObservations.push(
              `Selected same-site navigation to ${selectedLink.url} (${selectedLink.reason}).`,
            );
          }

          if (capturedPages.length >= explorationBudget.maxPages && pendingUrls.length > 0) {
            stopReason = "max_pages";
            break;
          }
          if (screenshotsUsed + 2 > explorationBudget.maxScreenshots && pendingUrls.length > 0) {
            stopReason = "max_screenshots";
            break;
          }
        }

        if (!stopReason) {
          stopReason = pendingUrls.length > 0 ? "max_pages" : "completed";
        }
        capturedPages[capturedPages.length - 1]?.browserObservations.push(
          `Exploration stopped: ${stopReason}.`,
        );

        return capturedPages;
      } finally {
        await browser.close();
      }
    },
  };
}

type ExplorationStopReason = "completed" | "max_pages" | "max_screenshots" | "timeout";

type CapturedPage = WebsitePageCapture & {
  links: DiscoveredLink[];
};

type DiscoveredLink = {
  url: string;
  text: string;
  download: boolean;
};

type SelectedLink = {
  url: string;
  reason: string;
  score: number;
};

async function capturePage(input: {
  url: string;
  explorationBudget: ExplorationBudget;
  deadline: number;
  browser: Awaited<ReturnType<typeof chromium.launch>>;
}): Promise<CapturedPage | undefined> {
  const consoleErrors: ConsoleMessage[] = [];
  const desktopContext = await input.browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  await constrainContextToBudget(desktopContext, input.explorationBudget);
  const desktopPage = await desktopContext.newPage();
  desktopPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message);
    }
  });

  try {
    const response = await gotoWithinBudget(desktopPage, input.url, input.deadline);
    if (!response) {
      return undefined;
    }

    const pageUrl = desktopPage.url();
    const rawHtml = await desktopPage.content();
    const visibleText = await desktopPage.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const links = await discoverLinks(desktopPage);
    const formCount = await desktopPage.locator("form").count().catch(() => 0);
    const desktopScreenshot = await desktopPage.screenshot({ fullPage: true, type: "png" });
    await desktopContext.close();

    const mobileContext = await input.browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await constrainContextToBudget(mobileContext, input.explorationBudget);
    const mobilePage = await mobileContext.newPage();
    const mobileResponse = await gotoWithinBudget(mobilePage, pageUrl, input.deadline);
    const mobileScreenshot = mobileResponse
      ? await mobilePage.screenshot({ fullPage: true, type: "png" })
      : Buffer.alloc(0);
    await mobileContext.close();

    return {
      pageUrl,
      rawHtml,
      visibleText,
      links,
      desktopScreenshot: {
        contents: desktopScreenshot,
        capturedAt: new Date(),
      },
      mobileScreenshot: {
        contents: mobileScreenshot,
        capturedAt: new Date(),
      },
      deterministicChecks: {
        pageLoad: response.ok() ? "reachable" : "unreachable",
        https: pageUrl.startsWith("https://") ? "valid" : "missing",
        mobileViewport: mobileScreenshot.length > 0 ? "rendered" : "failed",
        contactInformationFound: containsContactInformation(visibleText),
        servicesFound: containsServiceLanguage(visibleText),
        brokenAssetsOrConsoleErrors: consoleErrors.length > 0,
        thirdPartyOnlyPresence: isThirdPartyOnlyPresence(pageUrl),
      },
      browserObservations: observationsFor({
        pageUrl,
        visibleText,
        consoleErrorCount: consoleErrors.length,
        formCount,
      }),
    };
  } finally {
    await desktopContext.close().catch(() => undefined);
  }
}

async function constrainContextToBudget(
  context: BrowserContext,
  explorationBudget: ExplorationBudget,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (!requestUrl.startsWith("http://") && !requestUrl.startsWith("https://")) {
      await route.continue();
      return;
    }

    const parsedUrl = new URL(requestUrl);
    if (
      explorationBudget.allowedDomains.includes(parsedUrl.hostname) &&
      !isSearchEngine(parsedUrl.hostname)
    ) {
      await route.continue();
      return;
    }

    await route.abort("blockedbyclient");
  });
}

async function gotoWithinBudget(
  page: Page,
  url: string,
  deadline: number,
): Promise<Response | null | undefined> {
  const timeout = deadline - Date.now();
  if (timeout <= 0) {
    return undefined;
  }

  try {
    return await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
  } catch (error) {
    if (error instanceof Error && /Timeout/i.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

async function discoverLinks(page: Page): Promise<DiscoveredLink[]> {
  return page
    .locator("a")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        url: (anchor as HTMLAnchorElement).href,
        text: (anchor.textContent ?? "").trim(),
        download: (anchor as HTMLAnchorElement).hasAttribute("download"),
      })),
    )
    .catch(() => []);
}

function selectNextLinks(input: {
  links: DiscoveredLink[];
  currentPageUrl: string;
  explorationBudget: ExplorationBudget;
  visitedUrls: Set<string>;
  queuedUrls: Set<string>;
}): {
  selectedLinks: SelectedLink[];
  skippedObservations: string[];
} {
  const skippedObservations: string[] = [];
  const selectedLinks: SelectedLink[] = [];

  for (const link of input.links) {
    const classification = classifyLink(link, input.explorationBudget);
    if (classification.type === "skip") {
      skippedObservations.push(classification.observation);
      continue;
    }

    const normalizedUrl = normalizeUrl(classification.link.url);
    if (
      normalizedUrl === normalizeUrl(input.currentPageUrl) ||
      input.visitedUrls.has(normalizedUrl) ||
      input.queuedUrls.has(normalizedUrl)
    ) {
      continue;
    }
    selectedLinks.push(classification.link);
  }

  return {
    selectedLinks: selectedLinks
      .sort((left, right) => right.score - left.score)
      .slice(0, 3),
    skippedObservations: [...new Set(skippedObservations)].slice(0, 12),
  };
}

function classifyLink(
  link: DiscoveredLink,
  explorationBudget: ExplorationBudget,
):
  | { type: "select"; link: SelectedLink }
  | { type: "skip"; observation: string } {
  if (!link.url.startsWith("http://") && !link.url.startsWith("https://")) {
    return {
      type: "skip",
      observation: `Skipped non-page link ${link.url}.`,
    };
  }

  const parsedUrl = new URL(link.url);
  const label = `${parsedUrl.pathname} ${link.text}`;
  if (isSearchEngine(parsedUrl.hostname)) {
    return {
      type: "skip",
      observation: `Skipped search-engine link ${link.url}.`,
    };
  }
  if (!explorationBudget.allowedDomains.includes(parsedUrl.hostname)) {
    return {
      type: "skip",
      observation: `Skipped unrelated external domain ${link.url}.`,
    };
  }
  if (link.download || isDownloadUrl(parsedUrl)) {
    return {
      type: "skip",
      observation: `Skipped download link ${link.url}.`,
    };
  }
  if (isLoginOrPaymentFlow(label)) {
    return {
      type: "skip",
      observation: `Skipped login/payment flow link ${link.url}.`,
    };
  }

  const score = usefulPageScore(label);
  if (score === 0) {
    return {
      type: "skip",
      observation: `Skipped low-value same-site page ${link.url}.`,
    };
  }

  return {
    type: "select",
    link: {
      url: link.url,
      reason: usefulPageReason(label),
      score,
    },
  };
}

function containsContactInformation(text: string): boolean {
  return /(\+?\d[\d\s().-]{7,}|@|contact|call|email|visit|address)/i.test(text);
}

function containsServiceLanguage(text: string): boolean {
  return /(service|services|menu|book|booking|appointment|shop|order|products|about)/i.test(text);
}

function isThirdPartyOnlyPresence(pageUrl: string): boolean {
  const hostname = new URL(pageUrl).hostname.replace(/^www\./, "");
  return ["facebook.com", "instagram.com", "linktr.ee", "yelp.com"].some(
    (thirdPartyHost) => hostname === thirdPartyHost || hostname.endsWith(`.${thirdPartyHost}`),
  );
}

function observationsFor(input: {
  pageUrl: string;
  visibleText: string;
  consoleErrorCount: number;
  formCount: number;
}): string[] {
  const observations = [`Page captured at ${input.pageUrl}.`];
  if (input.visibleText.length === 0) {
    observations.push("No visible body text was extracted from the page.");
  }
  if (input.consoleErrorCount > 0) {
    observations.push(`${input.consoleErrorCount} browser console error(s) were observed during page capture.`);
  }
  if (input.formCount > 0) {
    observations.push(`Skipped ${input.formCount} form(s); Website Explorer Agent does not submit forms.`);
  }
  return observations;
}

function normalizeUrl(url: string): string {
  const parsedUrl = new URL(url);
  parsedUrl.hash = "";
  if (parsedUrl.pathname !== "/" && parsedUrl.pathname.endsWith("/")) {
    parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
  }
  return parsedUrl.toString();
}

function isSearchEngine(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^www\./, "");
  return ["google.com", "bing.com", "duckduckgo.com", "yahoo.com"].some(
    (searchHost) => normalizedHostname === searchHost || normalizedHostname.endsWith(`.${searchHost}`),
  );
}

function isDownloadUrl(url: URL): boolean {
  return /\.(pdf|zip|doc|docx|xls|xlsx|ppt|pptx|ics|dmg|exe)$/i.test(url.pathname);
}

function isLoginOrPaymentFlow(label: string): boolean {
  return /(login|log-in|sign-in|signin|account|checkout|cart|payment|pay|subscribe|order-online)/i.test(label);
}

function usefulPageScore(label: string): number {
  const normalizedLabel = label.toLowerCase();
  const matches = [
    /services?/.test(normalizedLabel),
    /menu/.test(normalizedLabel),
    /book|booking|appointment|reservation/.test(normalizedLabel),
    /about|team|story/.test(normalizedLabel),
    /contact|location|hours|visit|directions/.test(normalizedLabel),
  ].filter(Boolean).length;
  return matches;
}

function usefulPageReason(label: string): string {
  if (/services?/i.test(label)) return "services evidence";
  if (/menu/i.test(label)) return "menu evidence";
  if (/book|booking|appointment|reservation/i.test(label)) return "booking evidence";
  if (/about|team|story/i.test(label)) return "about evidence";
  if (/contact|location|hours|visit|directions/i.test(label)) return "location/contact usability evidence";
  return "website-quality evidence";
}
