import { useEffect } from "react";
import { useLocation } from "react-router-dom";

type DetailModalState = {
  detailModal?: boolean;
  backgroundLocation?: unknown;
  skipScrollReset?: boolean;
};

export function ScrollToTop() {
  const { pathname, state } = useLocation();

  useEffect(() => {
    const detailModalState =
      state && typeof state === "object" ? (state as DetailModalState) : null;
    if (
      pathname.startsWith("/kpeg/") &&
      detailModalState?.backgroundLocation
    ) {
      return;
    }
    if (
      detailModalState?.detailModal === true &&
      detailModalState.backgroundLocation
    ) {
      return;
    }
    if (detailModalState?.skipScrollReset === true) {
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, state]);

  return null;
}
