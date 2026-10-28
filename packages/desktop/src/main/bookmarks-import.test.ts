import { describe, expect, test } from "bun:test"
import { parseChromiumBookmarks } from "./bookmarks-import"

const fixture = {
  roots: {
    bookmark_bar: {
      type: "folder",
      name: "Bookmarks bar",
      children: [
        { type: "url", name: "Example", url: "https://example.com/" },
        {
          type: "folder",
          name: "Dev",
          children: [
            { type: "url", name: "Docs", url: "http://docs.test/a" },
            { type: "folder", name: "Deep", children: [{ type: "url", name: "", url: "https://deep.test/" }] },
            { type: "url", name: "Script", url: "javascript:alert(1)" },
          ],
        },
      ],
    },
    other: {
      type: "folder",
      name: "Other bookmarks",
      children: [{ type: "url", name: "Loose", url: "https://loose.test/" }],
    },
    synced: { type: "folder", name: "Mobile bookmarks", children: [] },
  },
}

describe("parseChromiumBookmarks", () => {
  test("flattens nested folders and prefixes non-bar roots", () => {
    expect(parseChromiumBookmarks(fixture)).toEqual([
      { title: "Example", url: "https://example.com/", folder: "" },
      { title: "Docs", url: "http://docs.test/a", folder: "Dev" },
      { title: "https://deep.test/", url: "https://deep.test/", folder: "Dev / Deep" },
      { title: "Loose", url: "https://loose.test/", folder: "Other bookmarks" },
    ])
  })

  test("tolerates malformed input", () => {
    expect(parseChromiumBookmarks(undefined)).toEqual([])
    expect(parseChromiumBookmarks({})).toEqual([])
    expect(parseChromiumBookmarks({ roots: { bookmark_bar: null, other: { children: [null, 3] } } })).toEqual([])
  })
})
