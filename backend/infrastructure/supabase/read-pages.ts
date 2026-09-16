// Supabase limits each response. Ratings and award history must include every
// row, not just the first response. Callers must provide a stable unique order.
export async function readPages<T>(query: {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await query.range(offset, offset + pageSize - 1);
    if (page.error) return { data: null, error: page.error };
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < pageSize) return { data: rows, error: null };
  }
}
