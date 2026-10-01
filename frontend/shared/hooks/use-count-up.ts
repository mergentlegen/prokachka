"use client";

import { useEffect, useRef, useState } from "react";

// Animates a number from what is currently on screen (or `initial` on mount) to the new value;
// instant with reduced motion. Starting from the shown number keeps restarted effects correct.
export function useCountUp(value: number, duration = 700, initial = value) {
  const [shown, setShown] = useState(initial);
  const current = useRef(initial);
  useEffect(() => {
    const start = current.current;
    if (start === value) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const began = performance.now();
    const step = (time: number) => {
      const progress = reduced ? 1 : Math.min(1, (time - began) / duration);
      const next = Math.round(start + (value - start) * (1 - Math.pow(1 - progress, 3)));
      current.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function CountUp({ value }: { value: number }) {
  return useCountUp(value);
}
