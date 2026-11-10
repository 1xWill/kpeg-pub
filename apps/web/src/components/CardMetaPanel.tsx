import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

type CardMetaPanelProps = {
  primaryLeft: string;
  primaryLeftNode?: ReactNode;
  primaryRight: string;
  primaryRightNode?: ReactNode;
  primaryRightStyle?: CSSProperties | undefined;
  secondaryLeft: string;
  secondaryLeftNode?: ReactNode;
  secondaryRight: string;
  secondaryRightNode?: ReactNode;
  secondaryLeftStyle?: CSSProperties | undefined;
};

export function CardMetaPanel({
  primaryLeft,
  primaryLeftNode,
  primaryRight,
  primaryRightNode,
  primaryRightStyle,
  secondaryLeft,
  secondaryLeftNode,
  secondaryRight,
  secondaryRightNode,
  secondaryLeftStyle,
}: CardMetaPanelProps) {
  return (
    <div className="relative grid h-[3.5rem] gap-[0.28rem] overflow-hidden rounded-b-[5px] bg-transparent px-0.5 pt-[.42rem] text-[var(--fg)] transition-[color,padding] duration-[360ms] ease-[var(--ease)] before:absolute before:inset-0 before:z-0 before:origin-top before:scale-y-0 before:bg-[var(--card-bg)] before:transition-transform before:duration-[240ms] before:ease-[var(--ease)] group-hover:px-2 group-hover:py-[0.3rem] group-hover:text-[var(--card-hover-fg)] group-hover:before:scale-y-100 max-[979px]:h-[2.75rem] max-[979px]:px-2 max-[979px]:py-[0.3rem] max-[979px]:text-[var(--card-hover-fg)] max-[979px]:before:scale-y-100">
      <div className="relative z-[1] flex min-w-0 items-baseline justify-between gap-2 h-fit mb-[-0.25px]">
        <CardMetaText text={primaryLeftNode ?? primaryLeft} strong="left" />
        <CardMetaText
          text={primaryRightNode ?? primaryRight}
          strong="right"
          style={primaryRightStyle}
        />
      </div>
      <div className="relative z-[1] gap-0.5 grid max-h-0 h-fit overflow-hidden opacity-0 transition-[max-height,opacity] duration-[240ms] ease-[var(--ease)] group-hover:max-h-8 group-hover:opacity-100 max-[979px]:max-h-8 max-[979px]:opacity-100">
        <span className="h-px w-full origin-left scale-x-70 bg-[color-mix(in_srgb,currentColor_30%,transparent)] transition-transform duration-[var(--dur-mid)] ease-[var(--ease)] group-hover:scale-x-100 max-[979px]:scale-x-100" />
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <CardMetaText
            text={secondaryLeftNode ?? secondaryLeft}
            strong="left"
            style={secondaryLeftStyle}
          />
          <CardMetaText text={secondaryRightNode ?? secondaryRight} strong="right" />
        </div>
      </div>
    </div>
  );
}

function CardMetaText({
  text,
  strong,
  style,
}: {
  text: ReactNode;
  strong: "left" | "right";
  style?: CSSProperties | undefined;
}) {
  const className = clsx(
    "min-w-0 truncate whitespace-nowrap transition-[color,font-size] duration-[var(--dur-mid)] ease-[var(--ease)]",
    strong === "left"
      ? "text-[clamp(0.65rem,1.4vw,0.8rem)] font-bold text-[var(--fg)] group-hover:text-[var(--card-hover-fg)] group-hover:text-[clamp(0.6rem,1.1vw,0.7rem)] max-[979px]:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:group-hover:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:text-[var(--card-hover-fg)]"
      : "shrink-0 text-[clamp(0.6rem,1.1vw,0.7rem)] font-extrabold tracking-[0.08em] text-[var(--fg-muted)] group-hover:text-[var(--card-hover-muted)] group-hover:text-[clamp(0.5rem,1vw,0.6rem)] max-[979px]:group-hover:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:text-[clamp(0.45rem,0.8vw,0.55rem)] max-[979px]:text-[var(--card-hover-muted)]",
  );

  return strong === "left" ? (
    <span className={className} style={style}>
      {text}
    </span>
  ) : (
    <strong className={className} style={style}>
      {text}
    </strong>
  );
}
