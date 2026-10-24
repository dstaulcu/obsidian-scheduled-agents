import * as fs from 'fs'
import * as path from 'path'

/** Minimal file access the runner needs, rooted at the vault. Paths are vault-relative posix. */
export interface VaultIO {
  exists(rel: string): Promise<boolean>
  read(rel: string): Promise<string>
  /** Write via temp file then rename, so readers never see a partial page. */
  writeAtomic(rel: string, content: string): Promise<void>
  append(rel: string, content: string): Promise<void>
}

export class FsVaultIO implements VaultIO {
  constructor(private readonly root: string) {}

  private abs(rel: string): string {
    const full = path.resolve(this.root, rel)
    const rootWithSep = path.resolve(this.root) + path.sep
    if (!full.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
      throw new Error(`Path escapes the vault: ${rel}`)
    }
    return full
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.promises.access(this.abs(rel))
      return true
    } catch {
      return false
    }
  }

  read(rel: string): Promise<string> {
    return fs.promises.readFile(this.abs(rel), 'utf8')
  }

  async writeAtomic(rel: string, content: string): Promise<void> {
    const full = this.abs(rel)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    const tmp = `${full}.brainagent.tmp`
    await fs.promises.writeFile(tmp, content, 'utf8')
    await fs.promises.rename(tmp, full)
  }

  async append(rel: string, content: string): Promise<void> {
    const full = this.abs(rel)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    await fs.promises.appendFile(full, content, 'utf8')
  }
}
