import { randomUUID } from "node:crypto";

import type { ProspectBusiness, ProspectBusinessDetail } from "../discovery/types.js";
import type {
  ExplorationBudget,
  ReviewContextBudget,
  WebsiteAssessment,
  WebsiteAssessmentInput,
  WebsiteAssessmentStore,
  WebsiteExplorerAgent,
  WebsiteReviewerAgent,
} from "./types.js";

export async function assessWebsiteOpportunity(input: {
  prospectBusiness: ProspectBusinessDetail | ProspectBusiness;
  websiteExplorerAgent?: WebsiteExplorerAgent;
  reviewerAgent: WebsiteReviewerAgent;
  assessmentStore: WebsiteAssessmentStore;
  input: WebsiteAssessmentInput;
  assessmentRunId?: string;
  explorationBudget?: Partial<ExplorationBudget>;
  reviewContextBudget?: Partial<ReviewContextBudget>;
}): Promise<WebsiteAssessment> {
  const assessmentRunId = input.assessmentRunId ?? randomUUID();
  const currentWebsiteUrl = input.input.currentWebsiteUrl ?? input.prospectBusiness.websiteUrl;
  const reviewInput =
    input.websiteExplorerAgent && currentWebsiteUrl
      ? await exploreWebsiteForReview({
          prospectBusiness: input.prospectBusiness,
          websiteExplorerAgent: input.websiteExplorerAgent,
          currentWebsiteUrl,
          assessmentRunId,
          input: input.input,
          explorationBudget: input.explorationBudget,
          reviewContextBudget: input.reviewContextBudget,
        })
      : input.input;

  const reviewerOutput = await input.reviewerAgent.review({
    prospectBusiness: input.prospectBusiness,
    input: reviewInput,
  });

  return input.assessmentStore.saveWebsiteAssessment({
    prospectBusinessId: input.prospectBusiness.id,
    input: reviewInput,
    reviewerOutput,
  });
}

async function exploreWebsiteForReview(input: {
  prospectBusiness: ProspectBusinessDetail | ProspectBusiness;
  websiteExplorerAgent: WebsiteExplorerAgent;
  currentWebsiteUrl: string;
  assessmentRunId: string;
  input: WebsiteAssessmentInput;
  explorationBudget?: Partial<ExplorationBudget>;
  reviewContextBudget?: Partial<ReviewContextBudget>;
}): Promise<WebsiteAssessmentInput> {
  const exploration = await input.websiteExplorerAgent.explore({
    prospectBusiness: input.prospectBusiness,
    currentWebsiteUrl: input.currentWebsiteUrl,
    assessmentRunId: input.assessmentRunId,
    explorationBudget: {
      ...defaultExplorationBudget(input.currentWebsiteUrl),
      ...input.explorationBudget,
    },
    reviewContextBudget: {
      maxTextCharacters: 6000,
      ...input.reviewContextBudget,
    },
  });

  return {
    ...input.input,
    ...exploration.reviewContext,
    websiteExplorationEvidence: exploration.evidence,
  };
}

function defaultExplorationBudget(currentWebsiteUrl: string): ExplorationBudget {
  return {
    maxPages: 3,
    maxScreenshots: 6,
    timeoutMs: 30000,
    allowedDomains: [new URL(currentWebsiteUrl).hostname],
    forbiddenActions: [
      "search_engines",
      "unrelated_external_domains",
      "form_submission",
      "login_bypass",
      "payments",
      "downloads",
    ],
  };
}
