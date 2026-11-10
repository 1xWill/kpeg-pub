import { useEffect, useState } from "react";

const WIDE_DESKTOP_MIN = 1280;
const DESKTOP_MIN = 980;
const TABLET_MIN = 700;

export function getResponsiveGalleryColumns(width: number): number {
  if (width >= WIDE_DESKTOP_MIN) return 5;
  if (width >= DESKTOP_MIN) return 4;
  if (width >= TABLET_MIN) return 3;
  return 2;
}

function getCurrentColumns(): number {
  if (typeof window === "undefined") return 5;
  return getResponsiveGalleryColumns(window.innerWidth);
}

export function useResponsiveGalleryColumns(): number {
  const [columns, setColumns] = useState(getCurrentColumns);

  useEffect(() => {
    const update = () => setColumns(getCurrentColumns());
    const queries = [WIDE_DESKTOP_MIN, DESKTOP_MIN, TABLET_MIN].map((width) =>
      window.matchMedia(`(min-width: ${width}px)`),
    );
    update();
    queries.forEach((query) => query.addEventListener("change", update));
    return () => {
      queries.forEach((query) => query.removeEventListener("change", update));
    };
  }, []);

  return columns;
}

export function getInfiniteBatchSizes(columns: number) {
  const safeColumns = Math.max(1, columns);
  return {
    initialLimit: safeColumns * 2,
    nextLimit: safeColumns * 3,
  };
}
