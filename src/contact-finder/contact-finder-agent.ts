import type { ProspectRegistry } from "../discovery/types.js";
import { isSuitableForOperatorApproval } from "./contact-suitability.js";
import type {
  ContactCandidate,
  ContactEvidence,
  ContactEvidenceSourceType,
  ContactEvidenceStore,
  ContactFinderAgent,
  ContactSearchSource,
} from "./types.js";

const sourceOrder: ContactEvidenceSourceType[] = [
  "business_website",
  "google_places",
  "official_profile",
  "official_search_result",
];

export function createContactFinderAgent(input: {
  searchSources: ContactSearchSource[];
}): ContactFinderAgent {
  const searchSources = [...input.searchSources].sort(
    (left, right) => sourceOrder.indexOf(left.sourceType) - sourceOrder.indexOf(right.sourceType),
  );

  return {
    async findContact({ prospectBusiness }) {
      const candidates: ContactCandidate[] = [];

      for (const searchSource of searchSources) {
        const sourceCandidates = await searchSource.search({ prospectBusiness });
        candidates.push(...sourceCandidates);

        if (sourceCandidates.some(isSuitableForOperatorApproval)) {
          break;
        }
      }

      return candidates;
    },
  };
}

export async function findContactEvidenceForProspect(input: {
  prospectBusinessId: string;
  prospectRegistry: ProspectRegistry;
  contactEvidenceStore: ContactEvidenceStore;
  contactFinderAgent: ContactFinderAgent;
}): Promise<ContactEvidence[]> {
  const prospectBusiness = await input.prospectRegistry.getProspectBusinessDetail(
    input.prospectBusinessId,
  );
  const candidates = await input.contactFinderAgent.findContact({ prospectBusiness });

  return input.contactEvidenceStore.saveContactEvidence({
    prospectBusinessId: input.prospectBusinessId,
    candidates,
  });
}
