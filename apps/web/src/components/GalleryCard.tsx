import { Link, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";
import clsx from "clsx";
import type { KittyItem } from "../lib/api.js";
import { useKittyDetailPrefetch } from "../hooks/useKittyDetailPrefetch.js";
import { getMetallicTierVariant, getTierColor } from "../lib/tierColor.js";
import { CardMetaPanel } from "./CardMetaPanel.js";
import { KPEGArt } from "./KPEGArt.js";
import { RollingNumber } from "./RollingNumber.js";

const BACKGROUND_STYLES: Record<
  string,
  { bg: string; fg: string; muted: string }
> = {
  White: { bg: "#F5F4EE", fg: "#171410", muted: "#4d473d" },
  Sky: { bg: "#BFDFFF", fg: "#111820", muted: "#405466" },
  Mint: { bg: "#CDEDD4", fg: "#101a12", muted: "#435847" },
  Coral: { bg: "#FFC8B5", fg: "#21100b", muted: "#6b4033" },
  Lilac: { bg: "#E2D5FF", fg: "#191323", muted: "#51456d" },
  Midnight: { bg: "#232A3A", fg: "#f4f0e8", muted: "#c8c0b4" },
};
const DEFAULT_BACKGROUND_STYLE = BACKGROUND_STYLES.White!;
type GalleryOrigin = "explore" | "collections" | "portfolio";

function bornLabel(ms: number): string {
  const ageMs = Math.max(0, Date.now() - ms);
  const days = Math.floor(ageMs / 86_400_000);
  if (days === 0) return "BORN TODAY";
  return `BORN ${days}D AGO`;
}

export function GalleryCard({
  kitty,
  origin,
  detailQueryScope,
}: {
  kitty: KittyItem;
  origin: GalleryOrigin;
  detailQueryScope?: {
    chainId?: number | null;
    tokenAddress?: string | null;
  };
}) {
  const location = useLocation();
  const background =
    BACKGROUND_STYLES[kitty.traits.background] ?? DEFAULT_BACKGROUND_STYLE;
  const tierColor = getTierColor(kitty.tierLabel);
  const metallicTierVariant = getMetallicTierVariant(kitty.tierLabel);
  const prefetchHandlers = useKittyDetailPrefetch(kitty.id, detailQueryScope);
  return (
    <Link
      className={clsx(
        "group grid min-w-0 text-[var(--fg)] transition-opacity hover:opacity-95",
        metallicTierVariant && "tier-metal-card",
      )}
      data-tier-metal={metallicTierVariant}
      to={`/kpeg/${kitty.id}`}
      state={{
        detailModal: true,
        detailOrigin: origin,
        backgroundLocation: location,
        kittyPreview: kitty,
      }}
      {...prefetchHandlers}
      style={
        {
          "--card-bg": background.bg,
          "--card-hover-fg": background.fg,
          "--card-hover-muted": background.muted,
        } as CSSProperties
      }
    >
      <div className="mb-[-1px] grid aspect-square place-items-center overflow-hidden rounded-[5px] bg-white/[0.055] transition-[border-radius] duration-[var(--dur-mid)] ease-[var(--ease)] group-hover:rounded-b-none max-[979px]:rounded-b-none">
        <KPEGArt
          traits={kitty.traits}
          className="h-full w-full [image-rendering:pixelated]"
          alt={`kPEG #${kitty.id}`}
        />
      </div>
      <CardMetaPanel
        primaryLeft={`KPEG #${kitty.id.toLocaleString()}`}
        primaryLeftNode={
          <span className="inline-flex min-w-0">
            <RollingNumber value={`KPEG #${kitty.id.toLocaleString()}`} />
          </span>
        }
        primaryRight={kitty.tierLabel.toUpperCase()}
        primaryRightStyle={tierColor ? { color: tierColor } : undefined}
        secondaryLeft={bornLabel(kitty.mintedAt)}
        secondaryRight={`#${kitty.blockNumber.toLocaleString()}`}
        secondaryRightNode={
          <RollingNumber value={`#${kitty.blockNumber.toLocaleString()}`} />
        }
      />
    </Link>
  );
}
