import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import type { GeneratedSvelteWebsite, PreviewArtifact, PreviewArtifactStore } from "./types.js";

export class FileSystemPreviewArtifactStore implements PreviewArtifactStore {
  constructor(private readonly options: { rootDirectory: string }) {}

  async writeArtifacts(input: {
    prospectBusinessId: string;
    slug: string;
    generatedWebsite: GeneratedSvelteWebsite;
  }): Promise<PreviewArtifact> {
    assertSafeSegment(input.slug, "Preview Website slug");

    const sourceRoot = join(input.slug, "source");
    const staticRoot = join(input.slug, "dist");

    for (const sourceFile of input.generatedWebsite.sourceFiles) {
      await this.writeFileWithinRoot(sourceRoot, sourceFile.relativePath, sourceFile.contents);
    }

    for (const staticAsset of input.generatedWebsite.staticAssets) {
      await this.writeFileWithinRoot(
        staticRoot,
        stripLeadingDist(staticAsset.relativePath),
        staticAsset.contents,
      );
    }

    return {
      sourceRoot,
      staticRoot,
      entryFile: input.generatedWebsite.sourceFiles[0]?.relativePath ?? "src/App.svelte",
      indexFile: "dist/index.html",
    };
  }

  private async writeFileWithinRoot(relativeRoot: string, relativePath: string, contents: string): Promise<void> {
    assertSafeRelativePath(relativePath);

    const absoluteRoot = join(this.options.rootDirectory, relativeRoot);
    const absoluteFile = join(absoluteRoot, relativePath);
    const rootToFile = relative(absoluteRoot, absoluteFile);

    if (rootToFile.startsWith("..") || rootToFile === "") {
      throw new Error(`Preview Artifact path escapes its root: ${relativePath}`);
    }

    await mkdir(dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, contents, "utf8");
  }
}

function stripLeadingDist(relativePath: string): string {
  return relativePath === "dist" ? "index.html" : relativePath.replace(/^dist\//, "");
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`${label} must be a lowercase URL-safe segment.`);
  }
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../") || normalized.startsWith("/")) {
    throw new Error(`Preview Artifact path is not safe: ${relativePath}`);
  }
}
