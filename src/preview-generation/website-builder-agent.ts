import type { ProspectBusinessDetail } from "../discovery/types.js";
import type { WebsiteBuilderAgent, WebsiteDesignPlan } from "./types.js";
import type { SupportedClaim } from "../business-context/types.js";

export function createWebsiteBuilderAgent(): WebsiteBuilderAgent {
  return {
    async build(input) {
      return buildGeneratedSvelteWebsite(input);
    },
  };
}

function buildGeneratedSvelteWebsite(input: {
  prospectBusiness: ProspectBusinessDetail;
  designPlan: WebsiteDesignPlan;
  supportedClaims: SupportedClaim[];
}) {
  const firstSupportedClaim = input.supportedClaims.find((claim) => claim.allowedForGeneration);
  const contentJson = {
    hero: {
      headline: input.prospectBusiness.name,
      supportedClaim: firstSupportedClaim?.statement ?? "",
      primaryGoal: input.designPlan.primaryGoal,
    },
    navigation: input.designPlan.navigation.items,
    sections: input.designPlan.sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.contentGuidance,
    })),
    reviewDisclosure: "Preview concept prepared for operator review before publication.",
  };
  const serializedContent = JSON.stringify(contentJson, null, 2);

  return {
    contentJson,
    sourceFiles: [
      {
        relativePath: "package.json",
        contents: JSON.stringify(
          {
            type: "module",
            scripts: {
              build: "vite build",
            },
            dependencies: {
              "@sveltejs/vite-plugin-svelte": "^4.0.0",
              svelte: "^5.0.0",
              vite: "^5.0.0",
            },
            devDependencies: {},
          },
          null,
          2,
        ),
      },
      {
        relativePath: "src/App.svelte",
        contents: renderAppSvelte(input.prospectBusiness, input.designPlan, serializedContent),
      },
    ],
    staticAssets: [
      {
        relativePath: "dist/index.html",
        contents: renderStaticIndex(input.prospectBusiness, input.designPlan, contentJson),
      },
      {
        relativePath: "dist/styles.css",
        contents: renderStaticCss(),
      },
    ],
    buildMetadata: {
      builder: "svelte" as const,
      command: "npm run build:previews",
      status: "built" as const,
      generatedAt: new Date().toISOString(),
    },
  };
}

function renderAppSvelte(
  prospectBusiness: ProspectBusinessDetail,
  designPlan: WebsiteDesignPlan,
  serializedContent: string,
): string {
  return `<script>
  const content = ${serializedContent};
  const sections = content.sections;
</script>

<svelte:head>
  <title>${escapeHtml(prospectBusiness.name)} Preview Website</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="preview-site">
  <header class="hero">
    <nav aria-label="Primary navigation">
      {#each content.navigation as item}
        <a href={"#" + item.toLowerCase()}>{item}</a>
      {/each}
    </nav>
    <p class="eyebrow">${escapeHtml(designPlan.pitchAngle.replaceAll("_", " "))}</p>
    <h1>${escapeHtml(prospectBusiness.name)}</h1>
    {#if content.hero.supportedClaim}
      <p>{content.hero.supportedClaim}</p>
    {/if}
  </header>
  {#each sections as section}
    <section id={section.id}>
      <h2>{section.title}</h2>
      <p>{section.body}</p>
    </section>
  {/each}
  <footer>{content.reviewDisclosure}</footer>
</main>
`;
}

function renderStaticIndex(
  prospectBusiness: ProspectBusinessDetail,
  designPlan: WebsiteDesignPlan,
  contentJson: {
    hero: {
      headline: string;
      supportedClaim: string;
      primaryGoal: string;
    };
    navigation: string[];
    sections: Array<{
      id: string;
      title: string;
      body: string;
    }>;
    reviewDisclosure: string;
  },
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(prospectBusiness.name)} Preview Website</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="app">
      <main class="preview-site">
        <header class="hero">
          <nav aria-label="Primary navigation">
            ${contentJson.navigation
              .map((item) => `<a href="#${escapeHtml(anchorForNavigationItem(item))}">${escapeHtml(item)}</a>`)
              .join("")}
          </nav>
          <p class="eyebrow">${escapeHtml(designPlan.pitchAngle.replaceAll("_", " "))}</p>
          <h1>${escapeHtml(contentJson.hero.headline || prospectBusiness.name)}</h1>
          ${
            contentJson.hero.supportedClaim
              ? `<p>${escapeHtml(contentJson.hero.supportedClaim)}</p>`
              : ""
          }
        </header>
        ${contentJson.sections
          .map(
            (section) => `
              <section id="${escapeHtml(section.id)}">
                <h2>${escapeHtml(section.title)}</h2>
                <p>${escapeHtml(section.body)}</p>
              </section>
            `,
          )
          .join("")}
        <footer>${escapeHtml(contentJson.reviewDisclosure)}</footer>
      </main>
    </div>
  </body>
</html>
`;
}

function anchorForNavigationItem(item: string): string {
  return item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function renderStaticCss(): string {
  return `:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2933;
  background: #f7faf8;
}

body {
  margin: 0;
}

.preview-site {
  min-height: 100vh;
}

.hero {
  display: grid;
  gap: 16px;
  padding: clamp(32px, 8vw, 96px);
  background: #f1f7f4;
}

.hero h1 {
  max-width: 720px;
  margin: 0;
  font-size: clamp(2rem, 6vw, 4.5rem);
  line-height: 1;
}

.hero p {
  max-width: 680px;
  font-size: 1.125rem;
}

section,
footer {
  padding: 32px clamp(24px, 7vw, 80px);
}
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return character;
    }
  });
}
