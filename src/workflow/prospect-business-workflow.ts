import type { AuditTrailGateway } from "../audit/auditTrail.js";
import type { BusinessContextResearcher, BusinessContextStore, ResearchMode } from "../business-context/types.js";
import type { ContactEvidenceStore, ContactFinderAgent } from "../contact-finder/types.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import type {
  BusinessDiscoverySource,
  DiscoveryRunDetail,
  ProspectBusinessDetail,
  ProspectRegistry,
  StartDiscoveryRunInput,
} from "../discovery/types.js";
import { sendApprovedOutreachEmail } from "../outreach/send-outreach-email.js";
import type {
  DraftOutreachStore,
  EmailSendingProvider,
  OutreachDrafterAgent,
  OutreachEmailStore,
  OutreachSuppressionStore,
  OutreachWorkflowFailureStore,
} from "../outreach/types.js";
import { generatePreviewWebsite } from "../preview-generation/generate-preview-website.js";
import type {
  PreviewArtifactStore,
  PreviewHost,
  PreviewWebsiteStore,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "../preview-generation/types.js";
import { evaluatePreviewPublicationCompliance } from "../preview-publication/preview-publication-compliance.js";
import { assessWebsiteOpportunity } from "../website-assessment/assess-website-opportunity.js";
import type { WebsiteAssessmentStore, WebsiteExplorerAgent, WebsiteReviewerAgent } from "../website-assessment/types.js";

export type ProspectBusinessWorkflowRegistry = ProspectRegistry &
  BusinessContextStore &
  WebsiteAssessmentStore &
  ContactEvidenceStore &
  PreviewWebsiteStore &
  DraftOutreachStore &
  OutreachEmailStore &
  OutreachSuppressionStore &
  OutreachWorkflowFailureStore;

export type ProspectBusinessWorkflowResult = {
  discoveryRun: DiscoveryRunDetail;
  prospectBusiness: ProspectBusinessDetail;
};

export async function runProspectBusinessWorkflow(input: {
  discovery: {
    request: StartDiscoveryRunInput;
    discoverySource: BusinessDiscoverySource;
  };
  registry: ProspectBusinessWorkflowRegistry;
  auditTrail: AuditTrailGateway;
  businessContextResearcher: BusinessContextResearcher;
  websiteExplorerAgent?: WebsiteExplorerAgent;
  websiteReviewerAgent: WebsiteReviewerAgent;
  websiteDesignerAgent: WebsiteDesignerAgent;
  websiteBuilderAgent: WebsiteBuilderAgent;
  previewArtifactStore: PreviewArtifactStore;
  previewHost: PreviewHost;
  contactFinderAgent: ContactFinderAgent;
  outreachDrafterAgent: OutreachDrafterAgent;
  emailProvider: EmailSendingProvider;
  reviewPolicy: {
    requireReviewBeforePreviewPublication: boolean;
    requireReviewBeforeOutreachSending: boolean;
  };
  operator: {
    actor: string;
    autoApproveContactEvidence?: boolean;
  };
  outreachSettings: {
    fromEmail: string;
    senderIdentity: string;
    postalAddress: string;
    optOutWording: string;
  };
  previewBaseUrl?: string;
  researchMode?: ResearchMode;
}): Promise<ProspectBusinessWorkflowResult> {
  const discoveryRun = await runDiscovery({
    request: input.discovery.request,
    discoverySource: input.discovery.discoverySource,
    registry: input.registry,
  });
  await input.auditTrail.record({
    actor: input.operator.actor,
    eventType: `discovery_run.${discoveryRun.status}`,
    summary: `Discovery Run ${discoveryRun.id} ${discoveryRun.status}.`,
    metadata: { discoveryRunId: discoveryRun.id },
  });

  const prospect = discoveryRun.discoveredProspects[0];
  if (!prospect) {
    throw new Error("Discovery Run did not return any Prospect Businesses.");
  }

  let prospectBusiness = await input.registry.getProspectBusinessDetail(prospect.id);
  const researchResult = await input.businessContextResearcher.research({
    prospectBusiness,
    researchMode: input.researchMode ?? "expanded",
  });
  await input.registry.saveBusinessContext({
    prospectBusinessId: prospectBusiness.id,
    researchMode: researchResult.researchMode,
    sources: researchResult.sources,
    facts: researchResult.facts,
    excludedResearchData: researchResult.excludedResearchData,
  });
  await input.auditTrail.record({
    actor: input.operator.actor,
    eventType: "business_context.researched",
    summary: `Business Context researched for Prospect Business ${prospectBusiness.id}.`,
    metadata: { prospectBusinessId: prospectBusiness.id },
  });

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  await assessWebsiteOpportunity({
    prospectBusiness,
    websiteExplorerAgent: input.websiteExplorerAgent,
    reviewerAgent: input.websiteReviewerAgent,
    assessmentStore: input.registry,
    input: {
      currentWebsiteUrl: prospectBusiness.websiteUrl,
      deterministicChecks: {
        pageLoad: prospectBusiness.websiteUrl ? "reachable" : "not_checked",
        https: prospectBusiness.websiteUrl?.startsWith("https://") ? "valid" : "not_checked",
        mobileViewport: "rendered",
        contactInformationFound: Boolean(prospectBusiness.phoneNumber),
        servicesFound: true,
        brokenAssetsOrConsoleErrors: false,
        thirdPartyOnlyPresence: false,
      },
    },
  });
  await input.auditTrail.record({
    actor: input.operator.actor,
    eventType: "website_assessment.completed",
    summary: `Website Assessment completed for Prospect Business ${prospectBusiness.id}.`,
    metadata: { prospectBusinessId: prospectBusiness.id },
  });

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  await generatePreviewWebsite({
    prospectBusiness,
    previewArtifactStore: input.previewArtifactStore,
    previewWebsiteStore: input.registry,
    websiteBuilderAgent: input.websiteBuilderAgent,
    websiteDesignerAgent: input.websiteDesignerAgent,
  });
  await input.auditTrail.record({
    actor: input.operator.actor,
    eventType: "preview_website.generated",
    summary: `Preview Website generated for Prospect Business ${prospectBusiness.id}.`,
    metadata: { prospectBusinessId: prospectBusiness.id },
  });

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  if (!input.reviewPolicy.requireReviewBeforePreviewPublication) {
    await publishPreviewWebsite({
      prospectBusiness,
      registry: input.registry,
      previewHost: input.previewHost,
      auditTrail: input.auditTrail,
      actor: input.operator.actor,
      previewBaseUrl: input.previewBaseUrl ?? "https://previews.example.com",
    });
  }

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  const candidates = await input.contactFinderAgent.findContact({ prospectBusiness });
  const contactEvidence = await input.registry.saveContactEvidence({
    prospectBusinessId: prospectBusiness.id,
    candidates,
  });
  const contactToApprove = contactEvidence.find(
    (evidence) => evidence.outreachApprovalStatus === "pending_operator_approval",
  );
  if (input.operator.autoApproveContactEvidence && contactToApprove) {
    await input.registry.approveContactEvidence({
      prospectBusinessId: prospectBusiness.id,
      contactEvidenceId: contactToApprove.id,
      actor: input.operator.actor,
      reason: "Mocked workflow auto-approved suitable Contact Evidence.",
    });
    await input.auditTrail.record({
      actor: input.operator.actor,
      eventType: "contact_evidence.approved",
      summary: `Contact Evidence approved for Prospect Business ${prospectBusiness.id}.`,
      metadata: { prospectBusinessId: prospectBusiness.id, contactEvidenceId: contactToApprove.id },
    });
  }

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  if (!hasApprovedContactEvidence(prospectBusiness)) {
    return { discoveryRun, prospectBusiness };
  }

  const draft = await input.outreachDrafterAgent.draft({
    prospectBusiness,
    senderIdentity: input.outreachSettings.senderIdentity,
    postalAddress: input.outreachSettings.postalAddress,
    optOutWording: input.outreachSettings.optOutWording,
  });
  await input.registry.saveDraftOutreach(draft);
  await input.auditTrail.record({
    actor: input.operator.actor,
    eventType: "draft_outreach.created",
    summary: `Draft Outreach created for Prospect Business ${prospectBusiness.id}.`,
    metadata: { prospectBusinessId: prospectBusiness.id },
  });

  prospectBusiness = await input.registry.getProspectBusinessDetail(prospectBusiness.id);
  if (!input.reviewPolicy.requireReviewBeforeOutreachSending) {
    await sendApprovedOutreachEmail({
      prospectBusiness,
      emailProvider: input.emailProvider,
      outreachEmailStore: input.registry,
      suppressionStore: input.registry,
      workflowFailureStore: input.registry,
      actor: input.operator.actor,
      fromEmail: input.outreachSettings.fromEmail,
      senderIdentity: input.outreachSettings.senderIdentity,
      postalAddress: input.outreachSettings.postalAddress,
      optOutWording: input.outreachSettings.optOutWording,
      approvalReason: "Review Policy skipped outreach Human Review.",
    });
    await input.auditTrail.record({
      actor: input.operator.actor,
      eventType: "outreach_email.sent",
      summary: `Outreach Email sent for Prospect Business ${prospectBusiness.id}.`,
      metadata: { prospectBusinessId: prospectBusiness.id },
    });
  }

  return {
    discoveryRun,
    prospectBusiness: await input.registry.getProspectBusinessDetail(prospectBusiness.id),
  };
}

async function publishPreviewWebsite(input: {
  prospectBusiness: ProspectBusinessDetail;
  registry: ProspectBusinessWorkflowRegistry;
  previewHost: PreviewHost;
  auditTrail: AuditTrailGateway;
  actor: string;
  previewBaseUrl: string;
}): Promise<void> {
  const complianceDecision = evaluatePreviewPublicationCompliance(input.prospectBusiness);
  if (!complianceDecision.allowed) {
    const errorSummary = complianceDecision.reasons.join(" ");
    await input.registry.recordOutreachWorkflowFailure({
      prospectBusinessId: input.prospectBusiness.id,
      failedStep: "preview_publication_compliance_gate",
      errorSummary,
      retryable: false,
      provider: "preview_host",
    });
    throw new Error(errorSummary);
  }

  const publication = await input.previewHost.publish({
    previewWebsite: input.prospectBusiness.previewWebsite!,
    previewBaseUrl: input.previewBaseUrl,
  });
  await input.registry.publishPreviewWebsite({
    prospectBusinessId: input.prospectBusiness.id,
    actor: input.actor,
    approvalReason: "Review Policy skipped preview publication Human Review.",
    publication,
  });
  await input.auditTrail.record({
    actor: input.actor,
    eventType: "preview_website.published",
    summary: `Preview Website published for Prospect Business ${input.prospectBusiness.id}.`,
    metadata: { prospectBusinessId: input.prospectBusiness.id },
  });
}

function hasApprovedContactEvidence(prospectBusiness: ProspectBusinessDetail): boolean {
  return (prospectBusiness.contactEvidence ?? []).some(
    (evidence) =>
      evidence.outreachApprovalStatus === "approved" &&
      evidence.roleClassification === "role" &&
      evidence.confidence >= 0.7,
  );
}
