"use client";

import { useState, type ReactNode } from "react";
import styles from "./EditorWithPreview.module.css";

/** The form and «Так увидит участник» side by side on a computer; two tabs on a phone. */
export function EditorWithPreview({ editor, preview }: { editor: ReactNode; preview: ReactNode }) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return <div className={styles.layout} data-tab={tab}>
    <div className={styles.tabs} role="tablist" aria-label="Редактор или предпросмотр">
      <button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")}>Редактор</button>
      <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>Как увидит участник</button>
    </div>
    <div className={styles.editor}>{editor}</div>
    <aside className={styles.preview} aria-label="Так увидит участник">
      <p className={styles.previewTitle}>Так увидит участник</p>
      {preview}
    </aside>
  </div>;
}
