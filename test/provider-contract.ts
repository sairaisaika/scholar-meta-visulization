/** 可复用的服务消费端合约。make 必须提供可受控替换方法的适配器；不是远端认证。 */
import { createEvidenceService, createMemoryCache, createMemoryOnsiteSource } from '../src/service'
import type { ExternalEvidenceSource, EvidenceCache } from '../src/ports'

export function providerContract(name: string, make: (overrides: Partial<ExternalEvidenceSource>) => ExternalEvidenceSource) {
  describe(name, () => {
    const setup = (overrides: Partial<ExternalEvidenceSource>, cache: EvidenceCache = createMemoryCache()) => {
      const source = make(overrides)
      return createEvidenceService({ external: source, cache, now: () => new Date('2026-10-21T00:00:00Z'), log: jest.fn(), onsite: createMemoryOnsiteSource([
        { id: 'a', title: 'A', tags: ['sleep'], references: ['10.1000/a'] },
      ]) })
    }
    it.each(['null', 'throw', 'empty'] as const)('suggestTopics %s distinguishes failure from successful absence and caching', async mode => {
      const suggestTopics = jest.fn(async () => { if (mode === 'throw') throw new Error('provider'); return mode === 'null' ? null : [] })
      const service = setup({ suggestTopics })
      const a = await service.getTagMap('sleep')
      const b = await service.getTagMap('sleep')
      if (mode === 'throw') expect(a).toEqual({ ok: false, error: 'unavailable' })
      else expect(a.ok && a.data.external_match).toBe(mode === 'empty' ? 'no_match' : 'unavailable')
      expect(b).toEqual(a)
      expect(suggestTopics).toHaveBeenCalledTimes(mode === 'empty' ? 1 : 2)
    })
    it.each(['nodeBundle', 'sampleWorks', 'counts', 'children', 'topicsForDois'] as const)('%s thrown rejection is handled and never cached', async method => {
      const broken = jest.fn(async () => { throw new Error('provider') })
      const service = setup({ [method]: broken })
      const read = () => method === 'counts' ? service.getCounts('subfield', '2738')
        : method === 'topicsForDois' ? service.suggestBindings('sleep') : service.getNodeMap('subfield', '2738')
      expect(await read()).toEqual({ ok: false, error: 'unavailable' })
      expect(await read()).toEqual({ ok: false, error: 'unavailable' })
      expect(broken).toHaveBeenCalledTimes(2)
    })
    it.each(['children', 'counts', 'topicsForDois'] as const)('optional %s can be omitted', async method => {
      const service = setup({ [method]: undefined })
      if (method === 'counts') expect(await service.getCounts('subfield', '2738')).toEqual({ ok: false, error: 'not_configured' })
      else if (method === 'children') {
        const r = await service.getNodeMap('subfield', '2738')
        expect(r.ok).toBe(true)
        expect(r.ok && 'children' in r.data).toBe(false)
      } else {
        const r = await service.suggestBindings('sleep')
        expect(r.ok && r.data.every(x => x.cited === null)).toBe(true)
      }
    })
    it('null bundle is unavailable and is retried', async () => {
      const nodeBundle = jest.fn(async () => null)
      const service = setup({ nodeBundle })
      expect(await service.getNodeMap('subfield', '2738')).toEqual({ ok: false, error: 'unavailable' })
      await service.getNodeMap('subfield', '2738')
      expect(nodeBundle).toHaveBeenCalledTimes(2)
    })
    it('successful zero counts and empty DOI results are cached, not treated as failures', async () => {
      const original = make({})
      const counts = jest.fn(original.counts!)
      const topicsForDois = jest.fn(async () => [])
      const service = setup({ counts, topicsForDois })
      const [a, b] = await Promise.all([service.getCounts('subfield', '2738'), service.getCounts('subfield', '2738')])
      expect(a.ok && a.data.total).toBe(0)
      expect(b).toEqual(a)
      await service.getCounts('subfield', '2738')
      await service.suggestBindings('sleep')
      await service.suggestBindings('sleep')
      expect(counts).toHaveBeenCalledTimes(1)
      expect(topicsForDois).toHaveBeenCalledTimes(1)
    })
    it.each(['null', 'empty', 'partial'] as const)('children %s has explicit data and cache semantics', async mode => {
      const children = jest.fn(async () => mode === 'null' ? null : { children: [], ...(mode === 'partial' ? { partial: true } : {}) })
      const service = setup({ children })
      const a = await service.getNodeMap('subfield', '2738')
      await service.getNodeMap('subfield', '2738')
      expect(a.ok && a.data.children).toEqual(mode === 'null' ? null : [])
      expect(a.ok && !!a.data.children_partial).toBe(mode === 'partial')
      expect(children).toHaveBeenCalledTimes(mode === 'empty' ? 1 : 2)
    })
    it.each(['counts', 'topicsForDois'] as const)('%s null is retried; cache get/set failure does not turn results into absence', async method => {
      const unavailable = jest.fn(async () => null)
      const service = setup({ [method]: unavailable })
      const read = () => method === 'counts' ? service.getCounts('subfield', '2738') : service.suggestBindings('sleep')
      const a = await read()
      await read()
      expect(a.ok).toBe(method === 'topicsForDois')
      expect(unavailable).toHaveBeenCalledTimes(2)
      const cache: EvidenceCache = { get: async () => { throw new Error('cache') }, set: async () => { throw new Error('cache') } }
      const working = setup({}, cache)
      expect((await (method === 'counts' ? working.getCounts('subfield', '2738') : working.suggestBindings('sleep'))).ok).toBe(true)
    })
    it('sampleWorks [] is successful empty, null is unavailable; partial bundle is not cached', async () => {
      const sampleWorks = jest.fn(async () => [] )
      const source = make({})
      const nodeBundle = jest.fn(async () => ({ ...(await source.nodeBundle('subfield', '2738'))!, partial: true }))
      const service = setup({ sampleWorks, nodeBundle })
      const r = await service.getNodeMap('subfield', '2738')
      await service.getNodeMap('subfield', '2738')
      expect(r.ok && r.data.external_match).toBe('matched')
      expect(sampleWorks).toHaveBeenCalledTimes(1)
      expect(nodeBundle).toHaveBeenCalledTimes(2)
      const failed = await setup({ sampleWorks: async () => null }).getNodeMap('subfield', '2738')
      expect(failed.ok && failed.data.external_match).toBe('unavailable')
    })
  })
}
