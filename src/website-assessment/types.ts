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
  websiteExplorationEvidence?: WebsiteExplorationEvidence[];
  operatorNotes?: string[];
};

export type WebsiteExplorationEvidence = {
  pageUrl: string;
  htmlArtifactUri: string;
  reviewerReadyTextExcerpt: string;
  desktopScreenshot: WebsiteScreenshotInput;
  mobileScreenshot: WebsiteScreenshotInput;
  deterministicChecks: WebsiteDeterministicChecks;
  browserObservations: string[];
};

export type ExplorationBudget = {
  maxPages: number;
  maxScreenshots: number;
  timeoutMs: number;
  allowedDomains: string[];
  forbiddenActions: string[];
};

export type ReviewContextBudget = {
  maxTextCharacters: number;
};

export type WebsiteExplorerOutput = {
  evidence: WebsiteExplorationEvidence[];
  reviewContext: WebsiteAssessmentInput;
};

export type WebsiteExplorerAgent = {
  explore(input: {
    prospectBusiness: ProspectBusinessDetail | ProspectBusiness;
    currentWebsiteUrl: string;
    assessmentRunId: string;
    explorationBudget: ExplorationBudget;
    reviewContextBudget: ReviewContextBudget;
  }): Promise<WebsiteExplorerOutput>;
};

export type WebsiteExplorationArtifactStore = {
  writeLandingPageEvidence(input: {
    prospectBusinessId: string;
    assessmentRunId: string;
    pageUrl: string;
    rawHtml: string;
    reviewerReadyTextExcerpt: string;
    desktopScreenshot: {
      contents: Buffer;
      capturedAt: Date;
    };
    mobileScreenshot: {
      contents: Buffer;
      capturedAt: Date;
    };
    deterministicChecks: WebsiteDeterministicChecks;
    browserObservations: string[];
  }): Promise<WebsiteExplorationEvidence>;
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
  websiteExplorationEvidence?: WebsiteExplorationEvidence[];
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
