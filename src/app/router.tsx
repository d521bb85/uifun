import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Preferences } from "@ui-sdk/react/preferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedHeader } from "@/components/feed/FeedHeader";
import { FeedList, type FeedScrollToIndex } from "@/components/feed/FeedList";
import { FeedNav } from "@/components/feed/FeedNav";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { experiments, getExperimentBySlug } from "@/lib/registry";
import { colorScheme } from "@/lib/theme";

function indexFromPathname(pathname: string): number | null {
  if (pathname === "/") return 0;
  const match = pathname.match(/^\/e\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  const idx = experiments.findIndex((item) => item.slug === match[1]);
  return idx === -1 ? null : idx + 1;
}

function pathForIndex(index: number): string {
  if (index <= 0) return "/";
  const item = experiments[index - 1];
  return item ? `/e/${item.slug}` : "/";
}

function NotFoundView() {
  return (
    <section className="flex h-dvh w-full items-center justify-center p-6">
      <p className="font-mono text-xs text-muted">404</p>
    </section>
  );
}

function FeedShell({ initialIndex }: { initialIndex: number }) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const scrollToRef = useRef<FeedScrollToIndex | null>(null);

  const alias = activeIndex > 0 ? experiments[activeIndex - 1]?.slug : undefined;

  useEffect(() => {
    document.title = alias ? `${alias} – ivanen.co` : "ui – ivanen.co";
  }, [alias]);

  const handleActiveChange = useCallback((index: number, options: { push: boolean }) => {
    setActiveIndex(index);
    const nextPath = pathForIndex(index);
    if (window.location.pathname !== nextPath) {
      if (options.push) {
        window.history.pushState(null, "", nextPath);
      } else {
        window.history.replaceState(window.history.state, "", nextPath);
      }
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const targetIndex = indexFromPathname(window.location.pathname);
      if (targetIndex !== null) {
        scrollToRef.current?.(targetIndex, { push: false });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleSelect = useCallback((index: number) => {
    scrollToRef.current?.(index, { push: true });
  }, []);

  return (
    <>
      <FeedHeader alias={alias} onHomeClick={() => handleSelect(0)} />
      <FeedList
        items={experiments}
        initialIndex={initialIndex}
        onActiveChange={handleActiveChange}
        scrollToRef={scrollToRef}
      />
      <FeedNav items={experiments} activeIndex={activeIndex} onSelect={handleSelect} />
    </>
  );
}

function RootLayout() {
  const navigate = useNavigate();
  const initialIndex = useRouterState({
    select: (state) => indexFromPathname(state.location.pathname),
  });

  useEffect(() => {
    if (initialIndex === null) {
      document.title = "404 – ivanen.co";
    }
  }, [initialIndex]);

  return (
    <Preferences preferences={[colorScheme]}>
      <div className="fixed inset-0 bg-canvas text-foreground">
        {initialIndex !== null ? (
          <FeedShell initialIndex={initialIndex} />
        ) : (
          <>
            <FeedHeader onHomeClick={() => void navigate({ to: "/" })} />
            <Outlet />
          </>
        )}
        <ThemeSwitcher />
      </div>
    </Preferences>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const experimentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/e/$slug",
  component: function ExperimentRoutePage() {
    const { slug } = experimentRoute.useParams();
    return getExperimentBySlug(slug) ? null : <NotFoundView />;
  },
});

const routeTree = rootRoute.addChildren([homeRoute, experimentRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: false,
  defaultNotFoundComponent: NotFoundView,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
