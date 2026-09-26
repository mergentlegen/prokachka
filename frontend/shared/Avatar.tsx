"use client";
/* eslint-disable @next/next/no-img-element -- Photos are optimized once at upload and served directly from Storage CDN. */

import { useState } from "react";
import { avatarInitials } from "@/shared/domain/profile";
import styles from "./Avatar.module.css";

export function Avatar({ name, src, className = "", eager = false }: { name: string; src?: string; className?: string; eager?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className={`${styles.avatar} ${className}`} aria-hidden="true">
    {src && src !== failedUrl ? <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} /> : avatarInitials(name)}
  </span>;
}
