import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import type {
  WebsiteExplorationArtifactStore,
  WebsiteExplorationEvidence,
} from "./types.js";

export class FileSystemWebsiteExplorationArtifactStore implements WebsiteExplorationArtifactStore {
  constructor(private readonly options: { rootDirectory: string }) {}

  async writeLandingPageEvidence(
    input: Parameters<WebsiteExplorationArtifactStore["writeLandingPageEvidence"]>[0],
  ): Promise<WebsiteExplorationEvidence> {
    assertSafeSegment(input.prospectBusinessId, "Prospect Business ID");
    assertSafeSegment(input.assessmentRunId, "Website Assessment run ID");

    const runRoot = join(
      "website-assessments",
      input.prospectBusinessId,
      input.assessmentRunId,
    );
    const htmlArtifactUri = join(runRoot, "pages", "landing.html");
    const desktopScreenshotUri = join(runRoot, "screenshots", "landing-desktop.png");
    const mobileScreenshotUri = join(runRoot, "screenshots", "landing-mobile.png");
    const manifestUri = join(runRoot, "evidence-manifest.json");
    const evidence: WebsiteExplorationEvidence = {
      pageUrl: input.pageUrl,
      htmlArtifactUri,
      reviewerReadyTextExcerpt: input.reviewerReadyTextExcerpt,
      desktopScreenshot: {
        uri: desktopScreenshotUri,
        capturedAt: input.desktopScreenshot.capturedAt,
      },
      mobileScreenshot: {
        uri: mobileScreenshotUri,
        capturedAt: input.mobileScreenshot.capturedAt,
      },
      deterministicChecks: input.deterministicChecks,
      browserObservations: input.browserObservations,
    };

    await this.writeFileWithinRoot(htmlArtifactUri, input.rawHtml);
    await this.writeFileWithinRoot(desktopScreenshotUri, input.desktopScreenshot.contents);
    await this.writeFileWithinRoot(mobileScreenshotUri, input.mobileScreenshot.contents);
    await this.writeFileWithinRoot(
      manifestUri,
      `${JSON.stringify({ evidence }, null, 2)}\n`,
    );

    return evidence;
  }

  private async writeFileWithinRoot(relativePath: string, contents: string | Buffer): Promise<void> {
    assertSafeRelativePath(relativePath);

    const absoluteFile = join(this.options.rootDirectory, relativePath);
    const rootToFile = relative(this.options.rootDirectory, absoluteFile);

    if (rootToFile.startsWith("..") || rootToFile === "") {
      throw new Error(`Website Exploration Artifact path escapes its root: ${relativePath}`);
    }

    await mkdir(dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, contents);
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new Error(`${label} must be a filesystem-safe segment.`);
  }
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../") || normalized.startsWith("/")) {
    throw new Error(`Website Exploration Artifact path is not safe: ${relativePath}`);
  }
}
