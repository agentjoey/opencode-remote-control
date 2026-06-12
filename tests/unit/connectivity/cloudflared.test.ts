import { describe, it, expect } from 'vitest'
import { parseCloudflaredIngress, detectCloudflaredHostname } from '../../../src/connectivity/exposure/cloudflared.js'

const SAMPLE = `tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /Users/x/.cloudflared/00000000.json

ingress:
  - hostname: ssh.example.com
    service: ssh://localhost:22
  - hostname: vnc.example.com
    service: tcp://localhost:5900
  - hostname: ocrc.example.com
    service: http://localhost:17081
  - service: http_status:404
`

describe('parseCloudflaredIngress', () => {
  it('returns the hostname whose service maps to the web port', () => {
    expect(parseCloudflaredIngress(SAMPLE, 17081)).toBe('ocrc.example.com')
  })

  it('returns undefined for a port no ingress entry maps to', () => {
    expect(parseCloudflaredIngress(SAMPLE, 9999)).toBeUndefined()
  })

  it('matches a 127.0.0.1 service and ignores the catch-all', () => {
    const yaml = `ingress:
  - hostname: app.example.com
    service: http://127.0.0.1:17081
  - service: http_status:404
`
    expect(parseCloudflaredIngress(yaml, 17081)).toBe('app.example.com')
  })

  it('handles service-before-hostname order and quoted values', () => {
    const yaml = `ingress:
  - service: "http://localhost:17081"
    hostname: 'quoted.example.com'
`
    expect(parseCloudflaredIngress(yaml, 17081)).toBe('quoted.example.com')
  })

  it('returns undefined when there is no ingress section', () => {
    expect(parseCloudflaredIngress('tunnel: abc\nurl: http://localhost:17081\n', 17081)).toBeUndefined()
  })

  it('does not match a different port that shares a prefix', () => {
    const yaml = `ingress:
  - hostname: other.example.com
    service: http://localhost:170810
  - service: http_status:404
`
    expect(parseCloudflaredIngress(yaml, 17081)).toBeUndefined()
  })
})

describe('detectCloudflaredHostname', () => {
  it('scans *.yml/*.yaml files and returns the first match', () => {
    const host = detectCloudflaredHostname(17081, {
      configDir: '/cfg',
      readDir: () => ['cert.pem', 'logs', 'home-mac.yml'],
      readFile: (p) => (p.endsWith('home-mac.yml') ? SAMPLE : ''),
    })
    expect(host).toBe('ocrc.example.com')
  })

  it('returns undefined when the config dir is unreadable', () => {
    const host = detectCloudflaredHostname(17081, {
      configDir: '/missing',
      readDir: () => { throw new Error('ENOENT') },
      readFile: () => '',
    })
    expect(host).toBeUndefined()
  })

  it('ignores non-yaml files', () => {
    const host = detectCloudflaredHostname(17081, {
      configDir: '/cfg',
      readDir: () => ['cert.pem', 'abcd.json'],
      readFile: () => SAMPLE,
    })
    expect(host).toBeUndefined()
  })
})
