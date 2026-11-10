import { useEffect, useState } from "react";

const FRAMES = ["/", "—", "\\", "|"];

export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((value) => (value + 1) % FRAMES.length);
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="inline-flex w-[1ch]" aria-label="loading">
      {FRAMES[frame]}
    </span>
  );
}
