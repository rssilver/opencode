export type BrowserTabState = {
  id: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type BrowserState = {
  tabs: BrowserTabState[]
  active?: string
}

/** Rectangle in CSS pixels, relative to the app window's content area. */
export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserBookmark = {
  title: string
  url: string
  /** Folder path joined with " / "; empty for top-level bookmarks. */
  folder: string
}

/** A Chrome or Edge profile whose bookmarks can be imported. */
export type BrowserImportProfile = {
  id: string
  browser: "chrome" | "edge"
  name: string
}

/** A saved login as the renderer sees it: the password stays in the main process. */
export type BrowserPasswordSummary = { origin: string; username: string; created: number; updated: number }

export type BrowserPasswordState = {
  /** False when the OS has no encrypted storage; saving is then disabled. */
  available: boolean
  entries: BrowserPasswordSummary[]
  /** Origins the user chose "Never" for. */
  never: string[]
  /** Origins where the agent may always sign in. */
  grants: string[]
}

/** Shown after a login submit in the panel: "Save password for <host>?". */
export type BrowserPasswordOffer = { id: string; tabId: string; host: string; username: string; kind: "save" | "update" }

export type BrowserSignInAnswer = "always" | "once" | "no"

/** The agent wants to sign in with a saved password: "Allow the agent to sign in to <host>?". */
export type BrowserSignInRequest = { id: string; host: string }

export type BrowserPlatform = {
  passwords: {
    state(): Promise<BrowserPasswordState>
    /** Adds or edits a login; `previous` is the username being renamed. */
    save(input: { origin: string; username: string; password: string; previous?: string }): Promise<BrowserPasswordState>
    remove(origin: string, username: string): Promise<BrowserPasswordState>
    /** Returns one password, only when the user explicitly asks to reveal it. */
    reveal(origin: string, username: string): Promise<string | undefined>
    revokeGrant(origin: string): Promise<BrowserPasswordState>
    allowSaving(origin: string): Promise<BrowserPasswordState>
    /** Imports Chrome's password CSV export; resolves to the new state and how many logins were read. */
    importCsv(text: string): Promise<{ state: BrowserPasswordState; count: number }>
    onOffer(cb: (offer: BrowserPasswordOffer) => void): () => void
    respondOffer(id: string, action: "save" | "never" | "dismiss"): Promise<BrowserPasswordState>
    onSignInRequest(cb: (request: BrowserSignInRequest) => void): () => void
    respondSignIn(id: string, answer: BrowserSignInAnswer): Promise<void>
  }
  bookmarks: {
    list(): Promise<BrowserBookmark[]>
    /** Adds (or merges, deduplicating by URL) bookmarks; resolves to the full saved list. */
    add(items: BrowserBookmark[]): Promise<BrowserBookmark[]>
    remove(url: string): Promise<BrowserBookmark[]>
    listImportProfiles(): Promise<BrowserImportProfile[]>
    /** Imports a profile's bookmarks (never cookies or passwords); resolves to the full saved list. */
    importProfile(id: string): Promise<BrowserBookmark[]>
  }
  getState(): Promise<BrowserState>
  /** Subscribe to tab state changes; returns an unsubscribe function. */
  subscribe(cb: (state: BrowserState) => void): () => void
  /** Subscribe to requests (from the agent) to show the browser panel; returns an unsubscribe function. */
  onOpenRequest(cb: () => void): () => void
  createTab(url?: string): Promise<string | undefined>
  closeTab(id: string): Promise<void>
  selectTab(id: string): Promise<void>
  navigate(id: string, input: string): Promise<void>
  back(id: string): Promise<void>
  forward(id: string): Promise<void>
  reload(id: string): Promise<void>
  stop(id: string): Promise<void>
  setBounds(bounds: BrowserBounds): Promise<void>
  setVisible(visible: boolean): Promise<void>
}
