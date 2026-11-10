const HEAD_SAMPLE = 10;
const TAIL_SAMPLE = 4;

export function buildMetallicResyncToken(input: {
  scope: string;
  ids: readonly number[];
  extra?: string;
}) {
  const { ids, scope, extra } = input;
  const count = ids.length;
  const head = ids.slice(0, HEAD_SAMPLE).join(",");
  const tail =
    count > HEAD_SAMPLE
      ? ids.slice(Math.max(HEAD_SAMPLE, count - TAIL_SAMPLE)).join(",")
      : "";
  return `${scope}|${count}|${head}|${tail}${extra ? `|${extra}` : ""}`;
}
