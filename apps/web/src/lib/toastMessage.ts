export function normalizeToastMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Something went wrong.";

  const lower = trimmed.toLowerCase();
  if (lower.includes("user rejected")) {
    return "User rejected the wallet request.";
  }
  if (lower.includes("insufficient funds")) {
    return "Insufficient ETH for this transaction.";
  }
  if (lower.includes("user denied")) {
    return "User denied the wallet request.";
  }

  const cutMarkers = [
    "Request Arguments:",
    "Contract Call:",
    "Docs:",
    "Details:",
    "Version:",
  ];
  const markerIndex = cutMarkers
    .map((marker) => trimmed.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  const concise =
    markerIndex !== undefined ? trimmed.slice(0, markerIndex).trim() : trimmed;

  if (concise.length <= 180) return concise;
  return `${concise.slice(0, 177).trimEnd()}...`;
}
