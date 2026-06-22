import type {
  BusinessContextResearcher,
  BusinessContextResearchResult,
  BusinessContextResearchTool,
} from "./types.js";
import { excludeSourceDisallowedFacts } from "./source-compliance.js";

const approvedResearchTools = new Set([
  "google_places",
  "business_website",
  "search_results",
  "compliant_page_extraction",
]);

export function createBusinessContextResearcher(input: {
  researchTools: BusinessContextResearchTool[];
}): BusinessContextResearcher {
  for (const researchTool of input.researchTools) {
    if (!approvedResearchTools.has(researchTool.toolName)) {
      throw new Error(`Research Tool is not approved for Business Context research: ${researchTool.toolName}`);
    }
  }

  return {
    async research({ prospectBusiness, researchMode }): Promise<BusinessContextResearchResult> {
      const toolResults = await Promise.all(
        input.researchTools.map((researchTool) =>
          researchTool.gather({
            prospectBusiness,
            researchMode,
          }),
        ),
      );

      const sources = toolResults.flatMap((toolResult) => toolResult.sources);
      const { facts, excludedResearchData } = excludeSourceDisallowedFacts({
        sources,
        facts: toolResults.flatMap((toolResult) => toolResult.facts),
        excludedResearchData: toolResults.flatMap((toolResult) => toolResult.excludedResearchData),
      });

      return {
        researchMode,
        sources,
        facts,
        excludedResearchData,
      };
    },
  };
}
