import type {
  OpportunityCategory,
  PreviewEligibility,
  PreviewEligibilityOverride,
} from "./types.js";

const DEFAULT_ELIGIBLE_CATEGORIES: OpportunityCategory[] = [
  "no_website",
  "website_unreachable",
  "social_only",
  "outdated_or_low_quality",
];

export function derivePreviewEligibility(input: {
  opportunityCategory: OpportunityCategory;
  override?: PreviewEligibilityOverride;
}): PreviewEligibility {
  const eligibleByDefault = DEFAULT_ELIGIBLE_CATEGORIES.includes(input.opportunityCategory);
  const requiresOperatorReview = input.opportunityCategory === "unknown";
  const effectiveEligible = input.override?.eligible ?? eligibleByDefault;

  return {
    eligibleByDefault,
    effectiveEligible,
    requiresOperatorReview,
    overriddenByOperator: input.override !== undefined,
    reason: previewEligibilityReason(input.opportunityCategory, eligibleByDefault, requiresOperatorReview),
    override: input.override,
  };
}

function previewEligibilityReason(
  opportunityCategory: OpportunityCategory,
  eligibleByDefault: boolean,
  requiresOperatorReview: boolean,
): string {
  if (requiresOperatorReview) {
    return "Unknown Website Opportunities require operator review before preview generation.";
  }

  if (opportunityCategory === "modern_sufficient") {
    return "Modern sufficient Prospect Businesses are stored but not preview-eligible by default.";
  }

  if (eligibleByDefault) {
    return "This Opportunity Category is preview-eligible by default.";
  }

  return "This Opportunity Category is not preview-eligible by default.";
}
