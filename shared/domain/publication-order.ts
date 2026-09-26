type Publication = { id: string; createdAt: string; isPinned?: boolean; pinnedAt?: string };

function compareTime(a: string, b: string) {
  const aTime = Date.parse(a), bTime = Date.parse(b);
  return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime - bTime : a.localeCompare(b);
}

// Keep the pin queue in the order items were pinned, independent of creation dates.
export function comparePublications(a: Publication, b: Publication) {
  const pinnedOrder = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinnedOrder) return pinnedOrder;
  if (a.isPinned && b.isPinned) {
    const pinTimeOrder = compareTime(a.pinnedAt || a.createdAt, b.pinnedAt || b.createdAt);
    if (pinTimeOrder) return pinTimeOrder;
  }
  return compareTime(a.createdAt, b.createdAt) || a.id.localeCompare(b.id);
}
