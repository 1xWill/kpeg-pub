import clsx from "clsx";

type RollingNumberAlign = "baseline" | "center";

export function RollingNumber(props: {
  value: string;
  className?: string;
  align?: RollingNumberAlign;
}) {
  const align = props.align ?? "baseline";

  return (
    <span
      aria-label={props.value}
      className={clsx(
        "inline-flex leading-none [font-variant-numeric:tabular-nums]",
        align === "center" ? "items-center" : "items-baseline",
        props.className,
      )}
    >
      {props.value.split("").map((char, index) => {
        if (char >= "0" && char <= "9") {
          const digit = Number(char);
          return (
            <span
              key={index}
              className={clsx(
                "relative inline-block h-[1em] w-[0.62em] overflow-hidden text-center leading-none",
                align === "center" ? "align-baseline" : "align-[-0.08em]",
              )}
            >
              <span className="invisible block h-[1em] leading-none">0</span>
              <span
                className="kpeg-rolling-track absolute left-0 top-0 block w-full leading-none transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{ transform: `translateY(-${digit}em)` }}
              >
                {Array.from({ length: 10 }, (_, value) => (
                  <span
                    key={value}
                    className="block h-[1em] w-full text-center leading-none"
                  >
                    {value}
                  </span>
                ))}
              </span>
            </span>
          );
        }
        return (
          <span key={index} className="whitespace-pre">
            {char}
          </span>
        );
      })}
    </span>
  );
}
