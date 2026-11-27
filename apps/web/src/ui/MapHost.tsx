import { useEffect, useRef } from "preact/hooks";

export type MapHostProps = {
  id?: string;
  className?: string;
  ariaLabel?: string;
  testId?: string;
  onMount: (container: HTMLElement) => (() => void) | void;
};

/**
 * Renders a stable DOM node for imperative MapLibre GL JS instances.
 * The host mounts once and stays attached across Preact/signal re-renders so
 * map layers and markers update strictly in-place without recreating the canvas.
 */
export function MapHost({ id, className, ariaLabel, testId, onMount }: MapHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cleanup = onMountRef.current(el);
    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id={id}
      class={className}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  );
}
