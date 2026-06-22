import { z } from "zod";

const booleanFromEnvironment = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return defaultValue;
      }

      return value === "true" || value === "1";
    });

const portFromEnvironment = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) {
      return 3000;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
  });

const positiveIntegerFromEnvironment = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) {
      return 20;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
  });

const environmentSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: portFromEnvironment,
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  PREVIEW_BASE_URL: z.string().url().default("http://localhost:8080"),
  OPERATOR_USERNAME: z.string().min(1).default("operator"),
  OPERATOR_PASSWORD: z.string().min(1, "OPERATOR_PASSWORD is required"),
  OPERATOR_SESSION_SECRET: z.string().min(16, "OPERATOR_SESSION_SECRET must be at least 16 characters"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: booleanFromEnvironment(false),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  REVIEW_REQUIRE_PREVIEW_PUBLICATION: booleanFromEnvironment(true),
  REVIEW_REQUIRE_OUTREACH_SENDING: booleanFromEnvironment(true),
  DISCOVERY_LIMIT: positiveIntegerFromEnvironment
});

export type RuntimeConfiguration = {
  environment: string;
  port: number;
  appBaseUrl: string;
  previewBaseUrl: string;
  operatorUsername: string;
  operatorPassword: string;
  operatorSessionSecret: string;
  databaseUrl: string;
  databaseSsl: boolean;
  googlePlacesApiKey?: string;
  providers: {
    googlePlacesConfigured: boolean;
    openAiConfigured: boolean;
    resendConfigured: boolean;
  };
  reviewPolicy: {
    requireReviewBeforePreviewPublication: boolean;
    requireReviewBeforeOutreachSending: boolean;
  };
  discoveryLimit: number;
};

export type ConfigReadoutItem = {
  label: string;
  value: string;
};

export function loadRuntimeConfiguration(environment: NodeJS.ProcessEnv): RuntimeConfiguration {
  const parsed = environmentSchema.parse(environment);

  return {
    environment: parsed.NODE_ENV,
    port: parsed.PORT,
    appBaseUrl: parsed.APP_BASE_URL,
    previewBaseUrl: parsed.PREVIEW_BASE_URL,
    operatorUsername: parsed.OPERATOR_USERNAME,
    operatorPassword: parsed.OPERATOR_PASSWORD,
    operatorSessionSecret: parsed.OPERATOR_SESSION_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    databaseSsl: parsed.DATABASE_SSL,
    googlePlacesApiKey: parsed.GOOGLE_PLACES_API_KEY,
    providers: {
      googlePlacesConfigured: Boolean(parsed.GOOGLE_PLACES_API_KEY),
      openAiConfigured: Boolean(parsed.OPENAI_API_KEY),
      resendConfigured: Boolean(parsed.RESEND_API_KEY)
    },
    reviewPolicy: {
      requireReviewBeforePreviewPublication: parsed.REVIEW_REQUIRE_PREVIEW_PUBLICATION,
      requireReviewBeforeOutreachSending: parsed.REVIEW_REQUIRE_OUTREACH_SENDING
    },
    discoveryLimit: parsed.DISCOVERY_LIMIT
  };
}

export function buildConfigReadout(configuration: RuntimeConfiguration): ConfigReadoutItem[] {
  return [
    { label: "Environment", value: configuration.environment },
    { label: "App base URL", value: configuration.appBaseUrl },
    { label: "Preview base URL", value: configuration.previewBaseUrl },
    { label: "Operator username", value: configuration.operatorUsername },
    { label: "Operator authentication", value: "Configured" },
    { label: "Postgres database", value: "Configured" },
    { label: "Postgres SSL", value: configuration.databaseSsl ? "Enabled" : "Disabled" },
    {
      label: "Google Places provider",
      value: configuration.providers.googlePlacesConfigured ? "Configured" : "Not configured"
    },
    { label: "OpenAI provider", value: configuration.providers.openAiConfigured ? "Configured" : "Not configured" },
    { label: "Resend provider", value: configuration.providers.resendConfigured ? "Configured" : "Not configured" },
    {
      label: "Review before preview publication",
      value: configuration.reviewPolicy.requireReviewBeforePreviewPublication ? "Required" : "Not required"
    },
    {
      label: "Review before outreach sending",
      value: configuration.reviewPolicy.requireReviewBeforeOutreachSending ? "Required" : "Not required"
    },
    { label: "Discovery limit", value: configuration.discoveryLimit.toString() }
  ];
}
