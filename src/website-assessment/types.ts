import type { ProspectBusiness, ProspectBusinessDetail } from "../discovery/types.js";

export type OpportunityCategory =
  | "no_website"
  | "website_unreachable"
  | "social_only"
  | "outdated_or_low_quality"
  | "modern_sufficient"
  | "unknown";

export type WebsiteAssessmentEvidenceSource =
  | "deterministic_check"
  | "html"
  | "desktop_screenshot"
  | "mobile_screenshot"
  | "operator_note";

export type RecommendedPitchAngle =
  | "first_website"
  | "modern_upgrade"
  | "technical_fix"
  | "social_to_owned_site"
  | "no_outreach"
  | "uncertain";

export type WebsiteAssessmentEvidence = {
  claim: string;
  source: WebsiteAssessmentEvidenceSource;
};

export type WebsiteScreenshotInput = {
  uri: string;
  capturedAt: Date;
};

export type WebsiteDeterministicChecks = {
  pageLoad: "reachable" | "unreachable" | "not_checked";
  https: "valid" | "invalid" | "missing" | "not_checked";
  mobileViewport: "rendered" | "failed" | "not_checked";
  contactInformationFound: boolean;
  servicesFound: boolean;
  brokenAssetsOrConsoleErrors: boolean;
  thirdPartyOnlyPresence: boolean;
};

export type WebsiteAssessmentInput = {
  currentWebsiteUrl?: string;
  htmlText?: string;
  deterministicChecks: WebsiteDeterministicChecks;
  desktopScreenshot?: WebsiteScreenshotInput;
  mobileScreenshot?: WebsiteScreenshotInput;
  operatorNotes?: string[];
};

export type WebsiteReviewerOutput = {
  opportunityCategory: OpportunityCategory;
  confidence: number;
  summary: string;
  evidence: WebsiteAssessmentEvidence[];
  recommendedPitchAngle: RecommendedPitchAngle;
  outreachSafeClaims: string[];
  operatorReviewNotes: string[];
};

export type WebsiteReviewerAgent = {
  review(input: {
    prospectBusiness: ProspectBusinessDetail | ProspectBusiness;
    input: WebsiteAssessmentInput;
  }): Promise<WebsiteReviewerOutput>;
};

export type PreviewEligibilityOverride = {
  eligible: boolean;
  reason: string;
  actor: string;
  overriddenAt: Date;
};

export type PreviewEligibility = {
  eligibleByDefault: boolean;
  effectiveEligible: boolean;
  requiresOperatorReview: boolean;
  overriddenByOperator: boolean;
  reason: string;
  override?: PreviewEligibilityOverride;
};

export type WebsiteAssessment = {
  id: string;
  prospectBusinessId: string;
  currentWebsiteUrl?: string;
  htmlText?: string;
  deterministicChecks: WebsiteDeterministicChecks;
  desktopScreenshot?: WebsiteScreenshotInput;
  mobileScreenshot?: WebsiteScreenshotInput;
  opportunityCategory: OpportunityCategory;
  confidence: number;
  summary: string;
  evidence: WebsiteAssessmentEvidence[];
  recommendedPitchAngle: RecommendedPitchAngle;
  safeClaims: string[];
  reviewNotes: string[];
  previewEligibility: PreviewEligibility;
  assessedAt: Date;
};

export type SaveWebsiteAssessmentInput = {
  prospectBusinessId: string;
  input: WebsiteAssessmentInput;
  reviewerOutput: WebsiteReviewerOutput;
  assessedAt?: Date;
  previewEligibilityOverride?: PreviewEligibilityOverride;
};

export type WebsiteAssessmentStore = {
  saveWebsiteAssessment(input: SaveWebsiteAssessmentInput): Promise<WebsiteAssessment>;
  overridePreviewEligibility(input: {
    prospectBusinessId: string;
    eligible: boolean;
    reason: string;
    actor: string;
    overriddenAt?: Date;
  }): Promise<WebsiteAssessment>;
  getWebsiteAssessment(prospectBusinessId: string): Promise<WebsiteAssessment | undefined>;
};
