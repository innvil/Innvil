/**
 * Order-link normalization for duplicate detection — MUST stay byte-for-byte
 * equivalent to the Postgres `normalize_order_link()` function (migration
 * 0012) that the DB's unique duplicate-guard indexes are built on
 * (uq_orders_active_link_service, uq_orders_active_link_category_service).
 * Comparing raw/differently-normalized links between the app layer and the
 * DB layer is exactly how a link could be flagged as a duplicate by one
 * layer and not the other.
 *
 * SQL definition (0012):
 *   regexp_replace(
 *     regexp_replace(
 *       regexp_replace(
 *         regexp_replace(lower(coalesce(link, '')), '^https?://', ''),
 *         '^www\.', ''
 *       ),
 *       '[?#].*$', ''
 *     ),
 *     '/+$', ''
 *   )
 *
 * Lowercases the ENTIRE string first (including the path) — not just the
 * host — then strips scheme, www, query/fragment, and trailing slashes, in
 * that exact order. Do not swap in URL()-based parsing here; it lowercases
 * only the host and diverges from the DB on mixed-case paths.
 */
export function normalizeOrderLink(link: string): string {
  return (link || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}
