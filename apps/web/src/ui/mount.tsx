import { render, type ComponentChildren } from "preact";

export function mountPreact(
  root: HTMLElement,
  renderNode: () => ComponentChildren,
): () => void {
  let mounted = true;
  root.replaceChildren();
  render(renderNode(), root);
  return () => {
    if (!mounted) return;
    mounted = false;
    render(null, root);
    root.replaceChildren();
  };
}

export type MountPreactOverlayOptions = {
  parent?: HTMLElement;
  signal?: AbortSignal;
  className?: string;
  testId?: string;
  restoreFocus?: boolean;
};

export function mountPreactOverlay(
  renderNode: (close: (restoreFocus?: boolean) => void) => ComponentChildren,
  options: MountPreactOverlayOptions = {},
): () => void {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  if (options.className) host.className = options.className;
  if (options.testId) host.dataset.testid = options.testId;
  const parent = options.parent ?? document.body;

  let closed = false;
  const onAbort = () => close(false);

  function close(restoreFocus = options.restoreFocus ?? true) {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", onAbort);
    render(null, host);
    host.remove();
    if (restoreFocus && previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  if (options.signal?.aborted) {
    return () => {};
  }
  options.signal?.addEventListener("abort", onAbort, { once: true });

  parent.appendChild(host);
  render(renderNode(close), host);

  return () => close(false);
}
