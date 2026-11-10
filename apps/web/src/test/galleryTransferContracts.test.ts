import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readTransferRecipientFromClipboard } from "../pages/GalleryPage.js";

describe("transfer clipboard helper", () => {
  it("returns null when clipboard read is unavailable", async () => {
    await expect(readTransferRecipientFromClipboard(null)).resolves.toBeNull();
  });

  it("reads and trims clipboard recipient text", async () => {
    await expect(
      readTransferRecipientFromClipboard({
        readText: async () =>
          " 0x2222222222222222222222222222222222222222 \n",
      }),
    ).resolves.toBe("0x2222222222222222222222222222222222222222");
  });
});

describe("transfer ui contract", () => {
  it("keeps transfer button class contract aligned with market list button", () => {
    const gallerySource = readFileSync("src/pages/GalleryPage.tsx", "utf8");
    const marketSource = readFileSync("src/pages/MarketPage.tsx", "utf8");
    const buttonClassContract =
      "flex gap-2 cursor-pointer justify-center rounded-[6px] border border-[var(--line)] bg-[var(--fg)] px-[1rem] py-[0.4rem] text-[var(--bg)] transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45 max-md:w-full max-[640px]:text-[0.8rem]";

    expect(gallerySource).toContain(buttonClassContract);
    expect(marketSource).toContain(buttonClassContract);
  });

  it("uses the nf-fa-send_o icon for transfer button", () => {
    const gallerySource = readFileSync("src/pages/GalleryPage.tsx", "utf8");
    expect(gallerySource).toContain("nf nf-fa-send_o");
  });
});
