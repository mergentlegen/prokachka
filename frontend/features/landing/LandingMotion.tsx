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
 * A product picture that lies tilted back while it sits low on the screen and straightens out as it scrolls up
 * (`--tilt` from 14deg to 0). Only this one element turns — nothing inside it is 3D — so Safari draws it whole.
 */
export function ScrollTilt({ className, children }: { className?: string; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || reducedMotion()) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = node.getBoundingClientRect().top;
        const height = window.innerHeight;
        // Flat once the top edge reaches 35% of the screen height; fully tilted while it is at the bottom edge.
        const lean = Math.max(0, Math.min(1, (top - height * 0.35) / (height * 0.65)));
        node.style.setProperty("--tilt", (lean * 14).toFixed(2) + "deg");
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={element} className={className}>{children}</div>;
}
