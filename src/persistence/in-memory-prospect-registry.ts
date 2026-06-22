import { randomUUID } from "node:crypto";
import { excludeSourceDisallowedFacts } from "../business-context/source-compliance.js";
import { deriveSupportedClaims } from "../business-context/supported-claims.js";
import type {
  BusinessContext,
  BusinessContextFact,
  BusinessContextSource,
  BusinessContextStore,
  ExcludedResearchData,
  ResearchMode,
} from "../business-context/types.js";
import { classifyContactApprovalStatus, shouldPersistContactCandidate } from "../contact-finder/contact-suitability.js";
import type {
  ContactCandidate,
  ContactEvidence,
  ContactEvidenceSourceType,
  ContactEvidenceStore,
} from "../contact-finder/types.js";
import type {
  DiscoveryAppearance,
  DiscoveryRun,
  DiscoveryRunDetail,
  GooglePlaceResult,
  ProspectBusiness,
  ProspectBusinessDetail,
  ProspectRegistry,
  StartDiscoveryRunInput,
  WorkflowFailure,
} from "../discovery/types.js";
import { derivePreviewEligibility } from "../website-assessment/preview-eligibility.js";
import type {
  SaveWebsiteAssessmentInput,
  WebsiteAssessment,
  WebsiteAssessmentStore,
} from "../website-assessment/types.js";

export class InMemoryProspectRegistry
  implements ProspectRegistry, BusinessContextStore, WebsiteAssessmentStore, ContactEvidenceStore
{
  private readonly discoveryRuns = new Map<string, DiscoveryRun>();
  private readonly prospectBusinesses = new Map<string, ProspectBusiness>();
  private readonly prospectIdsByGooglePlaceId = new Map<string, string>();
  private readonly discoveryAppearances: DiscoveryAppearance[] = [];
  private readonly workflowFailures: WorkflowFailure[] = [];
  private readonly businessContexts = new Map<string, BusinessContext>();
  private readonly websiteAssessments = new Map<string, WebsiteAssessment>();
  private readonly contactEvidenceByProspect = new Map<string, ContactEvidence[]>();

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
        appearedAt: new Date(),
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
      createdAt: new Date(),
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

  async getProspectBusinessDetail(prospectBusinessId: string): Promise<ProspectBusinessDetail> {
    const prospectBusiness = this.requireProspectBusiness(prospectBusinessId);
    const appearanceHistory = this.discoveryAppearances
      .filter((appearance) => appearance.prospectBusinessId === prospectBusinessId)
      .map((appearance) => ({
        ...appearance,
        discoveryRun: this.requireDiscoveryRun(appearance.discoveryRunId),
      }))
      .sort((left, right) => left.appearedAt.getTime() - right.appearedAt.getTime());

    if (appearanceHistory.length === 0) {
      throw new Error(`Discovery Appearances not found for Prospect Business: ${prospectBusinessId}`);
    }

    return {
      ...prospectBusiness,
      firstDiscoveredRun: appearanceHistory[0]!.discoveryRun,
      latestDiscoveredRun: appearanceHistory[appearanceHistory.length - 1]!.discoveryRun,
      appearanceHistory,
      businessContext: this.businessContexts.get(prospectBusinessId),
      contactEvidence: this.contactEvidenceByProspect.get(prospectBusinessId) ?? [],
      websiteAssessment: this.websiteAssessments.get(prospectBusinessId),
    };
  }

  async saveContactEvidence(input: {
    prospectBusinessId: string;
    candidates: ContactCandidate[];
    foundAt?: Date;
  }): Promise<ContactEvidence[]> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const foundAt = input.foundAt ?? new Date();
    const contactEvidence = input.candidates
      .filter(shouldPersistContactCandidate)
      .map((candidate) => ({
        id: randomUUID(),
        prospectBusinessId: input.prospectBusinessId,
        emailAddress: candidate.emailAddress,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        confidence: candidate.confidence,
        roleClassification: candidate.roleClassification,
        outreachApprovalStatus: classifyContactApprovalStatus(candidate),
        reason: candidate.reason,
        foundAt,
      }));

    const existingApprovedContactEvidence = (
      this.contactEvidenceByProspect.get(input.prospectBusinessId) ?? []
    ).filter((evidence) => evidence.outreachApprovalStatus === "approved");
    const allContactEvidence = [...existingApprovedContactEvidence, ...contactEvidence];

    this.contactEvidenceByProspect.set(input.prospectBusinessId, allContactEvidence);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: deriveProspectStatusFromContactEvidence(allContactEvidence),
    });

    return contactEvidence;
  }

  async approveContactEvidence(input: {
    prospectBusinessId: string;
    contactEvidenceId: string;
    actor: string;
    reason: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const contactEvidence = this.contactEvidenceByProspect.get(input.prospectBusinessId) ?? [];
    const evidence = contactEvidence.find((candidate) => candidate.id === input.contactEvidenceId);
    if (!evidence) {
      throw new Error(`Contact Evidence not found: ${input.contactEvidenceId}`);
    }
    if (evidence.outreachApprovalStatus === "blocked") {
      throw new Error(`Blocked Contact Evidence cannot be approved: ${input.contactEvidenceId}`);
    }

    const approvedEvidence: ContactEvidence = {
      ...evidence,
      outreachApprovalStatus: "approved",
      approvedAt: input.approvedAt ?? new Date(),
      approvedBy: input.actor,
      approvalReason: input.reason,
    };

    this.contactEvidenceByProspect.set(
      input.prospectBusinessId,
      contactEvidence.map((candidate) =>
        candidate.id === input.contactEvidenceId ? approvedEvidence : candidate,
      ),
    );
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "drafting_outreach",
    });

    return approvedEvidence;
  }

  async addVerifiedContactEvidence(input: {
    prospectBusinessId: string;
    emailAddress: string;
    sourceUrl: string;
    sourceType: ContactEvidenceSourceType;
    reason: string;
    actor: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const approvedAt = input.approvedAt ?? new Date();
    const evidence: ContactEvidence = {
      id: randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      emailAddress: input.emailAddress,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      confidence: 1,
      roleClassification: "role",
      outreachApprovalStatus: "approved",
      reason: input.reason,
      foundAt: approvedAt,
      approvedAt,
      approvedBy: input.actor,
      approvalReason: input.reason,
    };
    const contactEvidence = this.contactEvidenceByProspect.get(input.prospectBusinessId) ?? [];

    this.contactEvidenceByProspect.set(input.prospectBusinessId, [...contactEvidence, evidence]);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "drafting_outreach",
    });

    return evidence;
  }

  async saveWebsiteAssessment(input: SaveWebsiteAssessmentInput): Promise<WebsiteAssessment> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const previewEligibility = derivePreviewEligibility({
      opportunityCategory: input.reviewerOutput.opportunityCategory,
      override: input.previewEligibilityOverride,
    });
    const websiteAssessment: WebsiteAssessment = {
      id: randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      currentWebsiteUrl: input.input.currentWebsiteUrl,
      htmlText: input.input.htmlText,
      deterministicChecks: input.input.deterministicChecks,
      desktopScreenshot: input.input.desktopScreenshot,
      mobileScreenshot: input.input.mobileScreenshot,
      opportunityCategory: input.reviewerOutput.opportunityCategory,
      confidence: input.reviewerOutput.confidence,
      summary: input.reviewerOutput.summary,
      evidence: input.reviewerOutput.evidence,
      recommendedPitchAngle: input.reviewerOutput.recommendedPitchAngle,
      safeClaims: input.reviewerOutput.outreachSafeClaims,
      reviewNotes: input.reviewerOutput.operatorReviewNotes,
      previewEligibility,
      assessedAt: input.assessedAt ?? new Date(),
    };

    this.websiteAssessments.set(input.prospectBusinessId, websiteAssessment);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: previewEligibility.effectiveEligible ? "assessment_complete" : "not_preview_eligible",
    });
    return websiteAssessment;
  }

  async getWebsiteAssessment(prospectBusinessId: string): Promise<WebsiteAssessment | undefined> {
    this.requireProspectBusiness(prospectBusinessId);
    return this.websiteAssessments.get(prospectBusinessId);
  }

  async overridePreviewEligibility(input: {
    prospectBusinessId: string;
    eligible: boolean;
    reason: string;
    actor: string;
    overriddenAt?: Date;
  }): Promise<WebsiteAssessment> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const existingAssessment = this.websiteAssessments.get(input.prospectBusinessId);
    if (!existingAssessment) {
      throw new Error(`Website Assessment not found: ${input.prospectBusinessId}`);
    }

    const previewEligibility = derivePreviewEligibility({
      opportunityCategory: existingAssessment.opportunityCategory,
      override: {
        eligible: input.eligible,
        reason: input.reason,
        actor: input.actor,
        overriddenAt: input.overriddenAt ?? new Date(),
      },
    });
    const updatedAssessment = {
      ...existingAssessment,
      previewEligibility,
    };

    this.websiteAssessments.set(input.prospectBusinessId, updatedAssessment);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: previewEligibility.effectiveEligible ? "assessment_complete" : "not_preview_eligible",
    });
    return updatedAssessment;
  }

  async saveBusinessContext(input: {
    prospectBusinessId: string;
    researchMode: ResearchMode;
    sources: Array<Omit<BusinessContextSource, "id" | "prospectBusinessId" | "retrievedAt"> & {
      id?: string;
      retrievedAt?: Date;
    }>;
    facts: Array<Omit<BusinessContextFact, "id" | "prospectBusinessId"> & { id?: string }>;
    excludedResearchData: Array<
      Omit<ExcludedResearchData, "id" | "prospectBusinessId" | "excludedAt"> & {
        id?: string;
        excludedAt?: Date;
      }
    >;
  }): Promise<BusinessContext> {
    this.requireProspectBusiness(input.prospectBusinessId);
    const filteredContext = excludeSourceDisallowedFacts({
      sources: input.sources,
      facts: input.facts,
      excludedResearchData: input.excludedResearchData,
    });

    const sources = input.sources.map((source) => ({
      ...source,
      id: source.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      retrievedAt: source.retrievedAt ?? new Date(),
    }));
    const facts = filteredContext.facts.map((fact) => ({
      ...fact,
      id: fact.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
    }));
    const excludedResearchData = filteredContext.excludedResearchData.map((excluded) => ({
      ...excluded,
      id: excluded.id ?? randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      excludedAt: excluded.excludedAt ?? new Date(),
    }));
    const businessContext: BusinessContext = {
      prospectBusinessId: input.prospectBusinessId,
      researchMode: input.researchMode,
      sources,
      facts,
      excludedResearchData,
      supportedClaims: deriveSupportedClaims({
        prospectBusinessId: input.prospectBusinessId,
        sources,
        facts,
      }),
    };

    this.businessContexts.set(input.prospectBusinessId, businessContext);
    return businessContext;
  }

  private createProspectBusiness(place: GooglePlaceResult): ProspectBusiness {
    const now = new Date();
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
      firstSeenAt: now,
      lastSeenAt: now,
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
      lastSeenAt: new Date(),
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

function deriveProspectStatusFromContactEvidence(
  contactEvidence: ContactEvidence[],
): ProspectBusiness["prospectStatus"] {
  if (contactEvidence.some((evidence) => evidence.outreachApprovalStatus === "approved")) {
    return "drafting_outreach";
  }

  if (
    contactEvidence.some((evidence) => evidence.outreachApprovalStatus === "pending_operator_approval")
  ) {
    return "finding_contact";
  }

  return "contact_unavailable";
}
