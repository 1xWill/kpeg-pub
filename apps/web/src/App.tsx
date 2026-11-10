import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  type Location,
} from "react-router-dom";
import { NavBar } from "./components/NavBar.js";
import { MarketSaleWatcher } from "./components/MarketSaleWatcher.js";
import { PageBackdrop } from "./components/PageBackdrop.js";
import { ScrollToTop } from "./components/ScrollToTop.js";
import { SlidingPaneSwap } from "./components/SlidingPaneSwap.js";
import { ToastProvider } from "./context/toast.js";
import { useMetallicAnimationResync } from "./hooks/useMetallicAnimationResync.js";
import { initTxSyncQueue, TX_SYNC_FLUSHED_EVENT } from "./lib/syncQueue.js";
import { getWagmiConfig, subscribeWagmiConfig } from "./lib/wagmi.js";
import { METALLIC_SCOPE_CLASS } from "./lib/metallicScope.js";

const GalleryPage = lazy(async () => {
  const module = await import("./pages/GalleryPage.js");
  return { default: module.GalleryPage };
});
const HomePage = lazy(async () => {
  const module = await import("./pages/HomePage.js");
  return { default: module.HomePage };
});
const TradePage = lazy(async () => {
  const module = await import("./pages/TradePage.js");
  return { default: module.TradePage };
});
const MarketPage = lazy(async () => {
  const module = await import("./pages/MarketPage.js");
  return { default: module.MarketPage };
});
const DetailPage = lazy(async () => {
  const module = await import("./pages/DetailPage.js");
  return { default: module.DetailPage };
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  },
});

type DetailRouteState = {
  detailModal?: boolean;
  detailOrigin?: "explore" | "collections" | "portfolio";
  backgroundLocation?: Location;
};

function parseDetailRouteState(value: unknown): DetailRouteState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DetailRouteState>;
  if (!candidate.detailModal || !candidate.backgroundLocation) return null;
  return candidate as DetailRouteState;
}

function AppRoutes({
  onTransitioningChange,
}: {
  onTransitioningChange: (transitioning: boolean) => void;
}) {
  const location = useLocation();
  const detailRouteState = parseDetailRouteState(location.state);
  const backgroundLocation = detailRouteState?.backgroundLocation ?? null;
  const baseLocation = backgroundLocation ?? location;
  const showDetailOverlay = backgroundLocation !== null;

  return (
    <SlidingPaneSwap
      className="relative"
      contentKey={`${baseLocation.pathname}${baseLocation.search}${baseLocation.hash}`}
      suppressNestedTransitions
      content={
        <>
          <Suspense
            fallback={
              <main className="relative z-10 mx-auto max-w-[var(--page-max)] pt-10 text-[var(--fg-muted)]">
                Loading...
              </main>
            }
          >
            <Routes location={baseLocation}>
              <Route path="/" element={<HomePage />} />
              <Route path="/explore" element={<GalleryPage mode="explore" />} />
              <Route
                path="/collections"
                element={<GalleryPage mode="collections" />}
              />
              <Route
                path="/portfolio/:owner"
                element={<GalleryPage mode="portfolio" />}
              />
              <Route path="/trade" element={<TradePage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/kpeg/:id" element={<DetailPage />} />
            </Routes>
          </Suspense>
          {showDetailOverlay ? (
            <Suspense fallback={null}>
              <Routes>
                <Route
                  path="/kpeg/:id"
                  element={<DetailPage presentation="modal" />}
                />
              </Routes>
            </Suspense>
          ) : null}
        </>
      }
      durationMs={190}
      offsetPx={48}
      onTransitioningChange={onTransitioningChange}
    />
  );
}

function AppFrame() {
  const location = useLocation();
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  useMetallicAnimationResync();
  const showAppNav = location.pathname !== "/";

  return (
    <>
      <MarketSaleWatcher />
      <ScrollToTop />
      <div
        className={`${METALLIC_SCOPE_CLASS} min-h-screen px-[var(--page-pad)] ${showAppNav ? "pb-16 max-[979px]:pb-24" : "pb-10 max-[979px]:pb-14"} max-sm:px-[var(--page-pad-mob)]`}
      >
        <PageBackdrop paused={routeTransitioning} />
        {showAppNav ? <NavBar /> : null}
        <AppRoutes onTransitioningChange={setRouteTransitioning} />
      </div>
    </>
  );
}

export function App() {
  const [wagmiConfig, setWagmiConfig] = useState(() => getWagmiConfig());

  useEffect(() => {
    return subscribeWagmiConfig(setWagmiConfig);
  }, []);

  useEffect(() => {
    initTxSyncQueue();
    const onSynced = () => {
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["gallery"] });
      void queryClient.invalidateQueries({ queryKey: ["owner-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["market-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["market-listings"] });
      void queryClient.invalidateQueries({ queryKey: ["market-listing"] });
      void queryClient.invalidateQueries({
        queryKey: ["market-owner-reserved-kitty-ids"],
      });
      void queryClient.invalidateQueries({ queryKey: ["wallet-owner-kitties"] });
    };
    window.addEventListener(TX_SYNC_FLUSHED_EVENT, onSynced);
    return () => {
      window.removeEventListener(TX_SYNC_FLUSHED_EVENT, onSynced);
    };
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <AppFrame />
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
