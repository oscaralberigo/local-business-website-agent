import { randomUUID } from "node:crypto";
import type {
  BusinessContextFact,
  BusinessContextSource,
  SupportedClaim,
} from "./types.js";

export function deriveSupportedClaims(input: {
  prospectBusinessId: string;
  sources: BusinessContextSource[];
  facts: BusinessContextFact[];
}): SupportedClaim[] {
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));

  return input.facts.flatMap((fact) => {
    const source = sourcesById.get(fact.sourceId);
    if (!fact.allowedForGeneration || !source?.termsCompliance.allowed) {
      return [];
    }

    return [
      {
        id: randomUUID(),
        prospectBusinessId: input.prospectBusinessId,
        statement: fact.value,
        evidence: [{ sourceId: source.id, factId: fact.id }],
        allowedForGeneration: true,
      },
    ];
  });
}
