import type { ProspectBusinessDetail } from "../discovery/types.js";

export type ResearchMode = "expanded";

export type ResearchToolName =
  | "google_places"
  | "business_website"
  | "search_results"
  | "compliant_page_extraction";

export type SourceTermsCompliance = {
  allowed: boolean;
  checkedAt: Date;
  robotsDirective?: string;
  notes?: string;
};

export type BusinessContextSourceInput = {
  id?: string;
  sourceType: ResearchToolName;
  title?: string;
  url?: string;
  retrievedAt?: Date;
  termsCompliance: SourceTermsCompliance;
};

export type BusinessContextSource = BusinessContextSourceInput & {
  id: string;
  prospectBusinessId: string;
  retrievedAt: Date;
};

export type BusinessContextFactInput = {
  id?: string;
  sourceId: string;
  label: string;
  value: string;
  sourceQuote?: string;
  allowedForGeneration: boolean;
};

export type BusinessContextFact = BusinessContextFactInput & {
  id: string;
  prospectBusinessId: string;
};

export type ForbiddenResearchDataReason =
  | "personal_contact"
  | "staff_personal_profile"
  | "home_address"
  | "sensitive_inference"
  | "login_gated"
  | "paywalled"
  | "access_restricted"
  | "source_terms_disallowed";

export type ExcludedResearchDataInput = {
  id?: string;
  sourceId?: string;
  label: string;
  valueSummary: string;
  reason: ForbiddenResearchDataReason;
  excludedAt?: Date;
};

export type ExcludedResearchData = ExcludedResearchDataInput & {
  id: string;
  prospectBusinessId: string;
  excludedAt: Date;
};

export type SupportedClaimEvidence = {
  sourceId: string;
  factId: string;
};

export type SupportedClaim = {
  id: string;
  prospectBusinessId: string;
  statement: string;
  evidence: SupportedClaimEvidence[];
  allowedForGeneration: boolean;
};

export type BusinessContextResearchResult = {
  researchMode: ResearchMode;
  sources: BusinessContextSourceInput[];
  facts: BusinessContextFactInput[];
  excludedResearchData: ExcludedResearchDataInput[];
};

export type BusinessContext = {
  prospectBusinessId: string;
  researchMode: ResearchMode;
  sources: BusinessContextSource[];
  facts: BusinessContextFact[];
  excludedResearchData: ExcludedResearchData[];
  supportedClaims: SupportedClaim[];
};

export type BusinessContextResearcher = {
  research(input: {
    prospectBusiness: ProspectBusinessDetail;
    researchMode: ResearchMode;
  }): Promise<BusinessContextResearchResult>;
};

export type BusinessContextResearchToolResult = {
  sources: BusinessContextSourceInput[];
  facts: BusinessContextFactInput[];
  excludedResearchData: ExcludedResearchDataInput[];
};

export type BusinessContextResearchTool = {
  toolName: ResearchToolName;
  gather(input: {
    prospectBusiness: ProspectBusinessDetail;
    researchMode: ResearchMode;
  }): Promise<BusinessContextResearchToolResult>;
};

export type BusinessContextStore = {
  saveBusinessContext(input: {
    prospectBusinessId: string;
    researchMode: ResearchMode;
    sources: BusinessContextSourceInput[];
    facts: BusinessContextFactInput[];
    excludedResearchData: ExcludedResearchDataInput[];
  }): Promise<BusinessContext>;
};
