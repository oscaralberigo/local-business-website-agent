import type {
  OpportunityCategory,
  RecommendedPitchAngle,
  WebsiteAssessmentEvidence,
  WebsiteAssessmentInput,
  WebsiteReviewerAgent,
  WebsiteReviewerOutput,
} from "./types.js";

export function createWebsiteReviewerAgent(): WebsiteReviewerAgent {
  return {
    async review({ input }) {
      return reviewWebsiteAssessmentInput(input);
    },
  };
}

function reviewWebsiteAssessmentInput(input: WebsiteAssessmentInput): WebsiteReviewerOutput {
  const evidence = buildEvidence(input);
  const opportunityCategory = classifyOpportunity(input);

  return {
    opportunityCategory,
    confidence: confidenceFor(opportunityCategory, input),
    summary: summaryFor(opportunityCategory),
    evidence,
    recommendedPitchAngle: pitchAngleFor(opportunityCategory),
    outreachSafeClaims: safeClaimsFor(opportunityCategory),
    operatorReviewNotes: reviewNotesFor(opportunityCategory, input),
  };
}

function classifyOpportunity(input: WebsiteAssessmentInput): OpportunityCategory {
  const checks = input.deterministicChecks;
  const hasWebsiteEvidence = Boolean(
    input.currentWebsiteUrl || input.htmlText || input.desktopScreenshot || input.mobileScreenshot,
  );

  if (checks.thirdPartyOnlyPresence) {
    return "social_only";
  }

  if (!input.currentWebsiteUrl && !input.htmlText) {
    return "no_website";
  }

  if (checks.pageLoad === "unreachable") {
    return "website_unreachable";
  }

  if (!hasWebsiteEvidence && checks.pageLoad === "not_checked") {
    return "unknown";
  }

  if (
    checks.brokenAssetsOrConsoleErrors ||
    checks.mobileViewport === "failed" ||
    !checks.contactInformationFound ||
    !checks.servicesFound
  ) {
    return "outdated_or_low_quality";
  }

  if (checks.pageLoad === "not_checked" || checks.mobileViewport === "not_checked") {
    return "unknown";
  }

  return "modern_sufficient";
}

function buildEvidence(input: WebsiteAssessmentInput): WebsiteAssessmentEvidence[] {
  const evidence: WebsiteAssessmentEvidence[] = [];
  const checks = input.deterministicChecks;

  if (!input.currentWebsiteUrl && !input.htmlText) {
    evidence.push({
      source: "deterministic_check",
      claim: "No current website URL or website HTML was supplied for this Prospect Business.",
    });
  }

  if (checks.pageLoad === "unreachable") {
    evidence.push({
      source: "deterministic_check",
      claim: "The page load check reported that the current website was unreachable.",
    });
  }

  if (checks.thirdPartyOnlyPresence) {
    evidence.push({
      source: "deterministic_check",
      claim: "The supplied checks indicate an obvious third-party-only web presence.",
    });
  }

  if (checks.mobileViewport === "failed") {
    evidence.push({
      source: "deterministic_check",
      claim: "The mobile viewport check failed.",
    });
  }

  if (checks.brokenAssetsOrConsoleErrors) {
    evidence.push({
      source: "deterministic_check",
      claim: "The supplied checks found broken assets or console errors.",
    });
  }

  if (!checks.contactInformationFound) {
    evidence.push({
      source: "deterministic_check",
      claim: "The supplied checks did not find clear contact information.",
    });
  }

  if (!checks.servicesFound) {
    evidence.push({
      source: "deterministic_check",
      claim: "The supplied checks did not find clear service or product information.",
    });
  }

  if (input.htmlText) {
    evidence.push({
      source: "html",
      claim: "Extracted website text was supplied for review.",
    });
  }

  if (input.desktopScreenshot) {
    evidence.push({
      source: "desktop_screenshot",
      claim: "A desktop screenshot was supplied for review.",
    });
  }

  if (input.mobileScreenshot) {
    evidence.push({
      source: "mobile_screenshot",
      claim: "A mobile screenshot was supplied for review.",
    });
  }

  for (const note of input.operatorNotes ?? []) {
    evidence.push({
      source: "operator_note",
      claim: note,
    });
  }

  return evidence.length > 0
    ? evidence
    : [
        {
          source: "deterministic_check",
          claim: "The supplied checks did not identify an obvious website opportunity.",
        },
      ];
}

function confidenceFor(
  opportunityCategory: OpportunityCategory,
  input: WebsiteAssessmentInput,
): number {
  if (opportunityCategory === "unknown") {
    return 0.32;
  }

  if (input.desktopScreenshot && input.mobileScreenshot && input.htmlText) {
    return opportunityCategory === "modern_sufficient" ? 0.82 : 0.86;
  }

  return opportunityCategory === "modern_sufficient" ? 0.72 : 0.74;
}

function summaryFor(opportunityCategory: OpportunityCategory): string {
  switch (opportunityCategory) {
    case "no_website":
      return "No dedicated current website evidence was supplied.";
    case "website_unreachable":
      return "The current website appears to be unreachable from the supplied checks.";
    case "social_only":
      return "The supplied evidence indicates a third-party-only web presence.";
    case "outdated_or_low_quality":
      return "The current website appears to have a credible improvement opportunity.";
    case "modern_sufficient":
      return "The current website appears sufficient based on the supplied evidence.";
    case "unknown":
      return "The supplied evidence is not enough to make a confident website opportunity decision.";
  }
}

function pitchAngleFor(opportunityCategory: OpportunityCategory): RecommendedPitchAngle {
  switch (opportunityCategory) {
    case "no_website":
      return "first_website";
    case "website_unreachable":
      return "technical_fix";
    case "social_only":
      return "social_to_owned_site";
    case "outdated_or_low_quality":
      return "modern_upgrade";
    case "modern_sufficient":
      return "no_outreach";
    case "unknown":
      return "uncertain";
  }
}

function safeClaimsFor(opportunityCategory: OpportunityCategory): string[] {
  switch (opportunityCategory) {
    case "no_website":
      return ["I could not find a dedicated website URL in the provided business record."];
    case "website_unreachable":
      return ["When I reviewed the supplied website URL, it did not load successfully."];
    case "social_only":
      return ["I found a third-party profile rather than a dedicated business website in the supplied evidence."];
    case "outdated_or_low_quality":
      return ["I noticed some opportunities to make the current website easier for visitors to use."];
    case "modern_sufficient":
    case "unknown":
      return [];
  }
}

function reviewNotesFor(
  opportunityCategory: OpportunityCategory,
  input: WebsiteAssessmentInput,
): string[] {
  if (opportunityCategory === "unknown") {
    return ["Review the current website manually before generating a preview."];
  }

  if (!input.desktopScreenshot || !input.mobileScreenshot) {
    return ["Capture desktop and mobile screenshots before approving outreach."];
  }

  return [];
}
