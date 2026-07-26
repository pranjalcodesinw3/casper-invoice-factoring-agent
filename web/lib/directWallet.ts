/**
 * Direct Casper Wallet connection, used when CSPR.click cannot open anything.
 *
 * WHY THIS EXISTS. The deployed CSPR.click SDK loads in `contentMode: "iframe"`
 * with an EMPTY `_walletPrototypes`, meaning no wallet ever registered with it.
 * Read straight off the live SDK, its `signIn()` is:
 *
 *     signIn() {
 *       this.actionState = SIGN_IN;
 *       if (this.contentMode == POPUP) { window.open(...) }
 *       else this.emit(SIGN_IN, { provider: undefined })   // <- our branch
 *     }
 *
 * So in iframe mode it opens NOTHING. It sets a flag and emits an event that
 * the UI layer is supposed to answer, and that layer never registers a wallet,
 * so the modal iframe stays 0x0 behind an inline `display: none`. `signIn()`
 * returning undefined is correct by design, not a bug to catch. The Connect
 * button simply could not connect, on every project using this SDK.
 *
 * The extension's own API works. This is the documented path, and it resolves.
 *
 * THE TRAP, and it cost boar an hour: `window.CasperWalletProvider` exists on
 * EVERY page on the internet, example.com included, because the extension
 * injects it globally. Its presence proves nothing about whether a wallet is
 * installed, unlocked, or willing to connect. NEVER branch on `typeof`. The
 * only evidence is a RESOLVED promise, which is what `connectDirect` returns.
 */

/** The subset of the injected provider this module uses. */
interface CasperWalletApi {
  requestConnection: () => Promise<boolean>;
  getActivePublicKey: () => Promise<string>;
  disconnectFromSite?: () => Promise<boolean>;
}

type ProviderFactory = (opts?: { timeout?: number }) => CasperWalletApi;

function factory(): ProviderFactory | null {
  const w = window as unknown as { CasperWalletProvider?: ProviderFactory };
  return typeof w.CasperWalletProvider === "function"
    ? w.CasperWalletProvider
    : null;
}

export interface DirectConnection {
  publicKey: string;
}

/**
 * Opens the extension's own approval popup and waits for the user.
 *
 * Resolves only when the user actually approves AND a key comes back. A
 * rejected or dismissed popup throws, so a caller can never mistake "the user
 * said no" for a connection.
 *
 * No timeout is imposed on the approval itself: the user is reading a consent
 * screen listing the accounts they are about to expose, and cancelling their
 * decision out from under them would be worse than waiting.
 */
export async function connectDirect(): Promise<DirectConnection> {
  const make = factory();
  if (!make) {
    throw new Error("No Casper Wallet extension detected in this browser");
  }

  const provider = make();
  const approved = await provider.requestConnection();
  if (!approved) {
    throw new Error("Connection request was declined in the wallet");
  }

  const publicKey = await provider.getActivePublicKey();
  if (!publicKey) {
    // Approved but no active account selected: a real state, and one that
    // would otherwise surface later as an empty signer on a deploy.
    throw new Error(
      "Wallet connected but no account is active. Select an account in the extension."
    );
  }
  return { publicKey };
}

export async function disconnectDirect(): Promise<void> {
  const make = factory();
  if (!make) return;
  try {
    await make().disconnectFromSite?.();
  } catch {
    // Best effort. A failed disconnect must not strand the UI in a connected
    // state it cannot leave, and the local state is cleared by the caller.
  }
}
