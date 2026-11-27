import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExperimentEntry } from "@/lib/registry";
import { FeedHeader } from "./FeedHeader";
import { FeedList } from "./FeedList";
import { FeedNav } from "./FeedNav";

function FirstStub() {
  return <div data-rendered="first-exp">First Experiment content</div>;
}

function SecondStub() {
  return <div data-rendered="second-exp">Second Experiment content</div>;
}

function ThirdStub() {
  return <div data-rendered="third-exp">Third Experiment content</div>;
}

function FallbackStub() {
  return <div data-skeleton="first-exp" />;
}

function makeEntry(
  slug: string,
  title: string,
  Component: ComponentType,
  Fallback?: ComponentType,
): ExperimentEntry {
  return {
    slug,
    title,
    date: "2026-11-27",
    tags: [],
    surface: "auto",
    Component,
    Fallback,
    preload: () => {},
  };
}

const mockItems: readonly ExperimentEntry[] = [
  makeEntry("first-exp", "First Experiment", FirstStub, FallbackStub),
  makeEntry("second-exp", "Second Experiment", SecondStub),
  makeEntry("third-exp", "Third Experiment", ThirdStub),
];

describe("Feed navigation", () => {
  it("renders slug aliases in TOC on home without mounting any experiment screens", () => {
    const html = renderToString(
      <FeedList items={mockItems} initialIndex={0} onActiveChange={() => {}} />,
    );

    expect(html).toContain('href="/e/first-exp"');
    expect(html).toContain(">first-exp</a>");
    expect(html).toContain(">second-exp</a>");
    expect(html).toContain(">third-exp</a>");
    expect(html).not.toContain("First Experiment");
    expect(html).not.toContain('data-rendered="first-exp"');
    expect(html).toContain('data-skeleton="first-exp"');
    expect(html).not.toContain('data-rendered="second-exp"');
    expect(html).not.toContain('data-rendered="third-exp"');
  });

  it("mounts only the opened experiment screen when jumping directly to a non-first item", () => {
    const html = renderToString(
      <FeedList items={mockItems} initialIndex={2} onActiveChange={() => {}} />,
    );

    expect(html).not.toContain('data-rendered="first-exp"');
    expect(html).toContain('data-rendered="second-exp"');
    expect(html).not.toContain('data-rendered="third-exp"');
  });

  it("renders right-side screen navigation using slug aliases with aria-current on the active screen", () => {
    const html = renderToString(<FeedNav items={mockItems} activeIndex={2} onSelect={() => {}} />);

    expect(html).toContain('href="/"');
    expect(html).toContain('href="/e/first-exp"');
    expect(html).toContain('href="/e/second-exp"');
    expect(html).toContain('href="/e/third-exp"');
    expect(html).toContain('aria-label="second-exp" aria-current="page"');
    expect(html).not.toContain("Second Experiment");
    expect(html).not.toContain('aria-label="ui" aria-current="page"');
  });

  it("renders ui home link in FeedHeader with optional alias", () => {
    const homeHeader = renderToString(<FeedHeader />);
    expect(homeHeader).toContain('href="/"');
    expect(homeHeader).toContain(">ui</a>");

    const expHeader = renderToString(<FeedHeader alias="second-exp" />);
    expect(expHeader).toContain('href="/"');
    expect(expHeader).toContain("second-exp");
  });
});
