import { describe, expect, test } from "vitest";
import { baseUrl } from "@/lib/config";

describe("baseUrl", () => {
  test("returns BASE_URL when set", () => {
    expect(baseUrl({ BASE_URL: "https://q.example" } as unknown as NodeJS.ProcessEnv)).toBe("https://q.example");
  });
  test("falls back to localhost when unset", () => {
    expect(baseUrl({} as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
  test('treats "/" (Vite/Vitest injected default) as unset', () => {
    expect(baseUrl({ BASE_URL: "/" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
});
