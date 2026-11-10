import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableSortReorderToken } from "../lib/reorderAnimation.js";

function TokenProbe({
  scopeKey,
  sortKey,
  isPlaceholderData,
}: {
  scopeKey: string;
  sortKey: string;
  isPlaceholderData: boolean;
}) {
  const token = useStableSortReorderToken({
    scopeKey,
    sortKey,
    isPlaceholderData,
  });
  return <output data-testid="token">{token}</output>;
}

describe("useStableSortReorderToken", () => {
  it("keeps token stable until placeholder data is replaced", () => {
    const { container, rerender } = render(
      <TokenProbe
        scopeKey="explore||"
        sortKey="latest"
        isPlaceholderData={false}
      />,
    );
    const readToken = () =>
      container.querySelector('[data-testid="token"]')?.textContent;
    const latestToken = readToken();

    rerender(
      <TokenProbe
        scopeKey="explore||"
        sortKey="scarcity"
        isPlaceholderData={true}
      />,
    );
    expect(readToken()).toBe(latestToken);

    rerender(
      <TokenProbe
        scopeKey="explore||"
        sortKey="scarcity"
        isPlaceholderData={false}
      />,
    );
    const scarcityToken = readToken();
    expect(scarcityToken).not.toBe(latestToken);

    rerender(
      <TokenProbe
        scopeKey="explore||"
        sortKey="scarcity"
        isPlaceholderData={false}
      />,
    );
    expect(readToken()).toBe(scarcityToken);
  });

  it("does not bump token when sort reverts before data settles", () => {
    const { container, rerender } = render(
      <TokenProbe
        scopeKey="market|all||"
        sortKey="latest"
        isPlaceholderData={false}
      />,
    );
    const readToken = () =>
      container.querySelector('[data-testid="token"]')?.textContent;
    const initialToken = readToken();

    rerender(
      <TokenProbe
        scopeKey="market|all||"
        sortKey="scarcity"
        isPlaceholderData={true}
      />,
    );
    expect(readToken()).toBe(initialToken);

    rerender(
      <TokenProbe
        scopeKey="market|all||"
        sortKey="latest"
        isPlaceholderData={true}
      />,
    );
    expect(readToken()).toBe(initialToken);

    rerender(
      <TokenProbe
        scopeKey="market|all||"
        sortKey="latest"
        isPlaceholderData={false}
      />,
    );
    expect(readToken()).toBe(initialToken);
  });
});
