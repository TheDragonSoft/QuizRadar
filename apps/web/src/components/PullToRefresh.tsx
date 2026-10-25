import React, { useState, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";

interface PullToRefreshProps {
  children: React.ReactNode;
  threshold?: number;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ children, threshold = 64 }) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const startYRef = useRef(0);
  const pullDistanceRef = useRef(0);

  const openModals = useAppStore((s) => s.openModals);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const triggerSync = useAppStore((s) => s.triggerSync);

  // Gating rule: when any modal is open, pull-to-refresh is disabled
  const isGated = openModals.length > 0 || syncStatus === "syncing";

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isGated) return;
    if (typeof window !== "undefined" && window.scrollY > 5) return;

    startYRef.current = e.touches[0].clientY;
    pullDistanceRef.current = 0;
    setIsPulling(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling || isGated) return;
    if (typeof window !== "undefined" && window.scrollY > 5) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      setIsPulling(false);
      return;
    }

    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;

    if (diff > 0) {
      // Apply spring resistance curve
      const resistance = Math.min(diff * 0.45, threshold * 1.5);
      pullDistanceRef.current = resistance;
      setPullDistance(resistance);
    } else {
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isPulling || isGated) return;
    setIsPulling(false);

    if (pullDistanceRef.current >= threshold) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(10);
      }
      triggerSync();
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
  };

  const isReady = pullDistance >= threshold;

  return (
    <div
      data-testid="pull-to-refresh-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative flex-1"
    >
      {/* Pull Indicator */}
      {(pullDistance > 0 || syncStatus === "syncing") && (
        <div
          data-testid="pull-to-refresh-indicator"
          style={{ height: syncStatus === "syncing" ? 48 : pullDistance }}
          className="flex w-full items-center justify-center overflow-hidden transition-all duration-150 ease-out"
        >
          <div className="flex items-center gap-2 rounded-full border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1 shadow-sm">
            <RefreshCw
              style={{
                transform: syncStatus === "syncing" ? undefined : `rotate(${pullDistance * 4}deg)`,
              }}
              className={`h-4 w-4 text-[var(--accent)] ${
                syncStatus === "syncing" ? "animate-spin" : ""
              }`}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-[var(--text-muted)]">
              {syncStatus === "syncing"
                ? copy.pullToRefresh.syncing
                : isReady
                  ? copy.pullToRefresh.release
                  : copy.pullToRefresh.pulling}
            </span>
          </div>
        </div>
      )}

      {children}
    </div>
  );
};
