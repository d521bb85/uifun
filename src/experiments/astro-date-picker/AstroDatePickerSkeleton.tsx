import styles from "./AstroDatePickerSkeleton.module.css";

export interface AstroDatePickerSkeletonOverlayProps {
  ready?: boolean;
}

export function AstroDatePickerSkeletonOverlay({
  ready = false,
}: AstroDatePickerSkeletonOverlayProps) {
  return (
    <div
      className={styles.overlay}
      data-astro-skeleton=""
      data-ready={ready ? "" : undefined}
      aria-hidden="true"
    >
      <div className={styles.backdrop}>
        <div className={styles.stars} />
        <div className={styles.planet} />
        <div className={styles.sun} />
      </div>
    </div>
  );
}

export interface AstroDatePickerSkeletonProps {
  className?: string;
}

export function AstroDatePickerSkeleton({ className }: AstroDatePickerSkeletonProps) {
  const cardClassName = className ? `${styles.card} ${className}` : styles.card;

  return (
    <div
      className={cardClassName}
      role="status"
      aria-busy="true"
      aria-label="Loading Astro Date Picker"
    >
      <AstroDatePickerSkeletonOverlay />
    </div>
  );
}
