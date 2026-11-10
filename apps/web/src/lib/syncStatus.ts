export function syncBackfillActive(
  status:
    | {
        syncing: boolean;
        caughtUp: boolean | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(status && (status.syncing || status.caughtUp === false));
}
