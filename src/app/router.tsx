import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { FeedHeader } from "@/components/feed/FeedHeader";
import { FeedList } from "@/components/feed/FeedList";
import { ExperimentStage } from "@/components/stage/ExperimentStage";
import { allTags, experiments, getExperimentBySlug } from "@/lib/registry";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex min-h-dvh flex-col bg-canvas text-foreground">
      <Outlet />
    </div>
  ),
});

interface FeedSearch {
  tag?: string;
}

const feedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): FeedSearch => ({
    tag: typeof search.tag === "string" && search.tag.length > 0 ? search.tag : undefined,
  }),
  component: FeedPage,
});

function FeedPage() {
  const { tag } = feedRoute.useSearch();
  const navigate = useNavigate({ from: feedRoute.fullPath });

  const filtered = tag
    ? experiments.filter((experiment) => experiment.tags.includes(tag))
    : experiments;

  return (
    <>
      <FeedHeader
        totalCount={experiments.length}
        tags={allTags}
        activeTag={tag}
        onSelectTag={(nextTag) => {
          void navigate({ search: nextTag ? { tag: nextTag } : {} });
        }}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <FeedList items={filtered} />
      </main>
    </>
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
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            to="/"
            search={{}}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to feed</span>
          </Link>
          <span className="font-mono text-[11px] text-muted">/{slug}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {experiment ? (
          <ExperimentStage experiment={experiment} standalone />
        ) : (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <p className="font-mono text-xs uppercase tracking-wider text-muted">404</p>
            <h1 className="text-base font-medium text-foreground">
              Experiment &ldquo;{slug}&rdquo; not found
            </h1>
            <Link
              to="/"
              search={{}}
              className="mt-1 rounded-md border border-border bg-surface-subtle px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border/50"
            >
              Return to feed
            </Link>
          </div>
        )}
      </main>
    </>
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
