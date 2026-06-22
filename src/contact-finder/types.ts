import type { ProspectBusinessDetail } from "../discovery/types.js";

export type ContactEvidenceSourceType =
  | "business_website"
  | "google_places"
  | "official_profile"
  | "official_search_result";

export type ContactRoleClassification = "role" | "personal" | "unknown";

export type ContactAcquisitionMethod = "published" | "guessed";

export type OutreachApprovalStatus = "pending_operator_approval" | "approved" | "blocked";

export type ContactCandidate = {
  emailAddress: string;
  sourceUrl: string;
  sourceType: ContactEvidenceSourceType;
  confidence: number;
  roleClassification: ContactRoleClassification;
  acquisitionMethod: ContactAcquisitionMethod;
  reason: string;
};

export type ContactEvidence = Omit<ContactCandidate, "acquisitionMethod"> & {
  id: string;
  prospectBusinessId: string;
  outreachApprovalStatus: OutreachApprovalStatus;
  foundAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
  approvalReason?: string;
};

export type ContactSearchSource = {
  sourceType: ContactEvidenceSourceType;
  search(input: { prospectBusiness: ProspectBusinessDetail }): Promise<ContactCandidate[]>;
};

export type ContactFinderAgent = {
  findContact(input: { prospectBusiness: ProspectBusinessDetail }): Promise<ContactCandidate[]>;
};

export type ContactEvidenceStore = {
  saveContactEvidence(input: {
    prospectBusinessId: string;
    candidates: ContactCandidate[];
    foundAt?: Date;
  }): Promise<ContactEvidence[]>;
  approveContactEvidence(input: {
    prospectBusinessId: string;
    contactEvidenceId: string;
    actor: string;
    reason: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence>;
  addVerifiedContactEvidence(input: {
    prospectBusinessId: string;
    emailAddress: string;
    sourceUrl: string;
    sourceType: ContactEvidenceSourceType;
    reason: string;
    actor: string;
    approvedAt?: Date;
  }): Promise<ContactEvidence>;
};
