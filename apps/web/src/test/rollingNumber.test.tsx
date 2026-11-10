import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RollingNumber } from "../components/RollingNumber.js";

describe("RollingNumber", () => {
  it("renders one animated column per digit and keeps non-digits static", () => {
    render(<RollingNumber value="12,345 ETH" />);
    const root = screen.getByLabelText("12,345 ETH");

    const digitTracks = root.querySelectorAll("span[style*='translateY(-']");
    expect(digitTracks).toHaveLength(5);
    expect(digitTracks[0]?.getAttribute("style")).toContain("translateY(-1em)");
    expect(digitTracks[1]?.getAttribute("style")).toContain("translateY(-2em)");
    expect(digitTracks[2]?.getAttribute("style")).toContain("translateY(-3em)");
    expect(digitTracks[3]?.getAttribute("style")).toContain("translateY(-4em)");
    expect(digitTracks[4]?.getAttribute("style")).toContain("translateY(-5em)");
    const digitSlots = root.querySelectorAll("span.relative");
    expect(digitSlots[0]?.textContent).toBe("00123456789");
    expect(digitSlots[0]?.querySelector("span.invisible")?.textContent).toBe("0");
    expect(digitTracks[0]?.className).toContain("absolute");
    expect(digitTracks[0]?.className).not.toContain("flex");

    const staticChars = Array.from(root.querySelectorAll("span.whitespace-pre"))
      .map((item) => item.textContent);
    expect(staticChars).toEqual([",", " ", "E", "T", "H"]);
  });

  it("updates digit column transforms when the value changes", () => {
    const { rerender } = render(<RollingNumber value="9" />);
    let root = screen.getByLabelText("9");
    let digitTrack = root.querySelector("span[style*='translateY(-']");
    expect(digitTrack?.getAttribute("style")).toContain("translateY(-9em)");
    expect(digitTrack?.className).toContain("kpeg-rolling-track");
    expect(digitTrack?.className).toContain("transition-transform");

    rerender(<RollingNumber value="0" />);
    root = screen.getByLabelText("0");
    digitTrack = root.querySelector("span[style*='translateY(-']");
    expect(digitTrack?.getAttribute("style")).toContain("translateY(-0em)");
    expect(digitTrack?.className).toContain("transition-transform");
  });

  it("supports centered digit alignment for inline CTA labels", () => {
    render(<RollingNumber value="1" align="center" />);
    const root = screen.getByLabelText("1");
    const digitSlot = root.querySelector("span.relative");
    expect(digitSlot?.className).toContain("align-baseline");
    expect(digitSlot?.className).not.toContain("align-[-0.08em]");
  });
});
