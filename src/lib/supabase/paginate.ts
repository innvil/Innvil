/** Supabase/PostgREST commonly returns no more than 1,000 rows per request.
 * This loader deliberately has no total-row ceiling: it advances through
 * stable, caller-specified pages until the final short page arrives. */

export const DATABASE_PAGE_SIZE = 500;

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function loadAllDatabasePages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = DATABASE_PAGE_SIZE
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Page size must be a positive integer.");
  }

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
