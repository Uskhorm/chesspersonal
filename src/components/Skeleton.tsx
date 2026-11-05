/** Placeholder blocks that hold the final layout's size, so nothing shifts when data lands. */
export function Skeleton({ w = '100%', h = 16, r, className, style }: { w?: number | string; h?: number | string; r?: number; className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={`skeleton ${className ?? ''}`} style={{ display: 'block', width: w, height: h, borderRadius: r, ...style }} />;
}

export function PageSkeleton({ board }: { board?: boolean }) {
  return (
    <div className={`page ${board ? 'wide' : ''}`} aria-busy="true" aria-label="Loading">
      {board ? (
        <div className="boardpage">
          <div className="boardpage-main">
            <Skeleton h={36} w="40%" style={{ marginBottom: 8 }} />
            <Skeleton h="auto" style={{ aspectRatio: '1', borderRadius: 7 }} />
          </div>
          <div className="boardpage-side">
            <Skeleton h={180} r={14} />
            <Skeleton h={260} r={14} />
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <Skeleton h={44} w="45%" />
          <Skeleton h={18} w="30%" />
          <Skeleton h={220} r={14} style={{ marginTop: 16 }} />
          <Skeleton h={64} r={10} />
          <Skeleton h={64} r={10} />
        </div>
      )}
    </div>
  );
}
