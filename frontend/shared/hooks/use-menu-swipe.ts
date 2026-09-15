"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import { bindMenuSwipe } from "../lib/menu-swipe";

export function useMenuSwipe(ref: RefObject<HTMLElement | null>, enabled: boolean, onOpen: () => void) {
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const media = window.matchMedia("(max-width: 850px)");
    return bindMenuSwipe(ref.current, onOpen, () => media.matches);
  }, [ref, enabled, onOpen]);
}
