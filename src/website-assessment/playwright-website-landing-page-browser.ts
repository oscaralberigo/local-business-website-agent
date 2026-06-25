import { chromium, type ConsoleMessage } from "playwright";

import type { WebsiteLandingPageBrowser, WebsiteLandingPageCapture } from "./website-explorer-agent.js";

export function createPlaywrightWebsiteLandingPageBrowser(): WebsiteLandingPageBrowser {
  return {
    async captureLandingPage({ currentWebsiteUrl, explorationBudget }) {
      const browser = await chromium.launch({ headless: true });
      const consoleErrors: ConsoleMessage[] = [];

      try {
        const desktopContext = await browser.newContext({
          viewport: { width: 1440, height: 1200 },
        });
        const desktopPage = await desktopContext.newPage();
        desktopPage.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message);
          }
        });
        const response = await desktopPage.goto(currentWebsiteUrl, {
          waitUntil: "domcontentloaded",
          timeout: explorationBudget.timeoutMs,
        });
        const pageUrl = desktopPage.url();
        const rawHtml = await desktopPage.content();
        const visibleText = await desktopPage.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        const desktopScreenshot = await desktopPage.screenshot({ fullPage: true, type: "png" });
        await desktopContext.close();

        const mobileContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        });
        const mobilePage = await mobileContext.newPage();
        await mobilePage.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: explorationBudget.timeoutMs,
        });
        const mobileScreenshot = await mobilePage.screenshot({ fullPage: true, type: "png" });
        await mobileContext.close();

        return {
          pageUrl,
          rawHtml,
          visibleText,
          desktopScreenshot: {
            contents: desktopScreenshot,
            capturedAt: new Date(),
          },
          mobileScreenshot: {
            contents: mobileScreenshot,
            capturedAt: new Date(),
          },
          deterministicChecks: {
            pageLoad: response?.ok() ? "reachable" : "unreachable",
            https: pageUrl.startsWith("https://") ? "valid" : "missing",
            mobileViewport: mobileScreenshot.length > 0 ? "rendered" : "failed",
            contactInformationFound: containsContactInformation(visibleText),
            servicesFound: containsServiceLanguage(visibleText),
            brokenAssetsOrConsoleErrors: consoleErrors.length > 0,
            thirdPartyOnlyPresence: isThirdPartyOnlyPresence(pageUrl),
          },
          browserObservations: observationsFor({ pageUrl, visibleText, consoleErrorCount: consoleErrors.length }),
        } satisfies WebsiteLandingPageCapture;
      } finally {
        await browser.close();
      }
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
}): string[] {
  const observations = [`Landing page captured at ${input.pageUrl}.`];
  if (input.visibleText.length === 0) {
    observations.push("No visible body text was extracted from the landing page.");
  }
  if (input.consoleErrorCount > 0) {
    observations.push(`${input.consoleErrorCount} browser console error(s) were observed during landing-page capture.`);
  }
  return observations;
}
