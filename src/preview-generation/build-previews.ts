import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const artifactRoot = process.env.PREVIEW_ARTIFACT_ROOT ?? "previews";

await validatePreviewArtifacts(artifactRoot);

async function validatePreviewArtifacts(rootDirectory: string): Promise<void> {
  if (!(await pathExists(rootDirectory))) {
    console.log(`No Preview Artifacts found at ${rootDirectory}.`);
    return;
  }

  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const previewDirectories = entries.filter((entry) => entry.isDirectory());

  for (const previewDirectory of previewDirectories) {
    const previewRoot = join(rootDirectory, previewDirectory.name);
    const sourceDirectory = join(previewRoot, "source");
    const staticDirectory = join(previewRoot, "dist");
    const appSvelte = join(sourceDirectory, "src", "App.svelte");
    const indexHtml = join(staticDirectory, "index.html");

    await assertPathExists(appSvelte, previewDirectory.name);
    await assertPathExists(indexHtml, previewDirectory.name);

    const index = await readFile(indexHtml, "utf8");
    if (!/<meta\s+name=["']robots["']\s+content=["']noindex["']/i.test(index)) {
      throw new Error(`Preview Artifact ${previewDirectory.name} is missing noindex metadata.`);
    }
  }

  console.log(`Validated ${previewDirectories.length} Preview Artifact(s).`);
}

async function assertPathExists(path: string, slug: string): Promise<void> {
  if (!(await pathExists(path))) {
    throw new Error(`Preview Artifact ${slug} is missing ${path}.`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
