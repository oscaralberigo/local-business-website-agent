import type { ProspectBusinessDetail } from "../discovery/types.js";

export type DraftOutreachClaim = {
  claim: string;
  source: string;
};

export type DraftOutreach = {
  id?: string;
  prospectBusinessId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  claimsUsed: DraftOutreachClaim[];
  complianceNotes: string[];
  requiresOperatorReview: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveDraftOutreachInput = Omit<DraftOutreach, "id" | "createdAt" | "updatedAt">;

export type DraftOutreachOperatorEdit = {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
};

export type OutreachDrafterAgent = {
  draft(input: OutreachDraftInput): Promise<Omit<DraftOutreach, "id" | "createdAt" | "updatedAt">>;
};

export type OutreachDraftInput = {
  prospectBusiness: ProspectBusinessDetail;
  senderIdentity: string;
  postalAddress: string;
  optOutWording: string;
};

export type DraftOutreachStore = {
  saveDraftOutreach(input: SaveDraftOutreachInput): Promise<DraftOutreach>;
  updateDraftOutreachOperatorEdits(input: {
    prospectBusinessId: string;
    actor: string;
    edits: DraftOutreachOperatorEdit;
  }): Promise<DraftOutreach>;
};

export type OutreachSuppressionStatus = "clear" | "suppressed" | "do_not_contact";

export type OutreachComplianceDecision = {
  allowed: boolean;
  reasons: string[];
};

export type OutreachSendStatus = "sent" | "failed";

export type OutreachFailureMetadata = {
  message: string;
  retryable: boolean;
  code?: string;
};

export type OutreachEmail = {
  id?: string;
  prospectBusinessId: string;
  draftOutreachId?: string;
  recipientEmailAddress: string;
  provider: string;
  providerMessageId?: string;
  sendStatus: OutreachSendStatus;
  suppressionStatus: OutreachSuppressionStatus;
  sentAt?: Date;
  failureMetadata?: OutreachFailureMetadata;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveOutreachEmailInput = Omit<OutreachEmail, "id" | "createdAt" | "updatedAt">;

export type OutreachEmailStore = {
  saveOutreachEmail(input: SaveOutreachEmailInput): Promise<OutreachEmail>;
};

export type OutreachSuppressionCheck = {
  status: OutreachSuppressionStatus;
  reason?: string;
};

export type OutreachSuppressionStore = {
  getOutreachSuppressionStatus(input: {
    prospectBusinessId: string;
    emailAddress: string;
  }): Promise<OutreachSuppressionCheck>;
};

export type EmailSendInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSendResult = {
  provider: string;
  providerMessageId: string;
  sentAt?: Date;
};

export type EmailSendingProvider = {
  send(input: EmailSendInput): Promise<EmailSendResult>;
};

export type OutreachWorkflowFailureStore = {
  recordOutreachWorkflowFailure(input: {
    prospectBusinessId: string;
    failedStep: string;
    errorSummary: string;
    retryable: boolean;
    provider: string;
  }): Promise<void>;
};
