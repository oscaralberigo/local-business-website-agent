import type { ProspectBusiness, ProspectBusinessDetail } from "../discovery/types.js";
import type {
  WebsiteAssessment,
  WebsiteAssessmentInput,
  WebsiteAssessmentStore,
  WebsiteReviewerAgent,
} from "./types.js";

export async function assessWebsiteOpportunity(input: {
  prospectBusiness: ProspectBusinessDetail | ProspectBusiness;
  reviewerAgent: WebsiteReviewerAgent;
  assessmentStore: WebsiteAssessmentStore;
  input: WebsiteAssessmentInput;
}): Promise<WebsiteAssessment> {
  const reviewerOutput = await input.reviewerAgent.review({
    prospectBusiness: input.prospectBusiness,
    input: input.input,
  });

  return input.assessmentStore.saveWebsiteAssessment({
    prospectBusinessId: input.prospectBusiness.id,
    input: input.input,
    reviewerOutput,
  });
}
