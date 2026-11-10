// @vitest-environment jsdom
/**
 * Final review F6: "Danh sách sân" on the detail page used to push a bare
 * `/venues`, dropping the filters and area the user came from.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { render, screen, cleanup } from "@testing-library/react";
import { writeListReturn } from "@/lib/venues/directory-state";
import { VenueBackLink } from "./venue-back-link";

let hydrated: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (hydrated) {
    const { root, container } = hydrated;
    act(() => root.unmount());
    container.remove();
    hydrated = null;
  }
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const href = () =>
  screen.getByRole("link", { name: "Danh sách sân" }).getAttribute("href");

describe("VenueBackLink", () => {
  it("goes to /venues when the page was not opened from the list", () => {
    render(<VenueBackLink venueId={3} label="Danh sách sân" />);
    expect(href()).toBe("/venues");
  });

  it("returns to the remembered list URL with its filters for the same venue", () => {
    writeListReturn(3, "/venues?r=10&open=true");
    render(<VenueBackLink venueId={3} label="Danh sách sân" />);
    expect(href()).toBe("/venues?r=10&open=true");
  });

  it("ignores a list URL remembered for another venue", () => {
    writeListReturn(4, "/venues?r=10");
    render(<VenueBackLink venueId={3} label="Danh sách sân" />);
    expect(href()).toBe("/venues");
  });

  it("server HTML says /venues and hydrating with a remembered list logs no mismatch", () => {
    const html = renderToString(
      <VenueBackLink venueId={3} label="Danh sách sân" />,
    );
    expect(html).toContain('href="/venues"');

    writeListReturn(3, "/venues?r=20");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    act(() => {
      hydrated = {
        root: hydrateRoot(
          container,
          <VenueBackLink venueId={3} label="Danh sách sân" />,
          { onRecoverableError },
        ),
        container,
      };
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(
      consoleError.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((m) => /hydrat|did not match|server rendered/i.test(m)),
    ).toEqual([]);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/venues?r=20",
    );
  });
});
