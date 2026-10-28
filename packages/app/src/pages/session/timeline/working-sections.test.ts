import { describe, expect, test } from "bun:test"
import { TimelineRow } from "./timeline-row"
import { buildDisplayRows } from "./working-sections"

const part = (messageID: string, partID: string) =>
  new TimelineRow.AssistantPart({
    userMessageID: messageID,
    previousAssistantPart: false,
    group: { key: `part:${messageID}:${partID}`, type: "part", ref: { messageID, partID } },
  })

const isResponse = (groupRefPartID: string) => (row: TimelineRow.TimelineRow) =>
  row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === groupRefPartID

const anyResponse =
  (...predicates: ((row: TimelineRow.TimelineRow) => boolean)[]) =>
  (row: TimelineRow.TimelineRow) =>
    predicates.some((predicate) => predicate(row))

describe("buildDisplayRows", () => {
  test("keeps each turn's final answer visible and folds its thinking into a per-turn group", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "r0"), // final answer of turn u1 -> visible
      new TimelineRow.UserMessage({ userMessageID: "u2", anchor: true }),
      new TimelineRow.Thinking({ userMessageID: "u2", activity: "thinking", startedAt: 0 }),
      part("a2", "r1"), // final answer of turn u2 -> visible
    ]
    const isResp = anyResponse(isResponse("r0"), isResponse("r1"))
    const result = buildDisplayRows({ rows, isResponse: isResp })

    // Each turn's thinking folds into its own section between the prompt and its answer;
    // no answer is swallowed because every turn keeps its final answer visible.
    expect(result.map((item) => item.kind)).toEqual(["row", "section", "row", "row", "section", "row"])
    for (const section of result.filter(
      (item): item is { kind: "section"; key: string; count: number } => item.kind === "section",
    )) {
      expect(section.count).toBe(1) // just the turn's thinking block
    }
  })

  test("a turn keeps its first and latest answers visible; middle answers fold", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "f0"), // first answer of turn u1 -> visible
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "m1"), // middle answer of turn u1 -> folds
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "l2"), // latest answer of turn u1 -> visible
    ]
    const isResp = anyResponse(isResponse("f0"), isResponse("m1"), isResponse("l2"))
    const result = buildDisplayRows({ rows, isResponse: isResp })

    expect(result.map((item) => item.kind)).toEqual(["row", "section", "row", "section", "row"])
    const middle = result[3]
    if (middle.kind === "section") expect(middle.count).toBe(3) // thinking + m1 + thinking folded together
  })

  test("persisted responses stay visible even when they are not a turn's final answer", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "p0"), // persisted middle answer -> stays visible
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "f1"), // final answer -> visible
    ]
    const isResp = anyResponse(isResponse("p0"), isResponse("f1"))
    const result = buildDisplayRows({
      rows,
      isResponse: isResp,
      isPersisted: (row) => row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === "p0",
    })

    expect(result.map((item) => item.kind)).toEqual(["row", "row", "section", "row"])
  })

  test("in a running turn, finished work folds while unfinished work stays inline", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "text-0"), // first answer -> visible
      part("a1", "tool-done"), // finished tool -> folds
      part("a1", "tool-running"), // running tool -> inline
    ]
    const result = buildDisplayRows({
      rows,
      isResponse: isResponse("text-0"),
      isUnfinished: (row) =>
        row._tag === "AssistantPart" && row.group.type === "part" && row.group.ref.partID === "tool-running",
    })
    expect(result.map((item) => item.kind)).toEqual(["row", "row", "section", "row"])
  })

  test("a section keeps its key as it grows while the turn runs", () => {
    const start = [new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }), part("a1", "tool-1")]
    const grown = [...start, part("a1", "tool-2")]
    const sectionKey = (rows: TimelineRow.TimelineRow[]) =>
      buildDisplayRows({ rows, isResponse: () => false }).find((item) => item.kind === "section")?.key
    expect(sectionKey(grown)).toBe(sectionKey(start))
  })

  test("TurnGap spacer rows are ignored (no ghost sections)", () => {
    const base = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "r0"), // final answer of turn u1 -> visible
    ]
    const withGap = [new TimelineRow.TurnGap({ userMessageID: "u2" }), ...base]
    const isResp = anyResponse(isResponse("r0"))
    const withoutGap = buildDisplayRows({ rows: base, isResponse: isResp })
    const withGapResult = buildDisplayRows({ rows: withGap, isResponse: isResp })
    // Inserting a spacer must not add a row, create a phantom section, or shift keys.
    expect(withGapResult.map((item) => item.kind)).toEqual(withoutGap.map((item) => item.kind))
    expect(withGapResult.map((item) => item.key)).toEqual(withoutGap.map((item) => item.key))
  })

  test("section durations sum per assistant message and differ across turns", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "exec-u1"), // tool call of turn u1 -> folds, delta 40
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "r0"), // final answer of turn u1 -> visible
      new TimelineRow.UserMessage({ userMessageID: "u2", anchor: true }),
      part("a2", "exec-u2"), // tool call of turn u2 -> folds, delta 90
      new TimelineRow.Thinking({ userMessageID: "u2", activity: "thinking", startedAt: 0 }),
      part("a2", "r1"), // final answer of turn u2 -> visible
    ]
    const isResp = anyResponse(isResponse("r0"), isResponse("r1"))
    const durationForRow = (row: TimelineRow.TimelineRow) => {
      if (row._tag !== "AssistantPart" || row.group.type !== "part") return undefined
      const durations: Record<string, number> = { "exec-u1": 40, "exec-u2": 90 }
      const duration = durations[row.group.ref.partID]
      return duration === undefined ? undefined : { key: `m:${row.group.ref.partID}`, duration }
    }
    const result = buildDisplayRows({ rows, isResponse: isResp, durationForRow })
    const sections = result.filter(
      (item): item is { kind: "section"; key: string; count: number; durationMs?: number } => item.kind === "section",
    )
    expect(sections.map((section) => section.durationMs)).toEqual([40, 90])
  })

  test("expanding a section reveals its child rows inline while keeping the toggle", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      new TimelineRow.Thinking({ userMessageID: "u1", activity: "thinking", startedAt: 0 }),
      part("a1", "r0"), // final answer of turn u1 -> visible
    ]
    const isResp = anyResponse(isResponse("r0"))
    const collapsed = buildDisplayRows({ rows, isResponse: isResp })
    const header = collapsed[1]
    expect(header.kind).toBe("section")
    if (header.kind === "section") {
      // The summary header stays as the disclosure toggle; expanding only adds its
      // child rows after it rather than replacing the toggle.
      const expanded = buildDisplayRows({ rows, isResponse: isResp, isExpanded: (key) => key === header.key })
      expect(expanded.map((item) => item.kind)).toEqual(["row", "section", "row", "row"])
      expect(expanded[1]!.kind).toBe("section")
    }
  })
})

describe("buildDisplayRows pinned rows", () => {
  test("a pinned wrap-up row stays visible under the final answer instead of folding", () => {
    const rows = [
      new TimelineRow.UserMessage({ userMessageID: "u1", anchor: true }),
      part("a1", "tool0"), // finished work -> folds
      part("a1", "r0"), // final answer -> visible
      part("a1", "wrap"), // wrap_up card -> pinned
    ]
    const isPinned = isResponse("wrap")
    const result = buildDisplayRows({ rows, isResponse: isResponse("r0"), isPinned })
    expect(result.map((item) => item.kind)).toEqual(["row", "section", "row", "row"])
    const last = result.at(-1)
    expect(last?.kind === "row" && last.row._tag === "AssistantPart" && last.row.group.key).toBe("part:a1:wrap")

    const folded = buildDisplayRows({ rows, isResponse: isResponse("r0") })
    expect(folded.map((item) => item.kind)).toEqual(["row", "section", "row", "section"])
  })
})
