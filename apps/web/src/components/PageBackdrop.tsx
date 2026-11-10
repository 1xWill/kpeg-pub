import { generateKPEG } from "@kpeg/core";
import type { CSSProperties } from "react";
import { KPEGArt } from "./KPEGArt.js";

const backdropKitties = [
  generateKPEG({
    wholeBought: 2,
    walletAddress: "0x0000000000000000000000000000000000000201",
    mintNonce: 1,
    seedHint: "page-a",
  }),
  generateKPEG({
    wholeBought: 6,
    walletAddress: "0x0000000000000000000000000000000000000202",
    mintNonce: 2,
    seedHint: "page-b",
  }),
  generateKPEG({
    wholeBought: 13,
    walletAddress: "0x0000000000000000000000000000000000000203",
    mintNonce: 3,
    seedHint: "page-c",
  }),
  generateKPEG({
    wholeBought: 24,
    walletAddress: "0x0000000000000000000000000000000000000204",
    mintNonce: 4,
    seedHint: "page-d",
  }),
  generateKPEG({
    wholeBought: 32,
    walletAddress: "0x0000000000000000000000000000000000000205",
    mintNonce: 5,
    seedHint: "page-e",
  }),
];

type FloatStyle = CSSProperties & Record<`--${string}`, string>;

const floatStyles: FloatStyle[] = [
  {
    "--tilt-start": "-7deg",
    "--tilt-end": "-4deg",
    "--float-distance": "34px",
    "--float-drift": "8px",
    top: "10%",
    left: "10%",
    animationDuration: "10s",
  },
  {
    "--tilt-start": "5deg",
    "--tilt-end": "8deg",
    "--float-distance": "42px",
    "--float-drift": "-7px",
    top: "24%",
    left: "48%",
    animationDuration: "8s",
    animationDelay: "-2.4s",
  },
  {
    "--tilt-start": "-3deg",
    "--tilt-end": "-1deg",
    "--float-distance": "36px",
    "--float-drift": "6px",
    right: "8%",
    top: "15%",
    animationDuration: "8s",
    animationDelay: "-4.8s",
  },
  {
    "--tilt-start": "9deg",
    "--tilt-end": "11deg",
    "--float-distance": "46px",
    "--float-drift": "-8px",
    right: "23%",
    bottom: "8%",
    animationDuration: "12s",
    animationDelay: "-7.2s",
  },
  {
    "--tilt-start": "-10deg",
    "--tilt-end": "-7deg",
    "--float-distance": "38px",
    "--float-drift": "7px",
    left: "20%",
    bottom: "-2%",
    animationDuration: "6s",
    animationDelay: "-9.8s",
  },
];

export function PageBackdrop({ paused = false }: { paused?: boolean }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      <style>{`
        @keyframes kpeg-float-swing {
          0% { transform: translate3d(0, 0, 0) rotate(var(--tilt-start, 0deg)); }
          50% { transform: translate3d(var(--float-drift, 6px), calc(var(--float-distance, 24px) * -0.55), 0) rotate(var(--tilt-end, 1deg)); }
          100% { transform: translate3d(0, calc(var(--float-distance, 24px) * -1), 0) rotate(var(--tilt-start, 0deg)); }
        }
      `}</style>
      {backdropKitties.map((kitty, index) => (
        <KPEGArt
          key={index}
          traits={kitty.traits}
          id={index + 1}
          className="kpeg-backdrop-float absolute w-[clamp(120px,14vw,220px)] opacity-[0.17] blur-[12px] saturate-[0.85] [image-rendering:pixelated] [will-change:transform]"
          style={{
            ...floatStyles[index],
            "--kpeg-backdrop-play-state": paused ? "paused" : "running",
            animationName: "kpeg-float-swing",
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDirection: "alternate",
          } as FloatStyle}
          alt=""
        />
      ))}
    </div>
  );
}
