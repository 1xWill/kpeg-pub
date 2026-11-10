import { useConnect } from "wagmi";
import {
  ensureWagmiConnectorCompatibility,
  openWalletModal,
  reownEnabled,
} from "../lib/wagmi.js";

export function ConnectWalletInlineText() {
  const { connect, connectors, isPending } = useConnect();
  const primaryConnector = connectors[0];

  const onClick = () => {
    ensureWagmiConnectorCompatibility();
    if (reownEnabled) {
      void openWalletModal("Connect");
      return;
    }
    if (primaryConnector) {
      connect({ connector: primaryConnector });
    }
  };

  return (
    <button
      className="mx-[0.5em] inline cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[var(--fg)] underline underline-offset-[0.2em] decoration-[color-mix(in_srgb,var(--fg)_58%,transparent)] transition-colors md:hover:text-[var(--accent-cool)] md:hover:decoration-[var(--accent-cool)] disabled:cursor-not-allowed disabled:opacity-55 max-sm:text-[0.6rem]"
      type="button"
      disabled={!reownEnabled && (!primaryConnector || isPending)}
      onClick={onClick}
    >
      connect wallet
    </button>
  );
}

export function ConnectWalletTabPrompt() {
  return (
    <>
      <span className="max-sm:text-[0.6rem]">You must</span>
      <ConnectWalletInlineText />
      <span className="max-sm:text-[0.6rem]">to view this tab.</span>
    </>
  );
}
