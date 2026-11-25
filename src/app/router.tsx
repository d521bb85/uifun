import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { Preferences } from "@ui-sdk/react/preferences";
import { useEffect } from "react";
import { FeedHeader } from "@/components/feed/FeedHeader";
import { ExperimentStage } from "@/components/stage/ExperimentStage";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { getExperimentBySlug } from "@/lib/registry";
import { colorScheme } from "@/lib/theme";

const HOME_REDIRECT_URL = "https://ivanen.co";

function RootLayout() {
  const { isHome, alias } = useRouterState({
    select: (state) => {
      const isHomeRoute = state.location.pathname === "/";
      const match = state.matches.find((m) => "slug" in (m.params as Record<string, unknown>));
      const rawSlug = (match?.params as { slug?: string } | undefined)?.slug;
      const experiment = rawSlug ? getExperimentBySlug(rawSlug) : undefined;
      return {
        isHome: isHomeRoute,
        alias: experiment?.slug,
      };
    },
  });

  useEffect(() => {
    document.title = alias ? `${alias} — ui` : "ui — ivanen.co";
  }, [alias]);

  return (
    <Preferences preferences={[colorScheme]}>
      <div className="min-h-dvh w-full bg-canvas text-foreground">
        {!isHome && <FeedHeader alias={alias} />}
        <Outlet />
        {!isHome && <ThemeSwitcher />}
      </div>
    </Preferences>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

function HomeRedirectPage() {
  useEffect(() => {
    window.location.replace(HOME_REDIRECT_URL);
  }, []);

  return null;
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRedirectPage,
});

function NotFoundView() {
  return (
    <section className="flex min-h-dvh w-full items-center justify-center p-6">
      <p className="font-mono text-xs text-muted">404</p>
    </section>
  );
}

function renderExperiment(slug: string) {
  const experiment = getExperimentBySlug(slug);

  return (
    <main className="w-full">
      {experiment ? <ExperimentStage experiment={experiment} standalone /> : <NotFoundView />}
    </main>
  );
}

const experimentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/e/$slug",
  component: function ExperimentRoutePage() {
    const { slug } = experimentRoute.useParams();
    return renderExperiment(slug);
  },
});

const routeTree = rootRoute.addChildren([homeRoute, experimentRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: NotFoundView,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
