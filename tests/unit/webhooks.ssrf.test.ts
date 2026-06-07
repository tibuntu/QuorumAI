import { describe, it, expect, afterEach, vi } from "vitest";
import { validateWebhookUrl } from "@/lib/webhooks";

afterEach(() => {
  vi.unstubAllEnvs();
});
function setProd() { vi.stubEnv("NODE_ENV", "production"); }

describe("validateWebhookUrl", () => {
  it("allows public https in production", () => {
    setProd();
    expect(() => validateWebhookUrl("https://example.com/hook")).not.toThrow();
  });

  it.each([
    "http://example.com/hook",
    "https://127.0.0.1/hook",
    "https://localhost/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/hook",
    "https://192.168.1.1/hook",
    "https://[::1]/hook",
    "not-a-url",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
  ])("rejects %s in production", (url) => {
    setProd();
    expect(() => validateWebhookUrl(url)).toThrow();
  });

  it("allows a public hostname starting with fc/fd in production", () => {
    setProd();
    expect(() => validateWebhookUrl("https://fcdn.example.com/hook")).not.toThrow();
    expect(() => validateWebhookUrl("https://fd-assets.example.org/hook")).not.toThrow();
  });

  it("allows http+localhost outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => validateWebhookUrl("http://localhost:9999/sink")).not.toThrow();
  });

  it("honors WEBHOOK_ALLOW_INSECURE under production", () => {
    setProd();
    vi.stubEnv("WEBHOOK_ALLOW_INSECURE", "true");
    expect(() => validateWebhookUrl("http://127.0.0.1:9999/sink")).not.toThrow();
  });
});
