export const METALLIC_SCOPE_CLASS = "kpeg-metal-scope";

export function getMetallicScopeElement(): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error("Metallic scope is unavailable outside the browser");
  }
  const scoped = document.querySelector<HTMLElement>(`.${METALLIC_SCOPE_CLASS}`);
  if (scoped) {
    return scoped;
  }
  return document.body;
}
