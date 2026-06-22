import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileSystemPreviewArtifactStore } from "../src/preview-generation/file-system-preview-artifact-store.js";

describe("Preview Artifacts", () => {
  it("writes Generated Svelte Website source and built static assets under the preview slug", async () => {
    const root = await mkdtemp(join(tmpdir(), "preview-artifacts-"));
    const store = new FileSystemPreviewArtifactStore({ rootDirectory: root });

    try {
      const artifact = await store.writeArtifacts({
        prospectBusinessId: "prospect-1",
        slug: "detail-cafe-prospect-1",
        generatedWebsite: {
          contentJson: {
            hero: {
              headline: "House-roasted coffee in Beacon",
            },
          },
          sourceFiles: [
            {
              relativePath: "src/App.svelte",
              contents: "<script>export let content;</script><main>{content.hero.headline}</main>",
            },
          ],
          staticAssets: [
            {
              relativePath: "dist/index.html",
              contents: "<!doctype html><meta name=\"robots\" content=\"noindex\"><div id=\"app\"></div>",
            },
          ],
          buildMetadata: {
            builder: "svelte",
            command: "npm run build:previews",
            status: "built",
          },
        },
      });

      expect(artifact).toEqual({
        sourceRoot: "detail-cafe-prospect-1/source",
        staticRoot: "detail-cafe-prospect-1/dist",
        entryFile: "src/App.svelte",
        indexFile: "dist/index.html",
      });
      await expect(
        readFile(join(root, "detail-cafe-prospect-1/source/src/App.svelte"), "utf8"),
      ).resolves.toContain("{content.hero.headline}");
      await expect(
        readFile(join(root, "detail-cafe-prospect-1/dist/index.html"), "utf8"),
      ).resolves.toContain("noindex");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
