"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { externalHref } from "@/frontend/shared/lib/format";
import type { Announcement } from "@/shared/domain/types";
import { PinBadge } from "@/frontend/shared/PublicationPin";
import { ResourceCard } from "@/frontend/shared/ResourceCard";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { Avatar } from "@/frontend/shared/Avatar";
import { plural } from "@/frontend/shared/lib/plural";
import { AnnouncementGallery } from "./AnnouncementGallery";
import { friendlyTime, homeAnnouncements, isFresh, markSeen, readSeen, searchAnnouncements, sortAnnouncements, textParts } from "./announcement-view";
import styles from "./AnnouncementsBlock.module.css";

// A card that stayed at least half on screen counts as read; the mark goes away on the next visit, not under the reader's eyes.
function useSeenMarker(userId: string) {
  const observer = useRef<IntersectionObserver | null>(null);
  const cards = useRef(new Set<Element>());
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver((entries) => {
      const ids = entries.filter((entry) => entry.isIntersecting).map((entry) => {
        watcher.unobserve(entry.target);
        cards.current.delete(entry.target);
        return (entry.target as HTMLElement).dataset.announcement || "";
      }).filter(Boolean);
      markSeen(userId, ids);
    }, { threshold: 0.5 });
    observer.current = watcher;
    cards.current.forEach((card) => watcher.observe(card));
    return () => { watcher.disconnect(); observer.current = null; };
  }, [userId]);
  return useCallback((card: HTMLElement | null) => {
    if (!card) return;
    cards.current.add(card);
    observer.current?.observe(card);
  }, []);
}

function AnnouncementText({ text }: { text: string }) {
  return <p>{textParts(text).map((part, index) => part.kind === "text" ? part.text
    : part.kind === "url" ? <a key={index} className={styles.link} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
    : <a key={index} className={styles.link} href={part.href}>{part.text}</a>)}</p>;
}

function AnnouncementCard({ announcement, fresh, now, watch }: { announcement: Announcement; fresh: boolean; now: number; watch: (card: HTMLElement | null) => void }) {
  const href = externalHref(announcement.resourceUrl);
  const author = announcement.authorName || "Наставник";
  return <article ref={watch} data-announcement={announcement.id} className={`announcement-card ${styles.card} ${announcement.isPinned ? styles.pinned : ""}`}>
    <div className={styles.head}>
      <Avatar name={author} src={announcement.authorAvatarUrl} className={styles.avatar} />
      <span className={styles.byline}><strong>{author}</strong><time dateTime={announcement.createdAt}>{friendlyTime(announcement.createdAt, now)}</time></span>
      {fresh && <span className={styles.fresh}>Новое</span>}
    </div>
    <div className="announcement-body">
      {announcement.isPinned && <PinBadge />}<h3>{announcement.title}</h3>
      <AnnouncementText text={announcement.content} />
      <AnnouncementGallery photos={announcement.photos || []} title={announcement.title} />
      {href && <ResourceCard url={href} caption="Материал объявления" />}
    </div>
  </article>;
}

/** `at` fixes "now" (tests); the app uses the real clock. */
export function AnnouncementsBlock({ announcements, userId, at }: { announcements: Announcement[]; userId: string; at?: number }) {
  const sorted = useMemo(() => sortAnnouncements(announcements), [announcements]);
  // What was already read when the screen opened; reading now does not take the mark away mid-scroll.
  const [seen] = useState(() => readSeen(userId));
  const [now] = useState(() => at ?? Date.now());
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState("");
  const watch = useSeenMarker(userId);
  const fresh = (announcement: Announcement) => isFresh(announcement, now) && !seen.has(announcement.id);
  const newCount = sorted.filter(fresh).length;
  const home = homeAnnouncements(sorted);
  const found = allOpen ? searchAnnouncements(sorted, query) : [];
  const card = (announcement: Announcement) => <AnnouncementCard key={announcement.id} announcement={announcement} fresh={fresh(announcement)} now={now} watch={watch} />;
  return (
    <section className="member-announcements">
      <div className="section-heading">
        <div><p className="eyebrow">Команда</p><h2>Объявления</h2></div>
        {newCount > 0 ? <span className={styles.newCount}>{newCount} {plural(newCount, "новое", "новых", "новых")}</span> : <span className="announcement-count">{sorted.length}</span>}
      </div>
      {sorted.length === 0 ? (
        <div className="announcement-empty">Пока нет объявлений от наставника.</div>
      ) : (
        <div className="announcement-list">
          {home.map(card)}
          {sorted.length > home.length && <button type="button" className={styles.all} onClick={() => { setQuery(""); setAllOpen(true); }}>
            Все объявления <b>{sorted.length}</b><span aria-hidden="true">→</span>
          </button>}
        </div>
      )}
      {allOpen && <ModalSheet title="Все объявления" tall onClose={() => setAllOpen(false)}>
        <div className={styles.feed}>
          <input id="announcement-search" type="search" className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по объявлениям" aria-label="Поиск по объявлениям" />
          {found.length ? <div className="announcement-list">{found.map(card)}</div> : <div className="announcement-empty">Ничего не нашлось. Попробуйте другое слово.</div>}
        </div>
      </ModalSheet>}
    </section>
  );
}
