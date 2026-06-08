import { describe, expect, test } from "vitest";
import { isEditUiEnabled } from "@/lib/config";

describe("isEditUiEnabled", () => {
  test("defaults to enabled when unset", () => {
    expect(isEditUiEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  test("disabled only by 'false' (case-insensitive)", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "FALSE" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  test("enabled for 'true' or any other value", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
