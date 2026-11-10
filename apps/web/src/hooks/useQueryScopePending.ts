import { useEffect, useState } from "react";

export function useQueryScopePending(input: {
  scopeKey: string;
  scopeHasCachedData: boolean;
  hasData: boolean;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
}) {
  const [settledScopeKey, setSettledScopeKey] = useState(input.scopeKey);
  const scopeChanged = input.scopeKey !== settledScopeKey;
  const scopeHasReadyData = input.hasData && !input.isPlaceholderData;

  useEffect(() => {
    if (scopeHasReadyData) {
      setSettledScopeKey(input.scopeKey);
    }
  }, [scopeHasReadyData, input.scopeKey]);

  return (
    scopeChanged &&
    !input.scopeHasCachedData &&
    (input.isPending || input.isFetching || input.isPlaceholderData)
  );
}
