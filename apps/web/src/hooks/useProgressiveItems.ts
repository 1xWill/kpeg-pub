import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const KEY_SEPARATOR = "\u001f";

type ResetToken = string | number | null | undefined;

type ProgressiveState = {
  signature: string;
  keys: string[];
  resetToken: ResetToken;
  enabled: boolean;
  visibleCount: number;
};

type CommittedSnapshot = {
  signature: string;
  keys: string[];
  resetToken: ResetToken;
  enabled: boolean;
  visibleCount: number;
};

export function isAppendOnlyKeyExpansion(input: {
  previousKeys: readonly string[];
  nextKeys: readonly string[];
}): boolean {
  if (input.previousKeys.length === 0) {
    return false;
  }
  if (input.nextKeys.length < input.previousKeys.length) {
    return false;
  }
  for (let index = 0; index < input.previousKeys.length; index += 1) {
    if (input.previousKeys[index] !== input.nextKeys[index]) {
      return false;
    }
  }
  return true;
}

function resolveSignature(keys: readonly string[]): string {
  return keys.join(KEY_SEPARATOR);
}

function keysEqual(previousKeys: readonly string[], nextKeys: readonly string[]) {
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  for (let index = 0; index < previousKeys.length; index += 1) {
    if (previousKeys[index] !== nextKeys[index]) {
      return false;
    }
  }
  return true;
}

export function useProgressiveItems<T>(input: {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  enabled: boolean;
  initialCount: number;
  chunkSize: number;
  resetToken?: ResetToken;
}) {
  const keys = useMemo(
    () => input.items.map((item, index) => input.getKey(item, index)),
    [input.getKey, input.items],
  );
  const signature = useMemo(() => resolveSignature(keys), [keys]);
  const safeInitialCount = Math.max(1, Math.floor(input.initialCount));
  const safeChunkSize = Math.max(1, Math.floor(input.chunkSize));
  const total = input.items.length;
  const initialVisibleCount = input.enabled
    ? Math.min(total, safeInitialCount)
    : total;

  const [progressiveState, setProgressiveState] = useState<ProgressiveState>(
    () => ({
      signature,
      keys: [...keys],
      resetToken: input.resetToken,
      enabled: input.enabled,
      visibleCount: initialVisibleCount,
    }),
  );
  const committedRef = useRef<CommittedSnapshot>({
    signature,
    keys: [...keys],
    resetToken: input.resetToken,
    enabled: input.enabled,
    visibleCount: initialVisibleCount,
  });
  const frameGenerationRef = useRef<string>("");

  const committed = committedRef.current;
  const signatureChanged = committed.signature !== signature;
  const resetTokenChanged = committed.resetToken !== input.resetToken;
  const enabledChanged = committed.enabled !== input.enabled;
  const generationMatchesState =
    progressiveState.signature === signature &&
    keysEqual(progressiveState.keys, keys) &&
    progressiveState.resetToken === input.resetToken &&
    progressiveState.enabled === input.enabled;
  const generationVisibleCount = generationMatchesState
    ? progressiveState.visibleCount
    : committed.visibleCount;

  let effectiveVisibleCount = total;
  if (input.enabled) {
    if (!signatureChanged && !resetTokenChanged && !enabledChanged) {
      effectiveVisibleCount = Math.min(
        total,
        Math.max(generationVisibleCount, safeInitialCount),
      );
    } else {
      const appendOnly =
        signatureChanged &&
        !resetTokenChanged &&
        isAppendOnlyKeyExpansion({
          previousKeys: committed.keys,
          nextKeys: keys,
        });
      if (appendOnly) {
        effectiveVisibleCount = Math.min(
          total,
          Math.max(
            committed.visibleCount,
            generationVisibleCount,
            safeInitialCount,
          ),
        );
      } else {
        effectiveVisibleCount = Math.min(total, safeInitialCount);
      }
    }
  }

  useLayoutEffect(() => {
    committedRef.current = {
      signature,
      keys: [...keys],
      resetToken: input.resetToken,
      enabled: input.enabled,
      visibleCount: effectiveVisibleCount,
    };
  }, [effectiveVisibleCount, input.enabled, input.resetToken, keys, signature]);

  useEffect(() => {
    setProgressiveState((current) => {
      if (
        current.signature === signature &&
        keysEqual(current.keys, keys) &&
        current.resetToken === input.resetToken &&
        current.enabled === input.enabled &&
        current.visibleCount === effectiveVisibleCount
      ) {
        return current;
      }
      return {
        signature,
        keys: [...keys],
        resetToken: input.resetToken,
        enabled: input.enabled,
        visibleCount: effectiveVisibleCount,
      };
    });
  }, [effectiveVisibleCount, input.enabled, input.resetToken, keys, signature]);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }
    if (effectiveVisibleCount >= total) {
      return;
    }
    const frameGeneration = [
      signature,
      String(input.resetToken ?? ""),
      input.enabled ? "1" : "0",
      String(total),
      String(effectiveVisibleCount),
    ].join(KEY_SEPARATOR);
    frameGenerationRef.current = frameGeneration;
    const frame = window.requestAnimationFrame(() => {
      if (frameGenerationRef.current !== frameGeneration) {
        return;
      }
      const nextCount = Math.min(total, effectiveVisibleCount + safeChunkSize);
      if (nextCount <= effectiveVisibleCount) {
        return;
      }
      setProgressiveState((current) => {
        if (
          current.signature === signature &&
          keysEqual(current.keys, keys) &&
          current.resetToken === input.resetToken &&
          current.enabled === input.enabled &&
          current.visibleCount >= nextCount
        ) {
          return current;
        }
        if (
          current.signature !== signature ||
          !keysEqual(current.keys, keys) ||
          current.resetToken !== input.resetToken ||
          current.enabled !== input.enabled
        ) {
          return current;
        }
        return {
          signature,
          keys: [...keys],
          resetToken: input.resetToken,
          enabled: input.enabled,
          visibleCount: nextCount,
        };
      });
    });
    return () => {
      if (frameGenerationRef.current === frameGeneration) {
        frameGenerationRef.current = "";
      }
      window.cancelAnimationFrame(frame);
    };
  }, [
    effectiveVisibleCount,
    input.enabled,
    input.resetToken,
    keys,
    safeChunkSize,
    signature,
    total,
  ]);

  const resolvedVisibleCount = input.enabled ? effectiveVisibleCount : total;
  const visibleItems = useMemo(
    () => input.items.slice(0, resolvedVisibleCount),
    [input.items, resolvedVisibleCount],
  );

  return {
    keys,
    signature,
    visibleItems,
    visibleCount: resolvedVisibleCount,
    pendingCount: Math.max(0, total - resolvedVisibleCount),
    complete: resolvedVisibleCount >= total,
  };
}
