import { describe, expect, it } from 'vitest'

import { decodeParentKey, encodeParentKey } from './fsrsRepo'

describe('FSRS parent keys', () => {
  it('encodes and decodes root and nested parents', () => {
    expect(encodeParentKey(null)).toBe('__root__')
    expect(decodeParentKey('__root__')).toBeNull()
    expect(encodeParentKey('abc')).toBe('abc')
    expect(decodeParentKey('abc')).toBe('abc')
  })
})
