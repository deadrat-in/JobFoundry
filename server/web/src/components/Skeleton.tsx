import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '1rem',
  borderRadius = 'var(--radius-sm)',
  className = '',
  style,
}) => {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
};

export const SkeletonJobCard: React.FC = () => {
  return (
    <div className="job-card skeleton-card">
      <div className="job-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div style={{ flex: 1, marginRight: '1rem' }}>
          <Skeleton width="65%" height="1.4rem" borderRadius="var(--radius-sm)" style={{ marginBottom: '0.5rem' }} />
          <Skeleton width="40%" height="1rem" borderRadius="var(--radius-xs)" />
        </div>
        <Skeleton width="52px" height="52px" borderRadius="var(--radius-md)" />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <Skeleton width="80px" height="24px" borderRadius="var(--radius-full)" />
        <Skeleton width="90px" height="24px" borderRadius="var(--radius-full)" />
        <Skeleton width="70px" height="24px" borderRadius="var(--radius-full)" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
        <Skeleton width="100%" height="0.85rem" />
        <Skeleton width="92%" height="0.85rem" />
        <Skeleton width="60%" height="0.85rem" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
        <Skeleton width="100px" height="0.8rem" />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Skeleton width="75px" height="28px" borderRadius="var(--radius-sm)" />
          <Skeleton width="75px" height="28px" borderRadius="var(--radius-sm)" />
        </div>
      </div>
    </div>
  );
};

export const SkeletonFeed: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="job-feed-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonJobCard key={i} />
      ))}
    </div>
  );
};

export const SkeletonStatCard: React.FC = () => {
  return (
    <div className="stat-card skeleton-stat-card">
      <Skeleton width="42px" height="42px" borderRadius="var(--radius-md)" />
      <div style={{ flex: 1 }}>
        <Skeleton width="40%" height="1.6rem" style={{ marginBottom: '0.35rem' }} />
        <Skeleton width="70%" height="0.85rem" />
      </div>
    </div>
  );
};

export const SkeletonKanban: React.FC = () => {
  return (
    <div className="kanban-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem' }}>
      {Array.from({ length: 4 }).map((_, colIdx) => (
        <div key={colIdx} className="kanban-column" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <Skeleton width="50%" height="1.2rem" />
            <Skeleton width="28px" height="20px" borderRadius="var(--radius-full)" />
          </div>
          <SkeletonJobCard />
          <SkeletonJobCard />
        </div>
      ))}
    </div>
  );
};
