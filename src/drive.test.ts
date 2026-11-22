import { describe, expect, it } from 'vitest'
import { folderIdFromLink } from './drive'

describe('folderIdFromLink', () => {
  it('reads a Drive folder link', () => {
    expect(folderIdFromLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp')
    expect(folderIdFromLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp')
    expect(folderIdFromLink('Music')).toBeNull()
  })
})
