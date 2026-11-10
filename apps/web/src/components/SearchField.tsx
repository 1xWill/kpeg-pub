type SearchSortMode = "latest" | "scarcity";

export function SearchField({
  value,
  placeholder,
  sort,
  sortDisabled = false,
  onChange,
  onSortChange,
}: {
  value: string;
  placeholder: string;
  sort?: SearchSortMode;
  sortDisabled?: boolean;
  onChange: (value: string) => void;
  onSortChange?: (sort: SearchSortMode) => void;
}) {
  return (
    <div className="w-full group">
      <div className="flex min-h-[1.75rem] w-full items-center border-y border-[var(--line)] bg-transparent transition-colors hover:border-[var(--accent)] focus-within:border-[var(--accent)]">
        <span
          className="mr-[0.45rem] shrink-0 text-[1.15rem] text-[var(--fg-dim)]"
          aria-hidden="true"
        >
          ›
        </span>
        <input
          className="peer min-w-0 flex-1 appearance-none bg-transparent py-[0.4rem] text-[0.85rem] text-ellipsis text-[var(--fg)] outline-none placeholder:text-[var(--fg-dim)] max-[480px]:text-[0.65rem]"
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {sort && onSortChange ? (
          <div className="inline-flex min-h-[1.5rem] items-stretch gap-[1rem] justify-self-end self-center overflow-hidden px-2 transition-[opacity,transform,padding] duration-300 ease-[var(--ease)] max-sm:max-w-[11rem] max-sm:peer-focus:max-w-0 max-sm:peer-focus:px-0 max-sm:peer-focus:opacity-0 max-sm:peer-focus:translate-x-2 max-sm:peer-focus:pointer-events-none">
            <div className="max-[480px]:border-r-2 border-[var(--line)] max-[480px]:border-[var(--line)] my-1.5" />
            <button
              className={
                sort === "latest" && !sortDisabled
                  ? "cursor-pointer border-0 border-b-2 border-[var(--fg)] bg-transparent px-0 py-1.5 text-[0.85rem] font-bold text-[var(--fg)] max-[480px]:text-[0.65rem]"
                  : sort === "latest" && sortDisabled
                    ? "cursor-not-allowed border-0 border-b-2 border-[var(--line)] bg-transparent px-0 py-1.5 text-[0.85rem] font-bold text-[var(--fg-muted)] opacity-60 max-[480px]:text-[0.65rem]"
                    : sortDisabled
                      ? "cursor-not-allowed border-0 border-b-2 border-transparent bg-transparent px-0 py-1.5 text-[0.85rem] font-bold text-[var(--fg-muted)] opacity-60 max-[480px]:text-[0.65rem]"
                      : "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0 py-1.5 text-[0.85rem] font-bold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] max-[480px]:text-[0.65rem]"
              }
              type="button"
              disabled={sortDisabled}
              onClick={() => onSortChange("latest")}
            >
              Latest
            </button>
            <button
              className={
                sort === "scarcity" && !sortDisabled
                  ? "cursor-pointer border-0 border-b-2 border-[var(--fg)] bg-transparent px-0 text-[0.82rem] font-bold text-[var(--fg)] max-[480px]:text-[0.65rem]"
                  : sort === "scarcity" && sortDisabled
                    ? "cursor-not-allowed border-0 border-b-2 border-[var(--line)] bg-transparent px-0 text-[0.82rem] font-bold text-[var(--fg-muted)] opacity-60 max-[480px]:text-[0.65rem]"
                    : sortDisabled
                      ? "cursor-not-allowed border-0 border-b-2 border-transparent bg-transparent px-0 text-[0.82rem] font-bold text-[var(--fg-muted)] opacity-60 max-[480px]:text-[0.65rem]"
                      : "cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-0 text-[0.82rem] font-bold text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] max-[480px]:text-[0.65rem]"
              }
              type="button"
              disabled={sortDisabled}
              onClick={() => onSortChange("scarcity")}
            >
              Scarcity
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
