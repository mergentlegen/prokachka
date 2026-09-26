import { externalHref, formatDateTime } from "@/frontend/shared/lib/format";
import type { Announcement } from "@/shared/domain/types";
import { comparePublications } from "@/shared/domain/publication-order";
import { PinBadge } from "@/frontend/shared/PublicationPin";
import { ResourceCard } from "@/frontend/shared/ResourceCard";

export function AnnouncementsBlock({ announcements }: { announcements: Announcement[] }) {
  return (
    <section className="member-announcements">
      <div className="section-heading">
        <div><p className="eyebrow">Команда</p><h2>Объявления</h2></div>
        <span className="announcement-count">{announcements.length}</span>
      </div>
      {announcements.length === 0 ? (
        <div className="announcement-empty">Пока нет объявлений от наставника.</div>
      ) : (
        <div className="announcement-list">
          {[...announcements].sort(comparePublications).map((announcement) => {
            const href = externalHref(announcement.resourceUrl);
            return (
            <article className="announcement-card" key={announcement.id}>
              <div className="announcement-icon">✦</div>
              <div className="announcement-body">
                <div className="announcement-meta"><span>Для команды</span><time>{formatDateTime(announcement.createdAt)}</time></div>
                {announcement.isPinned && <PinBadge />}<h3>{announcement.title}</h3>
                <p>{announcement.content}</p>
                {href && <ResourceCard url={href} caption="Материал объявления" />}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
