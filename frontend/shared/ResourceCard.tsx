"use client";

import { useState } from "react";
import { resourcePreview, type ResourcePreview } from "@/frontend/shared/lib/resource-preview";
import styles from "./ResourceCard.module.css";

export function ResourceCard({ url, caption = "Материал задания" }: { url?: string | null; caption?: string }) {
  const preview = resourcePreview(url);
  return preview ? <ResourceLink key={preview.href} preview={preview} caption={caption} /> : null;
}

function ResourceLink({ preview, caption }: { preview: ResourcePreview; caption: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(preview.thumbnail && !imageFailed);
  return <a className={`${styles.card} ${hasImage ? styles.withImage : ""}`} href={preview.href} target="_blank" rel="noopener noreferrer" aria-label={`${preview.action}: ${preview.host} (в новой вкладке)`}>
    {hasImage ? <span className={styles.media}>
      <img src={preview.thumbnail} alt="" width="480" height="360" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      <span className={styles.play} aria-hidden="true">▶</span>
    </span> : <span className={styles.symbol} aria-hidden="true">{preview.type === "video" ? "▶" : preview.type === "test" ? "✓" : preview.type === "meeting" ? "◷" : "↗"}</span>}
    <span className={styles.body}>
      <span className={styles.caption}>{caption}</span>
      <strong className={styles.title}>{preview.label}</strong>
      <span className={styles.host}>{preview.host}</span>
      <span className={styles.action}>{preview.action} <span aria-hidden="true">↗</span></span>
    </span>
  </a>;
}
