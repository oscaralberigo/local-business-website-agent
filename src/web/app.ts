import express, { type Request, type Response } from "express";
import { ZodError } from "zod";

import type { AuditTrailGateway } from "../audit/auditTrail.js";
import { buildOperatorSessionCookie, readOperatorSession, verifyOperatorCredentials } from "../auth/operatorSession.js";
import type { BusinessContextResearcher, BusinessContextStore } from "../business-context/types.js";
import { buildConfigReadout, type ReviewPolicy, type RuntimeConfiguration } from "../config/runtimeConfiguration.js";
import { findContactEvidenceForProspect } from "../contact-finder/contact-finder-agent.js";
import type {
  ContactEvidenceSourceType,
  ContactEvidenceStore,
  ContactFinderAgent,
} from "../contact-finder/types.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import { startDiscoveryRunSchema } from "../discovery/start-discovery-run-schema.js";
import type { BusinessDiscoverySource, ProspectRegistry } from "../discovery/types.js";
import {
  draftOutreachForProspect,
  evaluateOutreachCompliance,
} from "../outreach/outreach-drafter-agent.js";
import { sendApprovedOutreachEmail } from "../outreach/send-outreach-email.js";
import type {
  DraftOutreachOperatorEdit,
  DraftOutreachStore,
  EmailSendingProvider,
  OutreachEmailStore,
  OutreachSuppressionStore,
  OutreachWorkflowFailureStore,
  OutreachDrafterAgent,
} from "../outreach/types.js";
import { generatePreviewWebsite } from "../preview-generation/generate-preview-website.js";
import type {
  PreviewArtifactStore,
  PreviewHost,
  PreviewWebsiteOperatorEdit,
  PreviewWebsiteStore,
  WebsiteBuilderAgent,
  WebsiteDesignerAgent,
} from "../preview-generation/types.js";
import { publishedPreviewStaticMiddleware } from "../preview-publication/file-system-preview-host.js";
import { evaluatePreviewPublicationCompliance } from "../preview-publication/preview-publication-compliance.js";
import { assessWebsiteOpportunity } from "../website-assessment/assess-website-opportunity.js";
import type {
  WebsiteAssessmentInput,
  WebsiteAssessmentStore,
  WebsiteReviewerAgent,
  WebsiteScreenshotInput,
} from "../website-assessment/types.js";
import { renderDashboardPage, renderLoginPage } from "./rendering.js";

export type ReviewDashboardDependencies = {
  auditTrail: AuditTrailGateway;
  businessContextResearcher?: BusinessContextResearcher;
  contactFinderAgent?: ContactFinderAgent;
  configuration: RuntimeConfiguration;
  discoverySource?: BusinessDiscoverySource;
  emailProvider?: EmailSendingProvider;
  prospectRegistry?: ProspectRegistry &
    Partial<
      BusinessContextStore &
        WebsiteAssessmentStore &
        ContactEvidenceStore &
        PreviewWebsiteStore &
        DraftOutreachStore &
        OutreachEmailStore &
        OutreachSuppressionStore &
        OutreachWorkflowFailureStore
    >;
  outreachDrafterAgent?: OutreachDrafterAgent;
  previewArtifactStore?: PreviewArtifactStore;
  previewHost?: PreviewHost;
  websiteBuilderAgent?: WebsiteBuilderAgent;
  websiteDesignerAgent?: WebsiteDesignerAgent;
  websiteReviewerAgent?: WebsiteReviewerAgent;
};

export function createReviewDashboardApp({
  auditTrail,
  businessContextResearcher,
  contactFinderAgent,
  configuration,
  discoverySource,
  emailProvider,
  outreachDrafterAgent,
  prospectRegistry,
  previewArtifactStore,
  previewHost,
  websiteBuilderAgent,
  websiteDesignerAgent,
  websiteReviewerAgent,
}: ReviewDashboardDependencies) {
  const app = express();
  let reviewPolicy: ReviewPolicy = { ...configuration.reviewPolicy };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use("/published-previews", publishedPreviewStaticMiddleware(configuration.previewArtifactRoot));
  app.use("/preview-artifacts", requireOperator(configuration), express.static(configuration.previewArtifactRoot));

  app.get("/", (request, response) => {
    response.redirect(isAuthenticated(request, configuration) ? "/dashboard" : "/login");
  });

  app.get("/healthz", async (_request, response) => {
    const database = await auditTrail.verifyConnection();
    response.status(database.connected ? 200 : 503).json({ ok: database.connected, database });
  });

  app.get("/login", (request, response) => {
    if (isAuthenticated(request, configuration)) {
      response.redirect("/dashboard");
      return;
    }

    response.status(200).send(renderLoginPage());
  });

  app.post("/login", async (request, response) => {
    const username = stringFromBody(request.body.username);
    const password = stringFromBody(request.body.password);

    if (!verifyOperatorCredentials(configuration, username, password)) {
      response.status(401).send(renderLoginPage("Invalid operator credentials."));
      return;
    }

    await auditTrail.record({
      actor: configuration.operatorUsername,
      eventType: "operator.authenticated",
      summary: "Operator authenticated to the Review Dashboard."
    });

    response.setHeader("Set-Cookie", buildOperatorSessionCookie(configuration));
    response.redirect("/dashboard");
  });

  app.get("/dashboard", requireOperator(configuration), async (_request, response) => {
    const [database, auditEvents] = await Promise.all([auditTrail.verifyConnection(), auditTrail.listRecent(20)]);
    response
      .status(200)
      .send(renderDashboardPage({
        auditEvents,
        configReadout: buildConfigReadout(configuration),
        database,
        reviewPolicy,
      }));
  });

  app.patch("/api/review-policy", requireOperator(configuration), async (request, response) => {
    const nextReviewPolicy = reviewPolicyFromBody(request.body);
    if (!nextReviewPolicy) {
      response.status(400).json({
        error: "Review Policy requires requireReviewBeforePreviewPublication and requireReviewBeforeOutreachSending booleans.",
      });
      return;
    }

    reviewPolicy = nextReviewPolicy;
    await auditTrail.record({
      actor: configuration.operatorUsername,
      eventType: "review_policy.updated",
      summary: "Operator updated Review Policy toggles.",
      metadata: reviewPolicy,
    });

    response.status(200).json({ reviewPolicy });
  });

  app.get("/api/discovery-runs", requireOperator(configuration), async (_request, response) => {
    if (!prospectRegistry) {
      response.status(503).json({ error: "Prospect registry is not configured." });
      return;
    }

    response.status(200).json({ discoveryRuns: await prospectRegistry.listDiscoveryRuns() });
  });

  app.get("/api/discovery-runs/:id", requireOperator(configuration), async (request, response) => {
    if (!prospectRegistry) {
      response.status(503).json({ error: "Prospect registry is not configured." });
      return;
    }

    response.status(200).json({
      discoveryRun: await prospectRegistry.getDiscoveryRunDetail(request.params.id),
    });
  });

  app.get("/api/prospect-businesses/:id", requireOperator(configuration), async (request, response) => {
    if (!prospectRegistry) {
      response.status(503).json({ error: "Prospect registry is not configured." });
      return;
    }

    response.status(200).json({
      prospectBusiness: await prospectRegistry.getProspectBusinessDetail(request.params.id),
    });
  });

  app.post(
    "/api/prospect-businesses/:id/business-context-research",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.saveBusinessContext || !businessContextResearcher) {
        response.status(503).json({ error: "Business Context research is not configured." });
        return;
      }

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const researchResult = await businessContextResearcher.research({
        prospectBusiness,
        researchMode: "expanded",
      });

      const businessContext = await prospectRegistry.saveBusinessContext({
        prospectBusinessId: prospectBusiness.id,
        researchMode: researchResult.researchMode,
        sources: researchResult.sources,
        facts: researchResult.facts,
        excludedResearchData: researchResult.excludedResearchData,
      });

      response.status(201).json({ businessContext });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/website-assessment",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.saveWebsiteAssessment || !websiteReviewerAgent) {
        response.status(503).json({ error: "Website Assessment is not configured." });
        return;
      }

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const websiteAssessment = await assessWebsiteOpportunity({
        prospectBusiness,
        reviewerAgent: websiteReviewerAgent,
        assessmentStore: prospectRegistry as ProspectRegistry & WebsiteAssessmentStore,
        input: websiteAssessmentInputFromBody(request.body),
      });

      response.status(201).json({ websiteAssessment });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/contact-finding",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.saveContactEvidence || !contactFinderAgent) {
        response.status(503).json({ error: "Contact Finder is not configured." });
        return;
      }

      const contactEvidence = await findContactEvidenceForProspect({
        prospectBusinessId: request.params.id,
        prospectRegistry,
        contactEvidenceStore: prospectRegistry as ProspectRegistry & ContactEvidenceStore,
        contactFinderAgent,
      });

      response.status(201).json({ contactEvidence });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/contact-evidence/:contactEvidenceId/approval",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.approveContactEvidence) {
        response.status(503).json({ error: "Contact Evidence approval is not configured." });
        return;
      }

      const reason = optionalStringFromBody(request.body.reason);
      if (!reason) {
        response.status(400).json({ error: "reason is required." });
        return;
      }

      const contactEvidence = await prospectRegistry.approveContactEvidence({
        prospectBusinessId: request.params.id,
        contactEvidenceId: request.params.contactEvidenceId,
        actor: configuration.operatorUsername,
        reason,
      });

      response.status(200).json({ contactEvidence });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/contact-evidence",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.addVerifiedContactEvidence) {
        response.status(503).json({ error: "Verified Contact Evidence is not configured." });
        return;
      }

      const emailAddress = optionalStringFromBody(request.body.emailAddress);
      const sourceUrl = optionalStringFromBody(request.body.sourceUrl);
      const sourceType = contactEvidenceSourceTypeFromBody(request.body.sourceType);
      const reason = optionalStringFromBody(request.body.reason);

      if (!emailAddress || !sourceUrl || !sourceType || !reason) {
        response.status(400).json({
          error: "emailAddress, sourceUrl, sourceType, and reason are required.",
        });
        return;
      }

      const contactEvidence = await prospectRegistry.addVerifiedContactEvidence({
        prospectBusinessId: request.params.id,
        emailAddress,
        sourceUrl,
        sourceType,
        reason,
        actor: configuration.operatorUsername,
      });

      response.status(201).json({ contactEvidence });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/preview-eligibility-override",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.overridePreviewEligibility) {
        response.status(503).json({ error: "Preview Eligibility overrides are not configured." });
        return;
      }

      if (typeof request.body.eligible !== "boolean") {
        response.status(400).json({ error: "eligible must be a boolean." });
        return;
      }

      const reason = optionalStringFromBody(request.body.reason);
      if (!reason) {
        response.status(400).json({ error: "reason is required." });
        return;
      }

      const websiteAssessment = await prospectRegistry.overridePreviewEligibility({
        prospectBusinessId: request.params.id,
        eligible: request.body.eligible,
        reason,
        actor: configuration.operatorUsername,
      });

      response.status(200).json({ websiteAssessment });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/preview-website-generation",
    requireOperator(configuration),
    async (request, response) => {
      if (
        !prospectRegistry ||
        !prospectRegistry.savePreviewWebsite ||
        !previewArtifactStore ||
        !websiteBuilderAgent ||
        !websiteDesignerAgent
      ) {
        response.status(503).json({ error: "Preview Website generation is not configured." });
        return;
      }

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const previewWebsite = await generatePreviewWebsite({
        prospectBusiness,
        previewArtifactStore,
        previewWebsiteStore: prospectRegistry as ProspectRegistry & PreviewWebsiteStore,
        websiteBuilderAgent,
        websiteDesignerAgent,
      });

      response.status(201).json({ previewWebsite });
    },
  );

  app.patch(
    "/api/prospect-businesses/:id/preview-website/operator-edits",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.updatePreviewWebsiteOperatorEdits) {
        response.status(503).json({ error: "Preview Website edits are not configured." });
        return;
      }

      const edits = previewWebsiteOperatorEditsFromBody(request.body);
      if (edits.length === 0) {
        response.status(400).json({ error: "At least one Preview Website edit is required." });
        return;
      }

      const previewWebsite = await prospectRegistry.updatePreviewWebsiteOperatorEdits({
        prospectBusinessId: request.params.id,
        actor: configuration.operatorUsername,
        edits,
      });

      response.status(200).json({ previewWebsite });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/preview-website/publication",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.publishPreviewWebsite || !previewHost) {
        response.status(503).json({ error: "Preview Website publication is not configured." });
        return;
      }

      const approvalReason = optionalStringFromBody(request.body.approvalReason);
      const humanApprovalRequired = reviewPolicy.requireReviewBeforePreviewPublication;
      const policyApprovalReason = "Review Policy skipped preview Human Review.";
      if (humanApprovalRequired && !approvalReason) {
        response.status(400).json({ error: "approvalReason is required." });
        return;
      }
      const recordedApprovalReason = approvalReason ?? policyApprovalReason;

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const complianceDecision = evaluatePreviewPublicationCompliance(prospectBusiness);
      if (!complianceDecision.allowed || !prospectBusiness.previewWebsite) {
        await auditTrail.record({
          actor: configuration.operatorUsername,
          eventType: "preview.publication_blocked",
          summary: `Compliance Gate blocked Preview Website publication for Prospect Business ${request.params.id}.`,
          metadata: {
            prospectBusinessId: request.params.id,
            humanApprovalRequired,
            humanApprovalSkippedByReviewPolicy: !humanApprovalRequired,
            reasons: complianceDecision.reasons,
          },
        });
        response.status(409).json({ error: complianceDecision.reasons.join(" ") });
        return;
      }

      const hostPublication = await previewHost.publish({
        previewWebsite: prospectBusiness.previewWebsite,
        previewBaseUrl: configuration.previewBaseUrl,
      });
      const publication = {
        ...hostPublication,
        approvedBy: configuration.operatorUsername,
        approvalReason: recordedApprovalReason,
      };
      if (!publication.noindex) {
        response.status(409).json({ error: "Published Preview must be served with noindex behavior." });
        return;
      }

      const previewWebsite = await prospectRegistry.publishPreviewWebsite({
        prospectBusinessId: request.params.id,
        actor: configuration.operatorUsername,
        approvalReason: recordedApprovalReason,
        publication,
      });
      await auditTrail.record({
        actor: configuration.operatorUsername,
        eventType: "preview.published",
        summary: humanApprovalRequired
          ? `Published Preview Website for Prospect Business ${request.params.id} after required Human Review.`
          : `Published Preview Website for Prospect Business ${request.params.id}. Human Review skipped by Review Policy.`,
        metadata: {
          prospectBusinessId: request.params.id,
          humanApprovalRequired,
          humanApprovalSkippedByReviewPolicy: !humanApprovalRequired,
        },
      });

      response.status(200).json({ previewWebsite });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/draft-outreach",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.saveDraftOutreach || !outreachDrafterAgent) {
        response.status(503).json({ error: "Outreach Drafter is not configured." });
        return;
      }

      const senderIdentity = optionalStringFromBody(request.body.senderIdentity);
      const postalAddress = optionalStringFromBody(request.body.postalAddress);
      const optOutWording = optionalStringFromBody(request.body.optOutWording);
      if (!senderIdentity || !postalAddress || !optOutWording) {
        response.status(400).json({
          error: "senderIdentity, postalAddress, and optOutWording are required.",
        });
        return;
      }

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const draft = await draftOutreachForProspect({
        prospectBusiness,
        drafterAgent: outreachDrafterAgent,
        senderIdentity,
        postalAddress,
        optOutWording,
      });
      const complianceDecision = evaluateOutreachCompliance({
        prospectBusiness,
        draft,
        senderIdentity,
        postalAddress,
        optOutWording,
      });
      if (!complianceDecision.allowed) {
        response.status(409).json({ error: complianceDecision.reasons.join(" ") });
        return;
      }

      const draftOutreach = await prospectRegistry.saveDraftOutreach(draft);
      await auditTrail.record({
        actor: configuration.operatorUsername,
        eventType: "outreach.drafted",
        summary: `Drafted Outreach for Prospect Business ${request.params.id}.`,
      });

      response.status(201).json({ draftOutreach });
    },
  );

  app.patch(
    "/api/prospect-businesses/:id/draft-outreach/operator-edits",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.updateDraftOutreachOperatorEdits) {
        response.status(503).json({ error: "Draft Outreach edits are not configured." });
        return;
      }

      const edits = draftOutreachOperatorEditsFromBody(request.body);
      if (!edits.subject && !edits.bodyText && !edits.bodyHtml) {
        response.status(400).json({ error: "At least one Draft Outreach edit is required." });
        return;
      }

      const draftOutreach = await prospectRegistry.updateDraftOutreachOperatorEdits({
        prospectBusinessId: request.params.id,
        actor: configuration.operatorUsername,
        edits,
      });

      response.status(200).json({ draftOutreach });
    },
  );

  app.post(
    "/api/prospect-businesses/:id/outreach-email/send",
    requireOperator(configuration),
    async (request, response) => {
      if (
        !prospectRegistry ||
        !prospectRegistry.saveOutreachEmail ||
        !prospectRegistry.getOutreachSuppressionStatus ||
        !prospectRegistry.recordOutreachWorkflowFailure ||
        !emailProvider
      ) {
        response.status(503).json({ error: "Outreach Email sending is not configured." });
        return;
      }

      const fromEmail = optionalStringFromBody(request.body.fromEmail);
      const senderIdentity = optionalStringFromBody(request.body.senderIdentity);
      const postalAddress = optionalStringFromBody(request.body.postalAddress);
      const optOutWording = optionalStringFromBody(request.body.optOutWording);
      const approvalReason = optionalStringFromBody(request.body.approvalReason);
      if (!fromEmail || !senderIdentity || !postalAddress || !optOutWording) {
        response.status(400).json({
          error: "fromEmail, senderIdentity, postalAddress, and optOutWording are required.",
        });
        return;
      }
      const humanApprovalRequired = reviewPolicy.requireReviewBeforeOutreachSending;
      const policyApprovalReason = "Review Policy skipped outreach Human Review.";
      if (humanApprovalRequired && !approvalReason) {
        response.status(400).json({ error: "approvalReason is required." });
        return;
      }
      const recordedApprovalReason = approvalReason ?? policyApprovalReason;

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      try {
        const outreachEmail = await sendApprovedOutreachEmail({
          prospectBusiness,
          emailProvider,
          outreachEmailStore: prospectRegistry as ProspectRegistry & OutreachEmailStore,
          suppressionStore: prospectRegistry as ProspectRegistry & OutreachSuppressionStore,
          workflowFailureStore: prospectRegistry as ProspectRegistry & OutreachWorkflowFailureStore,
          actor: configuration.operatorUsername,
          fromEmail,
          senderIdentity,
          postalAddress,
          optOutWording,
          approvalReason: recordedApprovalReason,
        });
        await auditTrail.record({
          actor: configuration.operatorUsername,
          eventType: "outreach.sent",
          summary: humanApprovalRequired
            ? `Sent Outreach Email for Prospect Business ${request.params.id} after required Human Review.`
            : `Sent Outreach Email for Prospect Business ${request.params.id}. Human Review skipped by Review Policy.`,
          metadata: {
            prospectBusinessId: request.params.id,
            humanApprovalRequired,
            humanApprovalSkippedByReviewPolicy: !humanApprovalRequired,
          },
        });

        response.status(200).json({ outreachEmail });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Outreach Email sending failed.";
        response.status(502).json({ error: message });
      }
    },
  );

  app.delete(
    "/api/prospect-businesses/:id/preview-website/publication",
    requireOperator(configuration),
    async (request, response) => {
      if (!prospectRegistry || !prospectRegistry.unpublishPreviewWebsite || !previewHost) {
        response.status(503).json({ error: "Preview Website unpublication is not configured." });
        return;
      }

      const prospectBusiness = await prospectRegistry.getProspectBusinessDetail(request.params.id);
      const publication = prospectBusiness.previewWebsite?.publication;
      if (prospectBusiness.previewWebsite?.status !== "published" || !publication) {
        response.status(409).json({ error: "Published Preview is required before unpublishing." });
        return;
      }

      await previewHost.unpublish({ previewUrlPath: publication.previewUrlPath });
      const previewWebsite = await prospectRegistry.unpublishPreviewWebsite({
        prospectBusinessId: request.params.id,
        actor: configuration.operatorUsername,
      });
      await auditTrail.record({
        actor: configuration.operatorUsername,
        eventType: "preview.unpublished",
        summary: `Unpublished Preview Website for Prospect Business ${request.params.id}.`,
      });

      response.status(200).json({ previewWebsite });
    },
  );

  app.post("/api/discovery-runs", requireOperator(configuration), async (request, response) => {
    if (!prospectRegistry || !discoverySource) {
      response.status(503).json({ error: "Google Places discovery is not configured." });
      return;
    }

    try {
      const discoveryRun = await runDiscovery({
        request: startDiscoveryRunSchema.parse(request.body),
        discoverySource,
        registry: prospectRegistry,
      });

      response.status(201).json({ discoveryRun });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: error.issues.map((issue) => issue.message).join("; "),
        });
        return;
      }

      throw error;
    }
  });

  app.post("/audit-trail/baseline", requireOperator(configuration), async (_request, response) => {
    await auditTrail.record({
      actor: configuration.operatorUsername,
      eventType: "audit.baseline_recorded",
      summary: "Baseline audit trail event recorded from Review Dashboard."
    });

    response.redirect("/dashboard");
  });

  return app;
}

function requireOperator(configuration: RuntimeConfiguration) {
  return (request: Request, response: Response, next: () => void) => {
    if (!isAuthenticated(request, configuration)) {
      response.redirect("/login");
      return;
    }

    next();
  };
}

function isAuthenticated(request: Request, configuration: RuntimeConfiguration): boolean {
  return readOperatorSession(request.headers.cookie, configuration) !== null;
}

function stringFromBody(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function websiteAssessmentInputFromBody(body: unknown): WebsiteAssessmentInput {
  const record = isRecord(body) ? body : {};
  return {
    currentWebsiteUrl: optionalStringFromBody(record.currentWebsiteUrl),
    htmlText: optionalStringFromBody(record.htmlText),
    deterministicChecks: isRecord(record.deterministicChecks)
      ? (record.deterministicChecks as WebsiteAssessmentInput["deterministicChecks"])
      : {
          pageLoad: "not_checked",
          https: "not_checked",
          mobileViewport: "not_checked",
          contactInformationFound: false,
          servicesFound: false,
          brokenAssetsOrConsoleErrors: false,
          thirdPartyOnlyPresence: false,
        },
    desktopScreenshot: screenshotFromBody(record.desktopScreenshot),
    mobileScreenshot: screenshotFromBody(record.mobileScreenshot),
    operatorNotes: Array.isArray(record.operatorNotes)
      ? record.operatorNotes.filter((note): note is string => typeof note === "string")
      : undefined,
  };
}

function optionalStringFromBody(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function reviewPolicyFromBody(body: unknown): ReviewPolicy | undefined {
  const record = isRecord(body) ? body : {};
  if (
    typeof record.requireReviewBeforePreviewPublication !== "boolean" ||
    typeof record.requireReviewBeforeOutreachSending !== "boolean"
  ) {
    return undefined;
  }

  const allowedKeys = new Set([
    "requireReviewBeforePreviewPublication",
    "requireReviewBeforeOutreachSending",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return undefined;
  }

  return {
    requireReviewBeforePreviewPublication: record.requireReviewBeforePreviewPublication,
    requireReviewBeforeOutreachSending: record.requireReviewBeforeOutreachSending,
  };
}

function contactEvidenceSourceTypeFromBody(value: unknown): ContactEvidenceSourceType | undefined {
  if (
    value === "business_website" ||
    value === "google_places" ||
    value === "official_profile" ||
    value === "official_search_result"
  ) {
    return value;
  }

  return undefined;
}

function previewWebsiteOperatorEditsFromBody(body: unknown): PreviewWebsiteOperatorEdit[] {
  const record = isRecord(body) ? body : {};
  if (!Array.isArray(record.edits)) {
    return [];
  }

  return record.edits.flatMap((edit) => {
    if (!isRecord(edit) || typeof edit.path !== "string") {
      return [];
    }

    if (
      typeof edit.value !== "string" &&
      typeof edit.value !== "number" &&
      typeof edit.value !== "boolean" &&
      edit.value !== null
    ) {
      return [];
    }

    return [{ path: edit.path, value: edit.value }];
  });
}

function draftOutreachOperatorEditsFromBody(body: unknown): DraftOutreachOperatorEdit {
  const record = isRecord(body) ? body : {};
  return {
    subject: optionalStringFromBody(record.subject),
    bodyText: optionalStringFromBody(record.bodyText),
    bodyHtml: optionalStringFromBody(record.bodyHtml),
  };
}

function screenshotFromBody(value: unknown): WebsiteScreenshotInput | undefined {
  if (!isRecord(value) || typeof value.uri !== "string" || typeof value.capturedAt !== "string") {
    return undefined;
  }

  return {
    uri: value.uri,
    capturedAt: new Date(value.capturedAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
