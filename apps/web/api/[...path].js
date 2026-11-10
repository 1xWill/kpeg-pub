export default async function handler(req, res) {
  const { handleServerlessRequest } = await import("@kpeg/indexer/serverless");
  await handleServerlessRequest(req, res);
}

export const config = {
  maxDuration: 60
};
