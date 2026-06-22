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

export type OutreachSuppressionStatus = "clear" | "suppressed";

export type OutreachComplianceDecision = {
  allowed: boolean;
  reasons: string[];
};
