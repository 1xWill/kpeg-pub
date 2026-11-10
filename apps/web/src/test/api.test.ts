import { describe, expect, it } from "vitest";
import { ApiRequestError, isApiUnavailableError } from "../lib/api.js";

describe("api request errors", () => {
  it("marks 500 and 503 API failures as unavailable", () => {
    expect(
      isApiUnavailableError(
        new ApiRequestError({
          status: 503,
          path: "/api/status",
          message: "api unavailable: database unavailable",
        }),
      ),
    ).toBe(true);

    expect(
      isApiUnavailableError(
        new ApiRequestError({
          status: 500,
          path: "/api/stats",
          message: "request failed: 500",
        }),
      ),
    ).toBe(true);
  });

  it("does not treat normal 404s as API unavailable", () => {
    expect(
      isApiUnavailableError(
        new ApiRequestError({
          status: 404,
          path: "/api/kitties/999999",
          message: "kitty not found",
        }),
      ),
    ).toBe(false);
  });
});
