import express from "express";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { FileSystemPreviewHost, publishedPreviewStaticMiddleware } from "../src/preview-publication/file-system-preview-host.js";

describe("Published Preview hosting", () => {
  it("publishes a built noindex Preview Website to an unguessable public Preview URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "published-previews-"));
    const staticRoot = join(root, "detail-cafe-prospect-1/dist");
    await mkdir(staticRoot, { recursive: true });
    await writeFile(
      join(staticRoot, "index.html"),
      "<!doctype html><meta name=\"robots\" content=\"noindex\"><main>Detail Cafe</main>",
      "utf8",
    );
    const host = new FileSystemPreviewHost({ rootDirectory: root });

    try {
      const publication = await host.publish({
        previewBaseUrl: "https://previews.example.com",
        previewWebsite: {
          id: "preview-1",
          prospectBusinessId: "prospect-1",
          slug: "detail-cafe-prospect-1",
          status: "ready_for_review",
          designPlan: {
            siteType: "multi_section",
            primaryGoal: "menu_view",
            targetCustomer: "People in Beacon looking for coffee before visiting.",
            pitchAngle: "modern_upgrade",
            sections: [],
            navigation: { style: "prominent_cta", items: [] },
            features: [],
            avoid: [],
            operatorReviewNotes: [],
          },
          contentJson: {},
          sourceReferences: [],
          buildMetadata: {
            builder: "svelte",
            command: "npm run build:previews",
            status: "built",
          },
          artifact: {
            sourceRoot: "detail-cafe-prospect-1/source",
            staticRoot: "detail-cafe-prospect-1/dist",
            entryFile: "src/App.svelte",
            indexFile: "dist/index.html",
          },
          operatorEditableFields: [],
          createdAt: new Date("2026-06-22T19:00:00.000Z"),
          updatedAt: new Date("2026-06-22T19:00:00.000Z"),
        },
      });

      expect(publication.previewUrl).toMatch(
        /^https:\/\/previews\.example\.com\/published-previews\/[a-f0-9]{24}\/$/,
      );
      expect(publication.previewUrlPath).toMatch(/^\/published-previews\/[a-f0-9]{24}\/$/);
      expect(publication).toMatchObject({
        buildId: "npm-run-build-previews",
        noindex: true,
      });

      await expect(
        readFile(join(root, publication.previewUrlPath.replace("/published-previews/", "published/"), "index.html"), "utf8"),
      ).resolves.toContain("Detail Cafe");

      const app = express();
      app.use("/published-previews", publishedPreviewStaticMiddleware(root));
      const response = await request(app).get(publication.previewUrlPath).expect(200);

      expect(response.headers["x-robots-tag"]).toContain("noindex");
      expect(response.text).toContain("Detail Cafe");

      await host.unpublish({ previewUrlPath: publication.previewUrlPath });
      await request(app).get(publication.previewUrlPath).expect(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
