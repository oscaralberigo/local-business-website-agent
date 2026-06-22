import type { ContactCandidate, OutreachApprovalStatus } from "./types.js";

const minimumRoleContactConfidence = 0.7;

export function classifyContactApprovalStatus(candidate: ContactCandidate): OutreachApprovalStatus {
  if (candidate.acquisitionMethod === "guessed") {
    return "blocked";
  }

  if (candidate.roleClassification !== "role") {
    return "blocked";
  }

  if (candidate.confidence < minimumRoleContactConfidence) {
    return "blocked";
  }

  return "pending_operator_approval";
}

export function isSuitableForOperatorApproval(candidate: ContactCandidate): boolean {
  return classifyContactApprovalStatus(candidate) === "pending_operator_approval";
}

export function shouldPersistContactCandidate(candidate: ContactCandidate): boolean {
  return candidate.acquisitionMethod !== "guessed";
}
