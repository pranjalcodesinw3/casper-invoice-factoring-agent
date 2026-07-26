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
  sign: (
    deployJson: string,
    signingPublicKeyHex: string
  ) => Promise<{ cancelled?: boolean; signature?: Uint8Array | number[] }>;
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

/** What the extension returns for a signature request. */
export interface DirectSignResult {
  cancelled: boolean;
  /** Raw signature bytes, without the algorithm prefix byte. */
  signature: Uint8Array | null;
}

/**
 * Opens the extension's approval popup for a deploy and returns the signature.
 *
 * The extension signs; it does NOT broadcast. The caller attaches the
 * signature as an approval and PUTs the deploy to a node itself, which is why
 * this returns bytes rather than a deploy hash. Anything that returned a hash
 * from here would be returning a hash for something that never left the
 * browser.
 *
 * `cancelled` is a first-class outcome: the user declining in the popup is not
 * an error, and rendering it as one trains a demo audience to ignore errors.
 */
export async function signDeployDirect(
  deployJson: unknown,
  signingPublicKeyHex: string
): Promise<DirectSignResult> {
  const make = factory();
  if (!make) {
    throw new Error("No Casper Wallet extension detected in this browser");
  }
  const provider = make();
  const result = await provider.sign(
    JSON.stringify(deployJson),
    signingPublicKeyHex
  );
  if (result?.cancelled) {
    return { cancelled: true, signature: null };
  }
  if (!result?.signature) {
    throw new Error("Wallet returned no signature");
  }
  return {
    cancelled: false,
    signature: new Uint8Array(result.signature as ArrayLike<number>),
  };
}
