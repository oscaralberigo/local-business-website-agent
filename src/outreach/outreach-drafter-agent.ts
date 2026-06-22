import type { ProspectBusinessDetail } from "../discovery/types.js";
import type { OpportunityCategory } from "../website-assessment/types.js";
import type {
  DraftOutreach,
  OutreachComplianceDecision,
  OutreachDrafterAgent,
  OutreachDraftInput,
  OutreachSuppressionStatus,
} from "./types.js";

export function createTemplateOutreachDrafterAgent(): OutreachDrafterAgent {
  return {
    async draft(input) {
      const previewUrl = input.prospectBusiness.previewWebsite?.publication?.previewUrl ?? "";
      const opportunityCategory =
        input.prospectBusiness.websiteAssessment?.opportunityCategory ?? "unknown";
      const pitch = pitchForOpportunityCategory(opportunityCategory);
      const safeClaim = input.prospectBusiness.websiteAssessment?.safeClaims[0];
      const claimsUsed = safeClaim
        ? [{ claim: safeClaim, source: "website_assessment.safe_claims" }]
        : [];
      const contactEvidence = input.prospectBusiness.contactEvidence?.find(
        (evidence) => evidence.outreachApprovalStatus === "approved",
      );
      const contactLine = contactEvidence
        ? `I found this published business contact at ${contactEvidence.sourceUrl}.`
        : "I could not confirm a published business contact path.";
      const claimSentence = safeClaim ? `${safeClaim} ` : "";
      const bodyText = [
        `Hi ${input.prospectBusiness.name} team,`,
        "",
        `${claimSentence}I put together a short ${pitch} for ${input.prospectBusiness.name}:`,
        previewUrl,
        "",
        "If it is useful, I would be happy to talk about turning it into a paid website project. If not, no problem.",
        "",
        contactLine,
        "",
        input.senderIdentity,
        input.postalAddress,
        input.optOutWording,
      ].join("\n");

      return {
        prospectBusinessId: input.prospectBusiness.id,
        subject: `Website preview for ${input.prospectBusiness.name}`,
        bodyText,
        bodyHtml: renderBodyHtml(bodyText, previewUrl),
        claimsUsed,
        complianceNotes: ["Operator review is required before sending."],
        requiresOperatorReview: true,
      };
    },
  };
}

export async function draftOutreachForProspect(input: OutreachDraftInput & {
  drafterAgent: OutreachDrafterAgent;
}): Promise<DraftOutreach> {
  const draft = await input.drafterAgent.draft({
    prospectBusiness: input.prospectBusiness,
    senderIdentity: input.senderIdentity,
    postalAddress: input.postalAddress,
    optOutWording: input.optOutWording,
  });
  const now = new Date();

  return {
    ...draft,
    createdAt: now,
    updatedAt: now,
  };
}

export function evaluateOutreachCompliance(input: {
  prospectBusiness: ProspectBusinessDetail;
  draft: Pick<DraftOutreach, "bodyText" | "bodyHtml" | "claimsUsed">;
  senderIdentity: string;
  postalAddress: string;
  optOutWording: string;
  suppressionStatus?: OutreachSuppressionStatus;
  doNotContact?: boolean;
}): OutreachComplianceDecision {
  const reasons: string[] = [];

  const approvedContactEvidence = input.prospectBusiness.contactEvidence?.find(
    (evidence) =>
      evidence.outreachApprovalStatus === "approved" &&
      evidence.roleClassification === "role" &&
      evidence.confidence >= 0.7,
  );
  if (!approvedContactEvidence) {
    reasons.push("Approved suitable Contact Evidence is required before outreach.");
  }

  const previewUrl = input.prospectBusiness.previewWebsite?.publication?.previewUrl;
  if (
    input.prospectBusiness.previewWebsite?.status !== "published" ||
    !previewUrl
  ) {
    reasons.push("Published Preview URL is required before outreach.");
  } else if (
    !contentIncludesValue(input.draft.bodyText, previewUrl) ||
    !contentIncludesValue(input.draft.bodyHtml, previewUrl)
  ) {
    reasons.push("Draft Outreach must include the published Preview URL.");
  }

  const requiredFooterValues = [input.senderIdentity, input.postalAddress, input.optOutWording];
  const textHasFooter = requiredFooterValues.every((value) =>
    contentIncludesValue(input.draft.bodyText, value),
  );
  const htmlHasFooter = requiredFooterValues.every((value) =>
    contentIncludesValue(input.draft.bodyHtml, value),
  );
  if (!textHasFooter || !htmlHasFooter) {
    reasons.push("Draft Outreach must include sender identity, postal address, and opt-out wording.");
  }

  const safeClaims = new Set([
    ...(input.prospectBusiness.websiteAssessment?.safeClaims ?? []),
    ...(input.prospectBusiness.businessContext?.supportedClaims
      .filter((claim) => claim.allowedForGeneration)
      .map((claim) => claim.statement) ?? []),
  ]);
  const unsupportedClaim = input.draft.claimsUsed.some((claim) => !safeClaims.has(claim.claim));
  if (unsupportedClaim) {
    reasons.push("Draft Outreach claims must all map to safe Supported Claims.");
  }

  if (input.suppressionStatus === "suppressed") {
    reasons.push("Suppressed prospects cannot receive outreach.");
  }

  if (input.doNotContact) {
    reasons.push("Do-not-contact prospects cannot receive outreach.");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

function pitchForOpportunityCategory(opportunityCategory: OpportunityCategory): string {
  switch (opportunityCategory) {
    case "no_website":
      return "first website concept";
    case "website_unreachable":
      return "more reliable web presence concept";
    case "social_only":
      return "owned website concept beyond social or profile pages";
    case "outdated_or_low_quality":
      return "modern upgrade concept";
    case "modern_sufficient":
      return "website concept";
    case "unknown":
      return "cautious website concept";
  }
}

function renderBodyHtml(bodyText: string, previewUrl: string): string {
  return `<div>${bodyText
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line === previewUrl && previewUrl.length > 0) {
        return `<p><a href="${escapeHtml(previewUrl)}">${escapeHtml(previewUrl)}</a></p>`;
      }

      return escaped.length > 0 ? `<p>${escaped}</p>` : "";
    })
    .join("")}</div>`;
}

function contentIncludesValue(content: string, value: string): boolean {
  return content.includes(value) || content.includes(escapeHtml(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
    }
    return character;
  });
}
