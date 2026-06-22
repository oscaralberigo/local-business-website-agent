import type { RuntimeConfiguration } from "../config/runtimeConfiguration.js";
import {
  createResendEmailSendingProvider,
  createSafeTestEmailSendingProvider,
} from "./resend-email-sending-provider.js";
import type { EmailSendingProvider } from "./types.js";

export function createEmailSendingProviderForConfiguration(
  configuration: RuntimeConfiguration,
): EmailSendingProvider | undefined {
  if (configuration.environment === "production") {
    return configuration.resendApiKey
      ? createResendEmailSendingProvider({ apiKey: configuration.resendApiKey })
      : undefined;
  }

  return createSafeTestEmailSendingProvider();
}
