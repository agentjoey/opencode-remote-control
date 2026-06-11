export interface ExposureInfo {
  /** Best reachable base URL for clients, no trailing slash. */
  url: string
  /** Which provider produced it. */
  provider: 'cf-tunnel' | 'lan' | 'loopback'
}
