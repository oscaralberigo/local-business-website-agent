import { describe, expect, it, vi } from "vitest";

import {
  createResendEmailSendingProvider,
  createSafeTestEmailSendingProvider,
} from "../src/outreach/resend-email-sending-provider.js";
import { loadRuntimeConfiguration } from "../src/config/runtimeConfiguration.js";
import { createEmailSendingProviderForConfiguration } from "../src/outreach/email-sending-provider-factory.js";

describe("Email Sending Provider adapters", () => {
  it("uses a safe test adapter without making network requests", async () => {
    const provider = createSafeTestEmailSendingProvider();

    const result = await provider.send({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@example.com",
      subject: "Website preview",
      text: "Text body",
      html: "<p>Text body</p>",
    });

    expect(result).toMatchObject({
      provider: "safe_test",
      providerMessageId: expect.stringMatching(/^safe-test-/),
    });
    expect(result.sentAt).toBeInstanceOf(Date);
  });

  it("sends through the Resend HTTP API when the adapter is explicitly configured", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "resend-message-123" }),
    }));
    const provider = createResendEmailSendingProvider({
      apiKey: "resend-secret",
      fetch,
    });

    const result = await provider.send({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@example.com",
      subject: "Website preview",
      text: "Text body",
      html: "<p>Text body</p>",
    });

    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer resend-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Logan Sinclair <logan@example.com>",
        to: "hello@example.com",
        subject: "Website preview",
        text: "Text body",
        html: "<p>Text body</p>",
      }),
    });
    expect(result).toMatchObject({
      provider: "resend",
      providerMessageId: "resend-message-123",
    });
  });

  it("does not install the safe test adapter in production without Resend credentials", () => {
    const configuration = loadRuntimeConfiguration({
      ...baseEnvironment,
      NODE_ENV: "production",
      RESEND_API_KEY: "",
    });

    expect(createEmailSendingProviderForConfiguration(configuration)).toBeUndefined();
  });

  it("uses the safe test adapter outside production", async () => {
    const configuration = loadRuntimeConfiguration({
      ...baseEnvironment,
      NODE_ENV: "development",
      RESEND_API_KEY: "resend-secret",
    });

    const provider = createEmailSendingProviderForConfiguration(configuration);
    const result = await provider?.send({
      from: "Logan Sinclair <logan@example.com>",
      to: "hello@example.com",
      subject: "Website preview",
      text: "Text body",
      html: "<p>Text body</p>",
    });

    expect(result).toMatchObject({
      provider: "safe_test",
      providerMessageId: expect.stringMatching(/^safe-test-/),
    });
  });

  it("uses the Resend adapter in production when Resend credentials are configured", () => {
    const configuration = loadRuntimeConfiguration({
      ...baseEnvironment,
      NODE_ENV: "production",
      RESEND_API_KEY: "resend-secret",
    });

    expect(createEmailSendingProviderForConfiguration(configuration)).toBeDefined();
  });
});

const baseEnvironment = {
  OPERATOR_PASSWORD: "correct horse battery staple",
  OPERATOR_SESSION_SECRET: "session-secret-that-is-long-enough",
  DATABASE_URL: "postgres://operator:database-secret@postgres:5432/local_business_agent",
};
