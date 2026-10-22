"use client";

import { useEffect, useRef, type ReactNode } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Blocks marked `data-reveal` rise into place when they scroll into view. The page is fully readable without
 * scripts: the hidden starting state applies only after this script marks the page as ready.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing]");
    if (!root || reducedMotion() || !("IntersectionObserver" in window)) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.setAttribute("data-shown", ""); observer.unobserve(entry.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    root.setAttribute("data-motion", "");
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return null;
}

/**
 * A 3D scene that turns after the pointer on a computer, and after the scroll on a phone (the scene turns as it
 * crosses the screen). CSS keeps a gentle idle sway either way.
 */
export function TiltScene({ className, children }: { className?: string; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stage.current;
    if (!element || reducedMotion()) return;
    let frame = 0;
    const tilt = (x: number, y: number) => {
      element.style.setProperty("--tilt-x", x.toFixed(2) + "deg");
      element.style.setProperty("--tilt-y", y.toFixed(2) + "deg");
    };
    const later = (work: () => void) => { cancelAnimationFrame(frame); frame = requestAnimationFrame(work); };
    if (window.matchMedia("(pointer: fine)").matches) {
      const move = (event: PointerEvent) => later(() => {
        const box = element.getBoundingClientRect();
        const x = (event.clientX - (box.left + box.width / 2)) / window.innerWidth;
        const y = (event.clientY - (box.top + box.height / 2)) / window.innerHeight;
        tilt(-y * 10, x * 14);
      });
      window.addEventListener("pointermove", move, { passive: true });
      return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(frame); };
    }
    const scroll = () => later(() => {
      const box = element.getBoundingClientRect();
      // -1 when the scene's centre is at the bottom edge of the screen, 0 at the middle, 1 at the top edge.
      const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - (box.top + box.height / 2)) / (window.innerHeight / 2)));
      // Entering from below the scene stands more upright, so its top edge never rises over the text above.
      tilt(progress * 6, progress * 12);
    });
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.removeEventListener("scroll", scroll); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={stage} className={className}>{children}</div>;
}
