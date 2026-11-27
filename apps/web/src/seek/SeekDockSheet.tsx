import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { animate } from "motion";
import { animateSheetIn, motionAllowed, motionPresets } from "../game-motion";
import type { SeekPanel } from "./types";

export function SeekDockSheet({ panel, open, children }: {
  panel: SeekPanel | null;
  open: boolean;
  children: ComponentChildren;
}) {
  const sheet = useRef<HTMLElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const extent = useRef<DOMRect | null>(null);
  const positions = useRef(new Map<SeekPanel | null, number>());

  useLayoutEffect(() => {
    const node = sheet.current;
    if (node) {
      node.scrollTop = positions.current.get(panel) ?? 0;
      const wasOpen = extent.current !== null;
      const measure = () => { extent.current = node.getBoundingClientRect(); };
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(node);
      const stop = animateSheetIn(node, { offsetY: wasOpen ? 6 : 16, fromScale: 1 });
      return () => {
        resize.disconnect();
        if (node.isConnected) measure();
        stop();
      };
    }

    const bounds = extent.current;
    extent.current = null;
    const exit = ghost.current;
    if (!bounds || !exit || !motionAllowed()) return;
    Object.assign(exit.style, {
      display: "block", top: `${bounds.top}px`, left: `${bounds.left}px`,
      width: `${bounds.width}px`, height: `${bounds.height}px`,
    });
    const control = animate(exit, { opacity: [0.65, 0], y: [0, 18] }, motionPresets.sheet);
    const hide = () => { exit.style.display = "none"; };
    void control.finished.then(hide, hide);
    return () => { control.stop(); hide(); };
  }, [panel, open]);

  return <>
    {open && <section ref={sheet} class="sg-sheet" aria-label="Panel permainan"
      onScroll={event => positions.current.set(panel, event.currentTarget.scrollTop)}>
      {children}
    </section>}
    <div ref={ghost} class="sg-sheet-exit" aria-hidden="true" />
  </>;
}
