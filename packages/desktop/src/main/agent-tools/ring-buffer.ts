/** Keeps the most recent lines of a process's output, joining chunks that split mid-line. */
export class LineBuffer {
  private lines: string[] = []
  private partial = ""

  constructor(private readonly max = 500) {}

  push(chunk: string) {
    const parts = (this.partial + chunk).split(/\r?\n/)
    this.partial = parts.pop() ?? ""
    this.lines.push(...parts)
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max)
  }

  tail(count: number) {
    const all = this.partial ? [...this.lines, this.partial] : this.lines
    return count > 0 ? all.slice(-count) : []
  }
}
