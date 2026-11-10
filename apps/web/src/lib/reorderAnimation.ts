import { useRef } from "react";

type StableSortReorderTokenInput = {
  scopeKey: string;
  sortKey: string;
  isPlaceholderData: boolean;
};

type ReorderTokenState = {
  scopeKey: string;
  settledSortKey: string;
  pendingSortKey: string | null;
  revision: number;
};

// Keep reorder token pinned while placeholder rows are visible. Only advance the
// token once sorted data is real, which avoids placeholder->ready flicker.
export function useStableSortReorderToken(
  input: StableSortReorderTokenInput,
): string {
  const stateRef = useRef<ReorderTokenState>({
    scopeKey: input.scopeKey,
    settledSortKey: input.sortKey,
    pendingSortKey: null,
    revision: 0,
  });

  const state = stateRef.current;
  if (state.scopeKey !== input.scopeKey) {
    state.scopeKey = input.scopeKey;
    state.settledSortKey = input.sortKey;
    state.pendingSortKey = null;
    state.revision = 0;
  }

  const sortChangedFromSettled = input.sortKey !== state.settledSortKey;
  if (sortChangedFromSettled) {
    state.pendingSortKey = input.sortKey;
    if (!input.isPlaceholderData) {
      state.settledSortKey = input.sortKey;
      state.pendingSortKey = null;
      state.revision += 1;
    }
  } else if (state.pendingSortKey && state.pendingSortKey !== input.sortKey) {
    state.pendingSortKey = null;
  }

  return `${state.scopeKey}:${state.settledSortKey}:r${state.revision}`;
}
