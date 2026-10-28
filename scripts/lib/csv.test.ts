import { describe, expect, it } from 'vitest'
import { num, parseCsv } from './csv.ts'

describe('parseCsv', () => {
  it('maps rows to header keys', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('handles quoted commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('name,url\r\n"Smith, J","x?a=1,b=""2"""\r\n')
    expect(rows).toEqual([{ name: 'Smith, J', url: 'x?a=1,b="2"' }])
  })

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsv('a,b,c\n1')).toEqual([{ a: '1', b: '', c: '' }])
  })
})

describe('num', () => {
  it('treats empty and non-numeric cells as 0', () => {
    expect(num('')).toBe(0)
    expect(num('NA')).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num('-2.5')).toBe(-2.5)
  })
})
