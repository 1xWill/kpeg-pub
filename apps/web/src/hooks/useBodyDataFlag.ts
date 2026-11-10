import { useEffect } from "react";
import { getMetallicScopeElement } from "../lib/metallicScope.js";

const activeBodyDataFlags = new Map<string, number>();

export function useBodyDataFlag(flag: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const scope = getMetallicScopeElement();
    const activeCount = activeBodyDataFlags.get(flag) ?? 0;
    activeBodyDataFlags.set(flag, activeCount + 1);
    scope.dataset[flag] = "true";

    return () => {
      const remaining = (activeBodyDataFlags.get(flag) ?? 1) - 1;
      if (remaining <= 0) {
        activeBodyDataFlags.delete(flag);
        delete scope.dataset[flag];
        return;
      }
      activeBodyDataFlags.set(flag, remaining);
    };
  }, [enabled, flag]);
}
