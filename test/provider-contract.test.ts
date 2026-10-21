import { providerContract } from './provider-contract'
import { createEvidenceService, createMemoryCache, createMemoryOnsiteSource } from '../src/service'
import { EVIDENCE_DIMENSIONS } from '../src/dimensions'
import type { ExternalEvidenceSource } from '../src/ports'
import type { EvidenceCountsData, EvidenceSourceId } from '../src/types'

const fixture = (id: EvidenceSourceId, overrides: Partial<ExternalEvidenceSource> = {}): ExternalEvidenceSource => ({
  id,
  suggestTopics: async () => [{ topic_id: `${id}:T1`, display_name: 'Sleep', works_count: 0 }],
  nodeBundle: async (level, externalId) => ({ node: { id: `${id}:${externalId}`, source: id, external_id: externalId, level, display_name: 'Sleep', description: null, parent_id: null, works_count: 0 }, ancestors: [], siblings: [] }),
  sampleWorks: async () => [],
  children: async () => ({ children: [] }),
  topicsForDois: async () => [],
  counts: async (level, externalId, scope) => ({ node: { id: `${id}:${externalId}`, level, display_name: 'Sleep' }, scope, total: 0, other_scope_total: 0, series: [], overlap: null,
    availability: Object.fromEntries(Object.keys(EVIDENCE_DIMENSIONS).map(id => [id, []])) as unknown as EvidenceCountsData['availability'] }),
  ...overrides,
})

providerContract('service provider contract / controlled OpenAlex namespace', over => fixture('openalex', over))

it('shared cache keeps distinct provider namespaces isolated', async () => {
  const cache = createMemoryCache()
  const make = (id: EvidenceSourceId) => createEvidenceService({ external: fixture(id), cache, onsite: createMemoryOnsiteSource([]) })
  const a = await make('openalex').getCounts('subfield', '2738')
  const b = await make('crossref').getCounts('subfield', '2738')
  expect(a.ok && a.data.node.id).toBe('openalex:2738')
  expect(b.ok && b.data.node.id).toBe('crossref:2738')
})
