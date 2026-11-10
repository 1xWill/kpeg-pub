import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { KittyItem } from "../lib/api.js";
import { KPEGArt } from "./KPEGArt.js";
import { Spinner } from "./Spinner.js";
import { useProgressiveItems } from "../hooks/useProgressiveItems.js";

export type KittySelectionCandidate = {
  id: number;
  kitty: KittyItem | null;
};

type KittySelectionCardProps = {
  candidate: KittySelectionCandidate;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: number) => void;
};

const KittySelectionCard = memo(function KittySelectionCard({
  candidate,
  selected,
  disabled,
  onToggle,
}: KittySelectionCardProps) {
  const kitty = candidate.kitty;
  const onClick = useCallback(() => onToggle(candidate.id), [candidate.id, onToggle]);
  return (
    <button
      className={
        disabled
          ? "grid cursor-not-allowed gap-1 rounded-[5px] border border-[var(--line)] bg-white/[0.02] p-1 text-left opacity-45"
          : selected
            ? "grid cursor-pointer gap-1 rounded-[5px] border border-[var(--fg)] bg-white/[0.08] p-1 text-left"
            : "grid cursor-pointer gap-1 rounded-[5px] border border-[var(--line)] bg-white/[0.035] p-1 text-left hover:border-[var(--fg)]"
      }
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {kitty ? (
        <KPEGArt
          traits={kitty.traits}
          id={kitty.id}
          className="aspect-square w-full [image-rendering:pixelated]"
          alt={`kPEG #${kitty.id}`}
        />
      ) : (
        <div className="grid aspect-square w-full place-items-center rounded-[4px] bg-white/[0.045] font-mono text-[0.65rem] text-[var(--fg-muted)]">
          INDEXING
        </div>
      )}
      <span className="font-mono text-[0.7rem]">KPEG #{candidate.id}</span>
    </button>
  );
});

const MODAL_PROGRESSIVE_INITIAL_COUNT = 12;
const MODAL_PROGRESSIVE_CHUNK_SIZE = 12;

export function KittySelectionModal({
  open,
  eyebrow,
  title,
  kitties,
  loading,
  loadError,
  selectedIds,
  selectionLocked,
  maxBundleSize,
  onClose,
  onToggle,
  footer,
  loadingLabel = "Loading wallet kPEGs...",
  loadErrorLabel = "Could not verify wallet kPEGs from chain.",
  emptyLabel = "You don't have any kPEG yet.",
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  kitties: KittySelectionCandidate[];
  loading: boolean;
  loadError: boolean;
  selectedIds: number[];
  selectionLocked: boolean;
  maxBundleSize: number;
  onClose: () => void;
  onToggle: (id: number) => void;
  footer: ReactNode;
  loadingLabel?: string;
  loadErrorLabel?: string;
  emptyLabel?: string;
}) {
  const selectedCount = selectedIds.length;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [gridReady, setGridReady] = useState(open);

  useEffect(() => {
    if (!open) {
      setGridReady(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setGridReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const progressiveCandidates = useProgressiveItems({
    items: kitties,
    getKey: (candidate) => String(candidate.id),
    enabled: open && gridReady && !loading && !loadError && kitties.length > 0,
    initialCount: MODAL_PROGRESSIVE_INITIAL_COUNT,
    chunkSize: MODAL_PROGRESSIVE_CHUNK_SIZE,
  });

  return createPortal(
    <div
      className={
        open
          ? "fixed inset-0 z-[1000] grid place-items-center bg-black/55 px-[var(--page-pad)] opacity-100 backdrop-blur-sm transition-opacity duration-[200ms] ease-linear max-[980px]:px-[var(--page-pad-mob)]"
          : "fixed inset-0 z-[1000] grid place-items-center bg-black/55 px-[var(--page-pad)] opacity-0 backdrop-blur-sm transition-opacity duration-[200ms] ease-linear max-[980px]:px-[var(--page-pad-mob)]"
      }
      onClick={onClose}
    >
      <section
        className={
          open
            ? "mt-[4vh] grid max-h-[80vh] w-full max-w-[900px] translate-x-0 translate-y-0 transform-gpu grid-rows-[auto_minmax(0,1fr)_auto] gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-4 shadow-2xl transition-transform duration-[200ms] ease-linear will-change-transform max-[980px]:mt-[-2vh] max-[980px]:h-[92svh] max-[980px]:max-h-[92svh] max-[980px]:max-w-[min(92vw,720px)] max-sm:p-2 max-sm:max-w-none"
            : "mt-[4vh] grid max-h-[80vh] w-full max-w-[900px] translate-x-0 translate-y-[120vh] transform-gpu grid-rows-[auto_minmax(0,1fr)_auto] gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-4 shadow-2xl transition-transform duration-[200ms] ease-linear will-change-transform max-[980px]:mt-[-2vh] max-[980px]:h-[92svh] max-[980px]:max-h-[92svh] max-[980px]:max-w-[min(92vw,720px)] max-sm:p-2 max-sm:max-w-none"
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="m-0 font-mono text-[0.6rem] font-bold tracking-[0.16em] text-[var(--fg-muted)]">
              {eyebrow}
            </p>
            <h2 className="m-0 mt-1 text-[1.25rem] tracking-[-0.05em] max-[980px]:text-[1rem]">
              {title}
            </h2>
          </div>
          <button
            className="inline-flex h-[1.75rem] w-[1.75rem] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--fg-muted)] hover:text-[var(--fg)]"
            type="button"
            onClick={onClose}
          >
            <i className="nf nf-fa-close text-[0.72rem]" />
          </button>
        </div>
        <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-3 overflow-auto">
          {loading ? (
            <div className="col-span-full grid min-h-[12rem] place-items-center rounded-[5px] border border-[var(--line)] bg-white/[0.025] px-4 text-center font-mono text-[0.78rem] text-[var(--fg-muted)]">
              <span className="inline-flex items-center gap-2">
                <Spinner /> {loadingLabel}
              </span>
            </div>
          ) : !gridReady && kitties.length > 0 ? (
            <div className="col-span-full grid min-h-[12rem] place-items-center rounded-[5px] border border-[var(--line)] bg-white/[0.025] px-4 text-center font-mono text-[0.78rem] text-[var(--fg-muted)]">
              <span className="inline-flex items-center gap-2">
                <Spinner /> {loadingLabel}
              </span>
            </div>
          ) : loadError ? (
            <div className="col-span-full grid min-h-[12rem] place-items-center rounded-[5px] border border-[var(--line)] bg-white/[0.025] px-4 text-center font-mono text-[0.78rem] text-[var(--fg-muted)]">
              {loadErrorLabel}
            </div>
          ) : kitties.length === 0 ? (
            <div className="col-span-full grid min-h-[12rem] place-items-center rounded-[5px] border border-[var(--line)] bg-white/[0.025] px-4 text-center font-mono text-[0.78rem] text-[var(--fg-muted)]">
              {emptyLabel}
            </div>
          ) : (
            kitties.map((candidate, index) => {
              const selected = selectedIdSet.has(candidate.id);
              const mounted =
                index < progressiveCandidates.visibleCount || selected;
              if (mounted) {
                const disabled =
                  selectionLocked || (!selected && selectedCount >= maxBundleSize);
                return (
                  <KittySelectionCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={selected}
                    disabled={disabled}
                    onToggle={onToggle}
                  />
                );
              }
              return (
                <div
                  className="grid gap-1 rounded-[5px] border border-[var(--line)] bg-white/[0.02] p-1"
                  key={`kitty-selection-placeholder-${candidate.id}`}
                >
                  <div className="grid aspect-square w-full place-items-center rounded-[4px] bg-white/[0.045]">
                    <div className="h-full w-full animate-pulse bg-white/[0.08]" />
                  </div>
                  <div className="h-[0.72rem] w-2/3 animate-pulse rounded bg-white/[0.08]" />
                </div>
              );
            })
          )}
        </div>
        {footer}
      </section>
    </div>,
    document.body,
  );
}
