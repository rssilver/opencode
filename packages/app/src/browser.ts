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

export type BrowserPlatform = {
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
