import type { BusinessContext, SupportedClaim } from "../business-context/types.js";
import type { ProspectBusinessDetail } from "../discovery/types.js";
import type { WebsiteAssessment } from "../website-assessment/types.js";

export type PreviewSiteType =
  | "single_page"
  | "multi_section"
  | "multi_page_mock"
  | "landing_plus_booking"
  | "other";

export type PreviewPrimaryGoal =
  | "call"
  | "booking"
  | "enquiry"
  | "directions"
  | "order"
  | "menu_view"
  | "trust_building"
  | "other";

export type PreviewPitchAngle =
  | "first_website"
  | "modern_upgrade"
  | "technical_fix"
  | "social_to_owned_site"
  | "other";

export type PreviewNavigationStyle =
  | "simple_links"
  | "hamburger_mobile"
  | "prominent_cta"
  | "other";

export type WebsiteDesignPlanSection = {
  id: string;
  title: string;
  purpose: string;
  requiredEvidence: string[];
  contentGuidance: string;
};

export type WebsiteDesignPlanFeature = {
  name: string;
  purpose: string;
  evidence: string;
};

export type WebsiteDesignPlan = {
  siteType: PreviewSiteType;
  primaryGoal: PreviewPrimaryGoal;
  targetCustomer: string;
  pitchAngle: PreviewPitchAngle;
  sections: WebsiteDesignPlanSection[];
  navigation: {
    style: PreviewNavigationStyle;
    items: string[];
  };
  features: WebsiteDesignPlanFeature[];
  avoid: string[];
  operatorReviewNotes: string[];
};

export type PreviewSourceFile = {
  relativePath: string;
  contents: string;
};

export type PreviewBuildMetadata = {
  builder: "svelte";
  command: string;
  status: "built" | "failed";
  [key: string]: unknown;
};

export type GeneratedSvelteWebsite = {
  contentJson: Record<string, unknown>;
  sourceFiles: PreviewSourceFile[];
  staticAssets: PreviewSourceFile[];
  buildMetadata: PreviewBuildMetadata;
};

export type PreviewArtifact = {
  sourceRoot: string;
  staticRoot: string;
  entryFile: string;
  indexFile: string;
};

export type PreviewSourceReference = {
  sourceId: string;
  factId: string;
  statement: string;
};

export type OperatorEditableField = {
  path: string;
  label: string;
  value: string | number | boolean | null;
};

export type PreviewWebsiteOperatorEdit = {
  path: string;
  value: string | number | boolean | null;
};

export type PreviewWebsiteStatus = "ready_for_review" | "published" | "failed";

export type PreviewPublication = {
  previewUrl: string;
  previewUrlPath: string;
  deploymentId: string;
  buildId: string;
  noindex: boolean;
  publishedAt: Date;
  approvedBy: string;
  approvalReason: string;
  unpublishedAt?: Date;
  unpublishedBy?: string;
};

export type PreviewWebsite = {
  id: string;
  prospectBusinessId: string;
  slug: string;
  status: PreviewWebsiteStatus;
  designPlan: WebsiteDesignPlan;
  contentJson: Record<string, unknown>;
  sourceReferences: PreviewSourceReference[];
  buildMetadata: PreviewBuildMetadata;
  artifact: PreviewArtifact;
  operatorEditableFields: OperatorEditableField[];
  publication?: PreviewPublication;
  createdAt: Date;
  updatedAt: Date;
};

export type SavePreviewWebsiteInput = Omit<PreviewWebsite, "id" | "createdAt" | "updatedAt">;

export type WebsiteDesignerAgent = {
  design(input: {
    prospectBusiness: ProspectBusinessDetail;
    businessContext: BusinessContext;
    websiteAssessment: WebsiteAssessment;
  }): Promise<WebsiteDesignPlan>;
};

export type WebsiteBuilderAgent = {
  build(input: {
    prospectBusiness: ProspectBusinessDetail;
    designPlan: WebsiteDesignPlan;
    supportedClaims: SupportedClaim[];
  }): Promise<GeneratedSvelteWebsite>;
};

export type PreviewArtifactStore = {
  writeArtifacts(input: {
    prospectBusinessId: string;
    slug: string;
    generatedWebsite: GeneratedSvelteWebsite;
  }): Promise<PreviewArtifact>;
};

export type PreviewHost = {
  publish(input: {
    previewWebsite: PreviewWebsite;
    previewBaseUrl: string;
  }): Promise<PreviewPublication>;
  unpublish(input: { previewUrlPath: string }): Promise<void>;
};

export type PreviewWebsiteStore = {
  savePreviewWebsite(input: SavePreviewWebsiteInput): Promise<PreviewWebsite>;
  updatePreviewWebsiteOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: PreviewWebsiteOperatorEdit[];
  }): Promise<PreviewWebsite>;
  publishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
    approvalReason: string;
    publication: PreviewPublication;
  }): Promise<PreviewWebsite>;
  unpublishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
  }): Promise<PreviewWebsite>;
};
