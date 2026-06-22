export type DiscoveryMode = "place_search" | "radius_search";

export type ProspectStatus = "discovered" | "failed";

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
};

export type DiscoveryAppearance = {
  discoveryRunId: string;
  prospectBusinessId: string;
  rank: number;
  providerPayload: unknown;
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
  listDiscoveryRuns(): Promise<DiscoveryRunDetail[]>;
};
