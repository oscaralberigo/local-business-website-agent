import type { ProspectBusinessDetail } from "../discovery/types.js";

export type PreviewPublicationComplianceDecision = {
  allowed: boolean;
  reasons: string[];
};

export function evaluatePreviewPublicationCompliance(
  prospectBusiness: ProspectBusinessDetail,
): PreviewPublicationComplianceDecision {
  const reasons: string[] = [];
  const previewWebsite = prospectBusiness.previewWebsite;

  if (!previewWebsite) {
    reasons.push("Preview Website is required before publication.");
    return { allowed: false, reasons };
  }

  if (previewWebsite.status !== "ready_for_review") {
    reasons.push("Only a Preview Website ready for review can be published.");
  }

  if (previewWebsite.buildMetadata.status !== "built") {
    reasons.push("Preview Website generation must succeed before publication.");
  }

  if (!prospectBusiness.websiteAssessment?.previewEligibility.effectiveEligible) {
    reasons.push("Preview Eligibility must allow publication.");
  }

  if ((prospectBusiness.businessContext?.excludedResearchData.length ?? 0) > 0) {
    reasons.push("Forbidden Research Data must be excluded before publication.");
  }

  const supportedStatements = new Set(
    prospectBusiness.businessContext?.supportedClaims
      .filter((claim) => claim.allowedForGeneration)
      .map((claim) => claim.statement) ?? [],
  );
  const unsupportedSourceReferences = previewWebsite.sourceReferences.filter(
    (reference) => !supportedStatements.has(reference.statement),
  );

  if (unsupportedSourceReferences.length > 0) {
    reasons.push("Preview Website source references must all map to Supported Claims.");
  }

  return { allowed: reasons.length === 0, reasons };
}
