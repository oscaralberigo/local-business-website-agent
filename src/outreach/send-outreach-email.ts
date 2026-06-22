import type { ProspectBusinessDetail } from "../discovery/types.js";
import { evaluateOutreachCompliance } from "./outreach-drafter-agent.js";
import type {
  EmailSendingProvider,
  OutreachEmail,
  OutreachEmailStore,
  OutreachSuppressionStore,
  OutreachWorkflowFailureStore,
} from "./types.js";

export async function sendApprovedOutreachEmail(input: {
  prospectBusiness: ProspectBusinessDetail;
  emailProvider: EmailSendingProvider;
  outreachEmailStore: OutreachEmailStore;
  suppressionStore: OutreachSuppressionStore;
  workflowFailureStore: OutreachWorkflowFailureStore;
  actor: string;
  fromEmail: string;
  senderIdentity: string;
  postalAddress: string;
  optOutWording: string;
  approvalReason: string;
}): Promise<OutreachEmail> {
  const draft = input.prospectBusiness.draftOutreach;
  if (!draft) {
    throw new Error("Draft Outreach is required before sending.");
  }

  const recipient = input.prospectBusiness.contactEvidence?.find(
    (evidence) =>
      evidence.outreachApprovalStatus === "approved" &&
      evidence.roleClassification === "role" &&
      evidence.confidence >= 0.7,
  );
  if (!recipient) {
    throw new Error("Approved suitable Contact Evidence is required before outreach.");
  }

  const suppression = await input.suppressionStore.getOutreachSuppressionStatus({
    prospectBusinessId: input.prospectBusiness.id,
    emailAddress: recipient.emailAddress,
  });
  const complianceDecision = evaluateOutreachCompliance({
    prospectBusiness: input.prospectBusiness,
    draft,
    senderIdentity: input.senderIdentity,
    postalAddress: input.postalAddress,
    optOutWording: input.optOutWording,
    suppressionStatus: suppression.status === "suppressed" ? "suppressed" : "clear",
    doNotContact: suppression.status === "do_not_contact",
  });
  if (!complianceDecision.allowed) {
    throw new Error(complianceDecision.reasons.join(" "));
  }

  try {
    const result = await input.emailProvider.send({
      from: input.fromEmail,
      to: recipient.emailAddress,
      subject: draft.subject,
      text: draft.bodyText,
      html: draft.bodyHtml,
    });

    return input.outreachEmailStore.saveOutreachEmail({
      prospectBusinessId: input.prospectBusiness.id,
      draftOutreachId: draft.id,
      recipientEmailAddress: recipient.emailAddress,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      sendStatus: "sent",
      suppressionStatus: suppression.status,
      sentAt: result.sentAt ?? new Date(),
    });
  } catch (error) {
    const metadata = failureMetadataFromError(error);
    await input.workflowFailureStore.recordOutreachWorkflowFailure({
      prospectBusinessId: input.prospectBusiness.id,
      failedStep: "outreach_email_send",
      errorSummary: metadata.message,
      retryable: metadata.retryable,
      provider: "resend",
    });

    await input.outreachEmailStore.saveOutreachEmail({
      prospectBusinessId: input.prospectBusiness.id,
      draftOutreachId: draft.id,
      recipientEmailAddress: recipient.emailAddress,
      provider: "resend",
      sendStatus: "failed",
      suppressionStatus: suppression.status,
      failureMetadata: metadata,
    });

    throw error;
  }
}

function failureMetadataFromError(error: unknown): {
  message: string;
  retryable: boolean;
  code?: string;
} {
  if (error instanceof Error) {
    const retryable = "retryable" in error && typeof error.retryable === "boolean"
      ? error.retryable
      : true;
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : "email_provider_failure";
    return {
      message: error.message,
      retryable,
      code,
    };
  }

  return {
    message: "Unknown Email Sending Provider failure.",
    retryable: true,
    code: "email_provider_failure",
  };
}
