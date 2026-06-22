import type {
  BusinessContextFactInput,
  BusinessContextSourceInput,
  ExcludedResearchDataInput,
} from "./types.js";

export function excludeSourceDisallowedFacts<
  Fact extends BusinessContextFactInput,
  Excluded extends ExcludedResearchDataInput,
>(input: {
  sources: BusinessContextSourceInput[];
  facts: Fact[];
  excludedResearchData: Excluded[];
}): {
  facts: Fact[];
  excludedResearchData: Array<Excluded | ExcludedResearchDataInput>;
} {
  const sourcesById = new Map(
    input.sources.flatMap((source) => (source.id ? [[source.id, source] as const] : [])),
  );
  const facts: Fact[] = [];
  const excludedResearchData: Array<Excluded | ExcludedResearchDataInput> = [
    ...input.excludedResearchData,
  ];

  for (const fact of input.facts) {
    const source = sourcesById.get(fact.sourceId);
    if (source && !source.termsCompliance.allowed) {
      excludedResearchData.push({
        sourceId: source.id,
        label: fact.label,
        valueSummary: fact.value,
        reason: "source_terms_disallowed",
      });
      continue;
    }

    facts.push(fact);
  }

  return { facts, excludedResearchData };
}
