import { useEffect } from "react";
import { requestMetallicAnimationResync } from "./useMetallicAnimationResync.js";

export function useMetallicResyncOnChange(token: string) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let frameA: number | null = null;
    let frameB: number | null = null;
    frameA = window.requestAnimationFrame(() => {
      frameA = null;
      frameB = window.requestAnimationFrame(() => {
        frameB = null;
        requestMetallicAnimationResync();
      });
    });
    return () => {
      if (frameA !== null) {
        window.cancelAnimationFrame(frameA);
      }
      if (frameB !== null) {
        window.cancelAnimationFrame(frameB);
      }
    };
  }, [token]);
}
