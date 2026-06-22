import type { BusinessContext } from "../business-context/types.js";
import type { ContactEvidence } from "../contact-finder/types.js";
import type { WebsiteAssessment } from "../website-assessment/types.js";

export type DiscoveryMode = "place_search" | "radius_search";

export type ProspectStatus =
  | "discovered"
  | "researching"
  | "research_complete"
  | "assessing_website"
  | "assessment_complete"
  | "not_preview_eligible"
  | "generating_preview"
  | "preview_ready_for_review"
  | "preview_published"
  | "finding_contact"
  | "contact_unavailable"
  | "drafting_outreach"
  | "outreach_ready_for_review"
  | "outreach_sent"
  | "replied"
  | "work_won"
  | "archived"
  | "failed";

export type DiscoveryRunStatus = "running" | "completed" | "failed";

export type SearchLocation = {
  label: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  viewport?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
};

export type StartDiscoveryRunInput = {
  mode: DiscoveryMode;
  searchTerm: string;
  searchLocation: SearchLocation;
  discoveryLimit: number;
};

export type GooglePlacesSearchRequest = StartDiscoveryRunInput;

export type GooglePlaceResult = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  websiteUrl?: string;
  phoneNumber?: string;
  categories: string[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  sourcePayload: unknown;
};

export type BusinessDiscoverySource = {
  searchPlaces(request: GooglePlacesSearchRequest): Promise<GooglePlaceResult[]>;
};

export type ProspectBusiness = {
  id: string;
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  websiteUrl?: string;
  phoneNumber?: string;
  categories: string[];
  prospectStatus: ProspectStatus;
  sourceData: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type DiscoveryAppearance = {
  discoveryRunId: string;
  prospectBusinessId: string;
  rank: number;
  providerPayload: unknown;
  appearedAt: Date;
};

export type DiscoveryAppearanceDetail = DiscoveryAppearance & {
  discoveryRun: DiscoveryRun;
};

export type WorkflowFailure = {
  id: string;
  discoveryRunId: string;
  failedStep: string;
  errorSummary: string;
  retryable: boolean;
  operatorVisibleStatus: string;
  provider: "google_places";
};

export type DiscoveryRun = {
  id: string;
  source: "google_places";
  mode: DiscoveryMode;
  searchTerm: string;
  searchLocation: SearchLocation;
  discoveryLimit: number;
  status: DiscoveryRunStatus;
  queryMetadata: Record<string, unknown>;
  resultMetadata: Record<string, unknown>;
};

export type DiscoveryRunDetail = DiscoveryRun & {
  discoveredProspects: ProspectBusiness[];
  appearances: DiscoveryAppearance[];
  workflowFailures: WorkflowFailure[];
};

export type ProspectBusinessDetail = ProspectBusiness & {
  firstDiscoveredRun: DiscoveryRun;
  latestDiscoveredRun: DiscoveryRun;
  appearanceHistory: DiscoveryAppearanceDetail[];
  businessContext?: BusinessContext;
  contactEvidence?: ContactEvidence[];
  websiteAssessment?: WebsiteAssessment;
};

export type ProspectRegistry = {
  createDiscoveryRun(input: StartDiscoveryRunInput): Promise<DiscoveryRun>;
  recordDiscoveredProspect(input: {
    discoveryRunId: string;
    rank: number;
    place: GooglePlaceResult;
  }): Promise<ProspectBusiness>;
  completeDiscoveryRun(input: {
    discoveryRunId: string;
    providerResultCount: number;
    processedResultCount: number;
  }): Promise<void>;
  failDiscoveryRun(input: {
    discoveryRunId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
  }): Promise<void>;
  getDiscoveryRunDetail(discoveryRunId: string): Promise<DiscoveryRunDetail>;
  getProspectBusinessDetail(prospectBusinessId: string): Promise<ProspectBusinessDetail>;
  listDiscoveryRuns(): Promise<DiscoveryRunDetail[]>;
};
