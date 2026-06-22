import { randomBytes, randomUUID } from "node:crypto";
import { cp, readFile, rm } from "node:fs/promises";
import { join, normalize, relative } from "node:path";
import express from "express";

import type { PreviewHost, PreviewPublication, PreviewWebsite } from "../preview-generation/types.js";

export class FileSystemPreviewHost implements PreviewHost {
  constructor(private readonly options: { rootDirectory: string }) {}

  async publish(input: {
    previewWebsite: PreviewWebsite;
    previewBaseUrl: string;
  }): Promise<PreviewPublication> {
    const sourceRoot = this.absoluteArtifactPath(input.previewWebsite.artifact.staticRoot);
    const indexFile = join(sourceRoot, stripLeadingDist(input.previewWebsite.artifact.indexFile));
    const indexHtml = await readFile(indexFile, "utf8");
    if (!hasNoindex(indexHtml)) {
      throw new Error("Preview Artifact index.html must include noindex metadata before publication.");
    }

    const token = randomBytes(12).toString("hex");
    const targetRoot = join(this.options.rootDirectory, "published", token);
    await cp(sourceRoot, targetRoot, { recursive: true });

    const previewUrlPath = `/published-previews/${token}/`;
    return {
      previewUrl: new URL(previewUrlPath, ensureTrailingSlash(input.previewBaseUrl)).toString(),
      previewUrlPath,
      deploymentId: randomUUID(),
      buildId: buildIdFromCommand(input.previewWebsite.buildMetadata.command),
      noindex: true,
      publishedAt: new Date(),
      approvedBy: "",
      approvalReason: "",
    };
  }

  async unpublish(input: { previewUrlPath: string }): Promise<void> {
    const token = tokenFromPreviewUrlPath(input.previewUrlPath);
    await rm(join(this.options.rootDirectory, "published", token), { recursive: true, force: true });
  }

  private absoluteArtifactPath(relativePath: string): string {
    assertSafeRelativePath(relativePath);

    const absolutePath = join(this.options.rootDirectory, relativePath);
    const rootToPath = relative(this.options.rootDirectory, absolutePath);
    if (rootToPath.startsWith("..") || rootToPath === "") {
      throw new Error(`Preview Artifact path escapes its root: ${relativePath}`);
    }

    return absolutePath;
  }
}

export function publishedPreviewStaticMiddleware(rootDirectory: string): express.Router {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  router.use(express.static(join(rootDirectory, "published"), { index: "index.html" }));
  return router;
}

function hasNoindex(indexHtml: string): boolean {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(indexHtml);
}

function stripLeadingDist(relativePath: string): string {
  return relativePath === "dist" ? "index.html" : relativePath.replace(/^dist\//, "");
}

function buildIdFromCommand(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../") || normalized.startsWith("/")) {
    throw new Error(`Preview Artifact path is not safe: ${relativePath}`);
  }
}

function tokenFromPreviewUrlPath(previewUrlPath: string): string {
  const match = /^\/published-previews\/([a-f0-9]{24})\/?$/.exec(previewUrlPath);
  if (!match) {
    throw new Error(`Published Preview URL path is not valid: ${previewUrlPath}`);
  }

  return match[1]!;
}
