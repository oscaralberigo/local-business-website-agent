import { randomUUID } from "node:crypto";
import type {
  DiscoveryAppearance,
  DiscoveryRun,
  DiscoveryRunDetail,
  GooglePlaceResult,
  ProspectBusiness,
  ProspectRegistry,
  StartDiscoveryRunInput,
  WorkflowFailure,
} from "../discovery/types.js";

export class InMemoryProspectRegistry implements ProspectRegistry {
  private readonly discoveryRuns = new Map<string, DiscoveryRun>();
  private readonly prospectBusinesses = new Map<string, ProspectBusiness>();
  private readonly prospectIdsByGooglePlaceId = new Map<string, string>();
  private readonly discoveryAppearances: DiscoveryAppearance[] = [];
  private readonly workflowFailures: WorkflowFailure[] = [];

  async createDiscoveryRun(input: StartDiscoveryRunInput): Promise<DiscoveryRun> {
    const discoveryRun: DiscoveryRun = {
      id: randomUUID(),
      source: "google_places",
      mode: input.mode,
      searchTerm: input.searchTerm,
      searchLocation: input.searchLocation,
      discoveryLimit: input.discoveryLimit,
      status: "running",
      queryMetadata: {
        mode: input.mode,
        searchTerm: input.searchTerm,
        searchLocation: input.searchLocation,
        discoveryLimit: input.discoveryLimit,
      },
      resultMetadata: {},
    };

    this.discoveryRuns.set(discoveryRun.id, discoveryRun);
    return discoveryRun;
  }

  async recordDiscoveredProspect(input: {
    discoveryRunId: string;
    rank: number;
    place: GooglePlaceResult;
  }): Promise<ProspectBusiness> {
    const existingProspectId = this.prospectIdsByGooglePlaceId.get(input.place.googlePlaceId);
    const prospect = existingProspectId
      ? this.updateExistingProspect(existingProspectId, input.place)
      : this.createProspectBusiness(input.place);

    const alreadyAppeared = this.discoveryAppearances.some(
      (appearance) =>
        appearance.discoveryRunId === input.discoveryRunId &&
        appearance.prospectBusinessId === prospect.id,
    );

    if (!alreadyAppeared) {
      this.discoveryAppearances.push({
        discoveryRunId: input.discoveryRunId,
        prospectBusinessId: prospect.id,
        rank: input.rank,
        providerPayload: input.place.sourcePayload,
      });
    }

    return prospect;
  }

  async completeDiscoveryRun(input: {
    discoveryRunId: string;
    providerResultCount: number;
    processedResultCount: number;
  }): Promise<void> {
    const discoveryRun = this.requireDiscoveryRun(input.discoveryRunId);
    this.discoveryRuns.set(discoveryRun.id, {
      ...discoveryRun,
      status: "completed",
      resultMetadata: {
        providerResultCount: input.providerResultCount,
        processedResultCount: input.processedResultCount,
      },
    });
  }

  async failDiscoveryRun(input: {
    discoveryRunId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
  }): Promise<void> {
    const discoveryRun = this.requireDiscoveryRun(input.discoveryRunId);
    this.discoveryRuns.set(discoveryRun.id, {
      ...discoveryRun,
      status: "failed",
      resultMetadata: {
        errorSummary: input.errorSummary,
      },
    });
    this.workflowFailures.push({
      id: randomUUID(),
      discoveryRunId: input.discoveryRunId,
      failedStep: input.failedStep,
      errorSummary: input.errorSummary,
      retryable: input.retryable,
      operatorVisibleStatus: "visible",
      provider: "google_places",
    });
  }

  async getDiscoveryRunDetail(discoveryRunId: string): Promise<DiscoveryRunDetail> {
    const discoveryRun = this.requireDiscoveryRun(discoveryRunId);
    const appearances = this.discoveryAppearances.filter(
      (appearance) => appearance.discoveryRunId === discoveryRunId,
    );

    return {
      ...discoveryRun,
      appearances,
      discoveredProspects: appearances.map((appearance) =>
        this.requireProspectBusiness(appearance.prospectBusinessId),
      ),
      workflowFailures: this.workflowFailures.filter(
        (failure) => failure.discoveryRunId === discoveryRunId,
      ),
    };
  }

  async listDiscoveryRuns(): Promise<DiscoveryRunDetail[]> {
    return Promise.all(
      Array.from(this.discoveryRuns.values()).map((discoveryRun) =>
        this.getDiscoveryRunDetail(discoveryRun.id),
      ),
    );
  }

  private createProspectBusiness(place: GooglePlaceResult): ProspectBusiness {
    const prospectBusiness: ProspectBusiness = {
      id: randomUUID(),
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      formattedAddress: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      websiteUrl: place.websiteUrl,
      phoneNumber: place.phoneNumber,
      categories: place.categories,
      prospectStatus: "discovered",
      sourceData: place.sourcePayload,
    };

    this.prospectBusinesses.set(prospectBusiness.id, prospectBusiness);
    this.prospectIdsByGooglePlaceId.set(place.googlePlaceId, prospectBusiness.id);
    return prospectBusiness;
  }

  private updateExistingProspect(
    prospectBusinessId: string,
    place: GooglePlaceResult,
  ): ProspectBusiness {
    const existingProspect = this.requireProspectBusiness(prospectBusinessId);
    const updatedProspect: ProspectBusiness = {
      ...existingProspect,
      name: place.name,
      formattedAddress: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      websiteUrl: place.websiteUrl,
      phoneNumber: place.phoneNumber,
      categories: place.categories,
      sourceData: place.sourcePayload,
    };

    this.prospectBusinesses.set(updatedProspect.id, updatedProspect);
    return updatedProspect;
  }

  private requireDiscoveryRun(discoveryRunId: string): DiscoveryRun {
    const discoveryRun = this.discoveryRuns.get(discoveryRunId);
    if (!discoveryRun) {
      throw new Error(`Discovery Run not found: ${discoveryRunId}`);
    }
    return discoveryRun;
  }

  private requireProspectBusiness(prospectBusinessId: string): ProspectBusiness {
    const prospectBusiness = this.prospectBusinesses.get(prospectBusinessId);
    if (!prospectBusiness) {
      throw new Error(`Prospect Business not found: ${prospectBusinessId}`);
    }
    return prospectBusiness;
  }
}
