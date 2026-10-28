# Todo (working session)

Work queue for this session, in order. See [`changelog.md`](./changelog.md) for finished work
and [`bugs.md`](./bugs.md) for known bugs.

## 1. Session summarizer setting (in progress)

- Setting to summarize (compact) a session based on the model's context window size.
- "Auto" mode: measure time-to-first-token (TTFT) at session start, and summarize when TTFT
  degrades too far from that baseline.

## 2. Built-in browser in the desktop app

- Estimated difficulty: medium. Electron can host pages natively (`WebContentsView`); most of the
  work is the panel UI (tabs, address bar, back/forward), isolating it from the app's own
  privileges, and optionally exposing it to the agent as a tool.
- Done when: a browser panel can be opened beside a session in the desktop app, it navigates
  and keeps its own tabs, and it can't reach the app's Node/IPC APIs.

## 3. Vision models viewing images in folders

- Estimated difficulty: low to medium. The `read` tool can already return images as attachments;
  what's missing is finding images in a folder and sending them only to models that accept images.
- Done when: asking a vision-capable model about the images in a folder lets it list and
  look at them, and a text-only model gets a clear message instead of a failure.
