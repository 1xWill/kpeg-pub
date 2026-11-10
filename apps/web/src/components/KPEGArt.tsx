import { useMemo, type CSSProperties } from "react";
import { renderKPEGSvgDataUri, type KPEGTraits } from "@kpeg/core";

export function KPEGArt({
  traits,
  svg,
  id,
  className,
  alt,
  style
}: {
  traits?: KPEGTraits;
  svg?: string | undefined;
  id?: number;
  className?: string;
  alt?: string;
  style?: CSSProperties | undefined;
}) {
  const src = useMemo(() => {
    if (svg) {
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
    if (!traits) {
      return null;
    }
    return renderKPEGSvgDataUri(traits);
  }, [
    svg,
    traits?.background,
    traits?.breed,
    traits?.clothes,
    traits?.mood,
    traits?.marks,
    traits?.mouth,
    traits?.eyes,
    traits?.accessory,
  ]);

  if (!src) {
    return null;
  }
  return (
    <img
      className={className}
      style={style}
      src={src}
      alt={alt ?? `kPEG ${id ?? ""}`.trim()}
    />
  );
}
