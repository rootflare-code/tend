import { expect, test } from "bun:test";
import { openDetachedHrefFromClick } from "../src/ui/DetachedLink";

test("detached links open away from the current Tend tab", () => {
  const calls: Array<{ href: string | URL | undefined; target: string | undefined; features: string | undefined }> = [];
  let prevented = false;
  let stopped = false;
  const opened = { opener: "tend" } as unknown as Window;

  const result = openDetachedHrefFromClick({
    button: 0,
    defaultPrevented: false,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; },
  }, "https://example.com/source", (href, target, features) => {
    calls.push({ href, target, features });
    return opened;
  });

  expect(result).toBe(true);
  expect(prevented).toBe(true);
  expect(stopped).toBe(true);
  expect(calls).toEqual([{ href: "https://example.com/source", target: "_blank", features: "noopener,noreferrer" }]);
  expect(opened.opener).toBeNull();
});

test("detached links leave non-primary clicks to the browser", () => {
  let opened = false;
  let prevented = false;

  const result = openDetachedHrefFromClick({
    button: 1,
    defaultPrevented: false,
    preventDefault: () => { prevented = true; },
    stopPropagation: () => {},
  }, "https://example.com/source", () => {
    opened = true;
    return null;
  });

  expect(result).toBe(false);
  expect(opened).toBe(false);
  expect(prevented).toBe(false);
});
