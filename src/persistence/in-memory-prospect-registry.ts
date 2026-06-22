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
  ManualTrackingStore,
  ProspectBusiness,
  ProspectBusinessDetail,
  ProspectRegistry,
  ReplyTracking,
  StartDiscoveryRunInput,
  WorkConversion,
  WorkConversionStatus,
  WorkflowFailure,
} from "../discovery/types.js";
import type {
  DraftOutreach,
  DraftOutreachOperatorEdit,
  DraftOutreachStore,
  OutreachEmail,
  OutreachEmailStore,
  OutreachSuppressionCheck,
  OutreachSuppressionStatus,
  OutreachSuppressionStore,
  OutreachWorkflowFailureStore,
  SaveDraftOutreachInput,
  SaveOutreachEmailInput,
} from "../outreach/types.js";
import type {
  PreviewPublication,
  PreviewWebsite,
  PreviewWebsiteOperatorEdit,
  PreviewWebsiteStore,
  SavePreviewWebsiteInput,
} from "../preview-generation/types.js";
import { derivePreviewEligibility } from "../website-assessment/preview-eligibility.js";
import type {
  SaveWebsiteAssessmentInput,
  WebsiteAssessment,
  WebsiteAssessmentStore,
} from "../website-assessment/types.js";

export class InMemoryProspectRegistry
  implements
    ProspectRegistry,
    BusinessContextStore,
    WebsiteAssessmentStore,
    ContactEvidenceStore,
    PreviewWebsiteStore,
    DraftOutreachStore,
    OutreachEmailStore,
    OutreachSuppressionStore,
    OutreachWorkflowFailureStore,
    ManualTrackingStore
{
  private readonly discoveryRuns = new Map<string, DiscoveryRun>();
  private readonly prospectBusinesses = new Map<string, ProspectBusiness>();
  private readonly prospectIdsByGooglePlaceId = new Map<string, string>();
  private readonly discoveryAppearances: DiscoveryAppearance[] = [];
  private readonly workflowFailures: WorkflowFailure[] = [];
  private readonly businessContexts = new Map<string, BusinessContext>();
  private readonly websiteAssessments = new Map<string, WebsiteAssessment>();
  private readonly contactEvidenceByProspect = new Map<string, ContactEvidence[]>();
  private readonly previewWebsites = new Map<string, PreviewWebsite>();
  private readonly draftOutreachByProspect = new Map<string, DraftOutreach>();
  private readonly outreachEmailsByProspect = new Map<string, OutreachEmail[]>();
  private readonly outreachSuppressionsByEmail = new Map<
    string,
    Exclude<OutreachSuppressionStatus, "clear">
  >();
  private readonly outreachSuppressionsByProspect = new Map<
    string,
    Exclude<OutreachSuppressionStatus, "clear">
  >();
  private readonly replyTrackingByProspect = new Map<string, ReplyTracking>();
  private readonly workConversionsByProspect = new Map<string, WorkConversion>();

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
      draftOutreach: this.draftOutreachByProspect.get(prospectBusinessId),
      outreachEmails: this.outreachEmailsByProspect.get(prospectBusinessId) ?? [],
      workflowFailures: this.workflowFailures.filter(
        (failure) => failure.prospectBusinessId === prospectBusinessId,
      ),
      previewWebsite: this.previewWebsites.get(prospectBusinessId),
      websiteAssessment: this.websiteAssessments.get(prospectBusinessId),
      replyTracking: this.replyTrackingByProspect.get(prospectBusinessId),
      workConversion: this.workConversionsByProspect.get(prospectBusinessId),
    };
  }

  async recordManualReply(input: {
    prospectBusinessId: string;
    repliedAt: Date;
    summary: string;
    notes?: string;
    actor: string;
  }): Promise<ProspectBusinessDetail> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    this.replyTrackingByProspect.set(input.prospectBusinessId, {
      prospectBusinessId: input.prospectBusinessId,
      repliedAt: input.repliedAt,
      summary: input.summary,
      notes: input.notes,
      recordedBy: input.actor,
      recordedAt: new Date(),
    });
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "replied",
    });

    return this.getProspectBusinessDetail(input.prospectBusinessId);
  }

  async savePreviewWebsite(input: SavePreviewWebsiteInput): Promise<PreviewWebsite> {
    const existing = this.previewWebsites.get(input.prospectBusinessId);
    const now = new Date();
    const previewWebsite: PreviewWebsite = {
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...input,
    };
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);

    this.previewWebsites.set(input.prospectBusinessId, previewWebsite);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: prospectStatusFromPreviewWebsite(previewWebsite),
    });

    return previewWebsite;
  }

  async updatePreviewWebsiteOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: PreviewWebsiteOperatorEdit[];
  }): Promise<PreviewWebsite> {
    const previewWebsite = this.requirePreviewWebsite(input.prospectBusinessId);
    const contentJson = structuredClone(previewWebsite.contentJson);
    const designPlan = structuredClone(previewWebsite.designPlan);
    const operatorEditableFields = structuredClone(previewWebsite.operatorEditableFields);
    const editablePaths = new Set(operatorEditableFields.map((field) => field.path));

    for (const edit of input.edits) {
      if (!editablePaths.has(edit.path)) {
        throw new Error(`Preview Website field is not reviewable: ${edit.path}`);
      }

      if (edit.path.startsWith("contentJson.")) {
        setRecordPath(contentJson, edit.path.slice("contentJson.".length), edit.value);
      } else if (edit.path.startsWith("designPlan.")) {
        setRecordPath(designPlan, edit.path.slice("designPlan.".length), edit.value);
      }

      const editableField = operatorEditableFields.find((field) => field.path === edit.path);
      if (editableField) {
        editableField.value = edit.value;
      }
    }

    const updatedPreviewWebsite: PreviewWebsite = {
      ...previewWebsite,
      contentJson,
      designPlan,
      operatorEditableFields,
      updatedAt: new Date(),
    };
    this.previewWebsites.set(input.prospectBusinessId, updatedPreviewWebsite);
    return updatedPreviewWebsite;
  }

  async publishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
    approvalReason: string;
    publication: PreviewPublication;
  }): Promise<PreviewWebsite> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const previewWebsite = this.requirePreviewWebsite(input.prospectBusinessId);
    const updatedPreviewWebsite: PreviewWebsite = {
      ...previewWebsite,
      status: "published",
      publication: {
        ...input.publication,
        approvedBy: input.actor,
        approvalReason: input.approvalReason,
      },
      updatedAt: new Date(),
    };

    this.previewWebsites.set(input.prospectBusinessId, updatedPreviewWebsite);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "preview_published",
    });

    return updatedPreviewWebsite;
  }

  async unpublishPreviewWebsite(input: {
    prospectBusinessId: string;
    actor: string;
  }): Promise<PreviewWebsite> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const previewWebsite = this.requirePreviewWebsite(input.prospectBusinessId);
    if (!previewWebsite.publication) {
      throw new Error(`Published Preview not found: ${input.prospectBusinessId}`);
    }

    const updatedPreviewWebsite: PreviewWebsite = {
      ...previewWebsite,
      status: "ready_for_review",
      publication: {
        ...previewWebsite.publication,
        unpublishedAt: new Date(),
        unpublishedBy: input.actor,
      },
      updatedAt: new Date(),
    };

    this.previewWebsites.set(input.prospectBusinessId, updatedPreviewWebsite);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "preview_ready_for_review",
    });

    return updatedPreviewWebsite;
  }

  async saveDraftOutreach(input: SaveDraftOutreachInput): Promise<DraftOutreach> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const existing = this.draftOutreachByProspect.get(input.prospectBusinessId);
    const now = new Date();
    const draftOutreach: DraftOutreach = {
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...input,
    };

    this.draftOutreachByProspect.set(input.prospectBusinessId, draftOutreach);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "outreach_ready_for_review",
    });

    return draftOutreach;
  }

  async updateDraftOutreachOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: DraftOutreachOperatorEdit;
  }): Promise<DraftOutreach> {
    const draftOutreach = this.draftOutreachByProspect.get(input.prospectBusinessId);
    if (!draftOutreach) {
      throw new Error(`Draft Outreach not found: ${input.prospectBusinessId}`);
    }

    const updatedDraftOutreach: DraftOutreach = {
      ...draftOutreach,
      subject: input.edits.subject ?? draftOutreach.subject,
      bodyText: input.edits.bodyText ?? draftOutreach.bodyText,
      bodyHtml: input.edits.bodyHtml ?? draftOutreach.bodyHtml,
      updatedAt: new Date(),
    };
    this.draftOutreachByProspect.set(input.prospectBusinessId, updatedDraftOutreach);
    return updatedDraftOutreach;
  }

  async saveOutreachEmail(input: SaveOutreachEmailInput): Promise<OutreachEmail> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    const now = new Date();
    const outreachEmail: OutreachEmail = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    const emails = this.outreachEmailsByProspect.get(input.prospectBusinessId) ?? [];

    this.outreachEmailsByProspect.set(input.prospectBusinessId, [...emails, outreachEmail]);
    if (input.sendStatus === "sent") {
      this.prospectBusinesses.set(input.prospectBusinessId, {
        ...prospectBusiness,
        prospectStatus: "outreach_sent",
      });
    }

    return outreachEmail;
  }

  async getOutreachSuppressionStatus(input: {
    prospectBusinessId: string;
    emailAddress: string;
  }): Promise<OutreachSuppressionCheck> {
    const emailSuppression = this.outreachSuppressionsByEmail.get(input.emailAddress.toLowerCase());
    const prospectSuppression = this.outreachSuppressionsByProspect.get(input.prospectBusinessId);
    const status = emailSuppression ?? prospectSuppression;

    return status ? { status } : { status: "clear" };
  }

  async recordOutreachSuppression(input: {
    prospectBusinessId?: string;
    emailAddress: string;
    status: Exclude<OutreachSuppressionStatus, "clear">;
    reason: string;
  }): Promise<void> {
    this.outreachSuppressionsByEmail.set(input.emailAddress.toLowerCase(), input.status);
    if (input.prospectBusinessId) {
      this.outreachSuppressionsByProspect.set(input.prospectBusinessId, input.status);
    }
  }

  async recordOutreachWorkflowFailure(input: {
    prospectBusinessId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
    provider: string;
  }): Promise<void> {
    this.workflowFailures.push({
      id: randomUUID(),
      prospectBusinessId: input.prospectBusinessId,
      failedStep: input.failedStep,
      errorSummary: input.errorSummary,
      retryable: input.retryable,
      operatorVisibleStatus: "visible",
      provider: input.provider,
      createdAt: new Date(),
    });

    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: "failed",
    });
  }

  async recordManualWorkConversion(input: {
    prospectBusinessId: string;
    conversionStatus: WorkConversionStatus;
    estimatedValueCents?: number;
    notes?: string;
    actor: string;
  }): Promise<ProspectBusinessDetail> {
    const prospectBusiness = this.requireProspectBusiness(input.prospectBusinessId);
    this.workConversionsByProspect.set(input.prospectBusinessId, {
      prospectBusinessId: input.prospectBusinessId,
      conversionStatus: input.conversionStatus,
      estimatedValueCents: input.estimatedValueCents,
      notes: input.notes,
      recordedBy: input.actor,
      recordedAt: new Date(),
    });
    this.prospectBusinesses.set(input.prospectBusinessId, {
      ...prospectBusiness,
      prospectStatus: input.conversionStatus === "work_won" ? "work_won" : prospectBusiness.prospectStatus,
    });

    return this.getProspectBusinessDetail(input.prospectBusinessId);
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

  private requirePreviewWebsite(prospectBusinessId: string): PreviewWebsite {
    const previewWebsite = this.previewWebsites.get(prospectBusinessId);
    if (!previewWebsite) {
      throw new Error(`Preview Website not found: ${prospectBusinessId}`);
    }
    return previewWebsite;
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

function prospectStatusFromPreviewWebsite(
  previewWebsite: PreviewWebsite,
): ProspectBusiness["prospectStatus"] {
  return previewWebsite.status === "published" ? "preview_published" : "preview_ready_for_review";
}

function setRecordPath(
  root: Record<string, unknown>,
  path: string,
  value: string | number | boolean | null,
): void {
  const segments = path.split(".");
  let current: Record<string, unknown> = root;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (typeof existing !== "object" || existing === null) {
      throw new Error(`Preview Website field is not editable: ${path}`);
    }
    current = existing as Record<string, unknown>;
  }

  current[segments[segments.length - 1]!] = value;
}
