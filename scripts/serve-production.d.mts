import type { Server } from 'node:http'

export interface HeaderRule {
  pattern: string
  expression: RegExp
  headers: Record<string, string>
}

export function parseHeaders(source: string): HeaderRule[]
export function headersForPath(
  pathname: string,
  rules: readonly HeaderRule[],
): Record<string, string>
export function createProductionServer(options?: {
  root?: string
  headersSource?: string
}): Promise<Server>
