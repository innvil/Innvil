/** Shared skeleton primitives for cache-first navigation -- shown ONLY on a
 *  genuinely empty SWR cache (first-ever visit to a page in this session).
 *  Every subsequent visit already has cached data and skips straight to the
 *  real content while a background revalidation runs silently -- these are
 *  never shown as a "loading" state layered over already-visible data (that
 *  would be exactly the full-page-spinner-on-every-navigation behavior this
 *  cache-first pattern is meant to avoid). Pure presentation, no state/props
 *  beyond layout shape -- reused across Overview/Watchers/Communities/etc.
 *  so every page's empty-cache state looks consistent. */

function Bone({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg w-surface-raised ${className}`} />;
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading overview">
      <div>
        <Bone className="h-6 w-56 mb-2" />
        <Bone className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-card p-4"><Bone className="h-3 w-20 mb-3" /><Bone className="h-7 w-16" /></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr] gap-5">
        <div className="w-card p-5"><Bone className="h-5 w-40 mb-4" /><Bone className="h-40 w-full" /></div>
        <div className="w-card p-5"><Bone className="h-5 w-32 mb-4" /><Bone className="h-40 w-full" /></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        <div className="w-card p-5"><Bone className="h-5 w-24 mb-4" /><Bone className="h-32 w-full" /></div>
        <div className="w-card p-5"><Bone className="h-5 w-32 mb-4" /><Bone className="h-32 w-full" /></div>
      </div>
    </div>
  );
}

export function TableSkeleton({ title = true, rows = 6 }: { title?: boolean; rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      {title && (
        <div className="flex items-center justify-between gap-3">
          <div><Bone className="h-6 w-40 mb-2" /><Bone className="h-4 w-64" /></div>
        </div>
      )}
      <div className="w-card p-0 overflow-hidden">
        <div className="p-4 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Bone key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
