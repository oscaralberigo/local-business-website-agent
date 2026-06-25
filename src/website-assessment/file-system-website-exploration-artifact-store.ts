import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import type {
  WebsiteExplorationArtifactStore,
  WebsiteExplorationEvidence,
} from "./types.js";

export class FileSystemWebsiteExplorationArtifactStore implements WebsiteExplorationArtifactStore {
  constructor(private readonly options: { rootDirectory: string }) {}

  async writePageEvidence(
    input: Parameters<WebsiteExplorationArtifactStore["writePageEvidence"]>[0],
  ): Promise<WebsiteExplorationEvidence> {
    assertSafeSegment(input.prospectBusinessId, "Prospect Business ID");
    assertSafeSegment(input.assessmentRunId, "Website Assessment run ID");
    assertSafeSegment(input.pageArtifactName, "Website Exploration page artifact name");

    const runRoot = join(
      "website-assessments",
      input.prospectBusinessId,
      input.assessmentRunId,
    );
    const htmlArtifactUri = join(runRoot, "pages", `${input.pageArtifactName}.html`);
    const desktopScreenshotUri = join(runRoot, "screenshots", `${input.pageArtifactName}-desktop.png`);
    const mobileScreenshotUri = join(runRoot, "screenshots", `${input.pageArtifactName}-mobile.png`);
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
    await this.writeEvidenceManifest(manifestUri, evidence);

    return evidence;
  }

  async writeLandingPageEvidence(
    input: Parameters<WebsiteExplorationArtifactStore["writeLandingPageEvidence"]>[0],
  ): Promise<WebsiteExplorationEvidence> {
    return this.writePageEvidence({
      ...input,
      pageArtifactName: "landing",
    });
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

  private async writeEvidenceManifest(
    relativePath: string,
    evidence: WebsiteExplorationEvidence,
  ): Promise<void> {
    assertSafeRelativePath(relativePath);

    const absoluteFile = join(this.options.rootDirectory, relativePath);
    const existingEvidence = await readExistingManifestEvidence(absoluteFile);
    const nextEvidence = [
      ...existingEvidence.filter((entry) => entry.pageUrl !== evidence.pageUrl),
      evidence,
    ];

    await mkdir(dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, `${JSON.stringify({ evidence: nextEvidence }, null, 2)}\n`);
  }
}

async function readExistingManifestEvidence(absoluteFile: string): Promise<WebsiteExplorationEvidence[]> {
  try {
    const manifest = JSON.parse(await readFile(absoluteFile, "utf8")) as {
      evidence?: WebsiteExplorationEvidence | WebsiteExplorationEvidence[];
    };
    if (Array.isArray(manifest.evidence)) {
      return manifest.evidence;
    }
    return manifest.evidence ? [manifest.evidence] : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
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
