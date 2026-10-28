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

export type BrowserPlatform = {
  getState(): Promise<BrowserState>
  /** Subscribe to tab state changes; returns an unsubscribe function. */
  subscribe(cb: (state: BrowserState) => void): () => void
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
