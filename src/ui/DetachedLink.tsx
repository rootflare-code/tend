import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

type OpenWindow = (url?: string | URL, target?: string, features?: string) => Window | null;

const DETACHED_TARGET = "_blank";
const DETACHED_FEATURES = "noopener,noreferrer";

interface DetachedClickEvent {
  button: number;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function openDetachedHref(href: string, openWindow: OpenWindow | undefined = typeof window !== "undefined" ? window.open.bind(window) : undefined): boolean {
  if (!openWindow) return false;
  const opened = openWindow(href, DETACHED_TARGET, DETACHED_FEATURES);
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Some browser wrappers expose a read-only opener.
    }
  }
  return Boolean(opened);
}

export function openDetachedHrefFromClick(event: DetachedClickEvent, href: string, openWindow?: OpenWindow): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  event.preventDefault();
  event.stopPropagation();
  return openDetachedHref(href, openWindow);
}

export function DetachedLink({
  href,
  children,
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "rel" | "target"> & {
  href: string;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    openDetachedHrefFromClick(event, href);
  };

  return (
    <a {...props} href={href} target={DETACHED_TARGET} rel="noopener noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}
