type Publication = { id: string; createdAt: string; isPinned?: boolean };

// Pinning changes the group, not the publication date. Ties stay stable across reloads.
export function comparePublications(a: Publication, b: Publication) {
  return Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
