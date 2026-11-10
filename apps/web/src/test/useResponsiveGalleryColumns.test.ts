import { describe, expect, it } from "vitest";
import { getInfiniteBatchSizes, getResponsiveGalleryColumns } from "../hooks/useResponsiveGalleryColumns.js";

describe("responsive gallery columns", () => {
  it("maps viewport widths to the intended column buckets", () => {
    expect(getResponsiveGalleryColumns(320)).toBe(2);
    expect(getResponsiveGalleryColumns(760)).toBe(3);
    expect(getResponsiveGalleryColumns(1024)).toBe(4);
    expect(getResponsiveGalleryColumns(1440)).toBe(5);
  });

  it("derives initial and follow-up batch sizes from the column bucket", () => {
    expect(getInfiniteBatchSizes(2)).toEqual({ initialLimit: 4, nextLimit: 6 });
    expect(getInfiniteBatchSizes(3)).toEqual({ initialLimit: 6, nextLimit: 9 });
    expect(getInfiniteBatchSizes(5)).toEqual({ initialLimit: 10, nextLimit: 15 });
  });
});
