import { describe, expect, it } from "vitest";
import { normalizeToastMessage } from "../lib/toastMessage.js";

describe("normalizeToastMessage", () => {
  it("collapses verbose viem rejection errors", () => {
    expect(
      normalizeToastMessage(
        "User rejected the request. Request Arguments: from: 0xabc Contract Call: deletePosition Details: User rejected the request. Version: viem@2.48.4",
      ),
    ).toBe("User rejected the wallet request.");
  });

  it("cuts implementation details from long contract errors", () => {
    expect(
      normalizeToastMessage(
        "Execution reverted. Contract Call: address: 0xabc function: buyAndClaimAll Docs: https://viem.sh Details: reverted",
      ),
    ).toBe("Execution reverted.");
  });
});
