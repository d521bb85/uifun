import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { FeedHeader } from "@/components/feed/FeedHeader";
import { FeedList } from "@/components/feed/FeedList";
import { ExperimentStage } from "@/components/stage/ExperimentStage";
import { experiments, getExperimentBySlug } from "@/lib/registry";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-dvh w-full bg-canvas text-foreground">
      <FeedHeader />
      <Outlet />
    </div>
  ),
});

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FeedPage,
});

function FeedPage() {
  return (
    <main className="w-full">
      <FeedList items={experiments} />
    </main>
  );
}

const experimentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/e/$slug",
  component: StandaloneExperimentPage,
});

function StandaloneExperimentPage() {
  const { slug } = experimentRoute.useParams();
  const experiment = getExperimentBySlug(slug);

  return (
    <main className="w-full">
      {experiment ? (
        <ExperimentStage experiment={experiment} standalone />
      ) : (
        <section className="flex min-h-dvh w-full items-center justify-center p-6">
          <p className="text-xs text-muted">404</p>
        </section>
      )}
    </main>
  );
}

const routeTree = rootRoute.addChildren([feedRoute, experimentRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
