import { randomUUID } from "node:crypto";
import type { EmailSendInput, EmailSendingProvider } from "./types.js";

type Fetch = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<{
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export class EmailSendingProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code = "email_provider_failure") {
    super(message);
    this.name = "EmailSendingProviderError";
  }
}

export function createSafeTestEmailSendingProvider(): EmailSendingProvider {
  return {
    async send() {
      return {
        provider: "safe_test",
        providerMessageId: `safe-test-${randomUUID()}`,
        sentAt: new Date(),
      };
    },
  };
}

export function createResendEmailSendingProvider(input: {
  apiKey: string;
  fetch?: Fetch;
}): EmailSendingProvider {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new Error("fetch is required to use the Resend Email Sending Provider.");
  }

  return {
    async send(email) {
      const response = await fetchImplementation("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(resendPayloadFromEmail(email)),
      });

      if (!response.ok) {
        throw new EmailSendingProviderError(
          await resendErrorMessage(response),
          response.status === 429 || (typeof response.status === "number" && response.status >= 500),
        );
      }

      const body = await response.json();
      const providerMessageId = providerMessageIdFromBody(body);
      if (!providerMessageId) {
        throw new EmailSendingProviderError("Resend response did not include a message ID.", true);
      }

      return {
        provider: "resend",
        providerMessageId,
        sentAt: new Date(),
      };
    },
  };
}

function resendPayloadFromEmail(email: EmailSendInput) {
  return {
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  };
}

async function resendErrorMessage(response: {
  status?: number;
  text?: () => Promise<string>;
}): Promise<string> {
  const body = response.text ? await response.text() : "";
  const status = response.status ? `Resend send failed with status ${response.status}` : "Resend send failed";
  return body ? `${status}: ${body}` : status;
}

function providerMessageIdFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("id" in body)) {
    return undefined;
  }

  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
