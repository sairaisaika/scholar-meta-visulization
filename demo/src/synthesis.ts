import { buildSynthesisTable, intakeOutcomeRows, type SynthesisContext } from '../../src/synthesis'

const app = document.querySelector<HTMLElement>('#app')!
app.innerHTML = `<h1>多结局证据表与分面合成</h1><p><strong>全部是合成测试数据，不是研究发现或健康建议。</strong>每个结果保留结局、单位、时间、比较和出处；不生成跨结局总分。</p><p><a href="index.html">返回主演示</a></p><label>依赖性情景 <select id="scenario"><option value="independent">5 项独立研究</option><option value="shared">共享受试者群（禁止独立合成）</option></select></label><div id="result"></div>`
const esc = (x: unknown) => String(x ?? '未报告').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (x: number | null | undefined) => typeof x === 'number' ? x.toFixed(2) : '未报告'
const reasons: Record<string, string> = { dependence_unverified: '参与者独立性尚未核对', dependent_observations: '存在共享参与者或同一研究的重复结果', not_poolable_kind: '该类信息保留描述，不作数值合成', unsupported_design: '研究设计不支持此处合并', missing_effect: '缺少效应量', not_applicable: '没有可合并的数值', too_few_studies: '独立研究少于当前算法要求', unreviewed: '尚未审核', no_variance: '缺少方差或区间', mixed_metrics: '度量不同', orientation_unclear: '效应方向未统一', mixed_designs: '研究设计不同' }

function render() {
  const shared = (document.querySelector<HTMLSelectElement>('#scenario')!).value === 'shared'
  const inputs = Array.from({ length: 5 }, (_, i) => intakeOutcomeRows({ id: `synthetic-${i + 1}`, title: `合成报告 ${i + 1}`, study_design: 'rct', tags: ['example'] }, ['function', 'burden'].map((outcome, j) => ({
    id: outcome,
    effect: { metric: 'md', value: (j ? -1 : 2) + i * 0.1, ci_low: (j ? -2 : 1) + i * 0.1, ci_high: (j ? 0 : 3) + i * 0.1, n: 80, higher_is_better: !j },
    context: { study_id: `study-${i}`, dependence_id: shared ? 'same-participants' : `participants-${i}`, outcome: j ? '负担' : '功能', population: '合成成人样本', comparison: 'A 对 B', timepoint: '12 周', unit: j ? '负担量表分' : '功能量表分', analysis: 'unadjusted', kind: 'continuous', locator: `合成表 2 / 行 ${j + 1}`, reviewed: true, independence_verified: true },
  })), { source_label: 'Synthetic fixture', retrieved_at: '2026-10-21T00:00:00Z' }))
  const records = inputs.flatMap(r => r.records)
  const contexts = inputs.flatMap(r => r.contexts)
  const composite = intakeOutcomeRows({ id: 'composite', title: '合成复合指标说明', study_design: 'other' }, [{ id: 'index', context: {
    study_id: 'study-index', dependence_id: 'index-population', outcome: '效益与成本复合指标', population: '合成样本', comparison: '描述', timepoint: '12 周', unit: '自定义指数', analysis: 'declared', kind: 'composite', locator: '合成附录 A', reviewed: true, independence_verified: false,
    components: [{ label: '效益', value: 2, unit: '量表分', weight: 0.5 }, { label: '成本', value: 10, unit: 'USD', weight: 0.5 }], formula: '原文声明；不同单位，未执行加权',
  } }])
  records.push(...composite.records)
  contexts.push(...composite.contexts)
  const table = buildSynthesisTable(records, contexts)
  const c = table.counts
  document.querySelector<HTMLElement>('#result')!.innerHTML = `<p class="counts">${c.reports} 份报告 · ${c.studies} 项研究 · ${c.observations} 条结果 · ${table.facets.length} 个分面 · 跨结局总分：不提供</p>` + table.facets.map(f => {
    const rows = table.rows.filter(r => f.record_ids.includes(r.record.id))
    const context = rows[0].context as SynthesisContext
    const p = f.pooling?.estimate
    return `<section><h2>${esc(context.outcome)}</h2><p>${esc(context.population)} / ${esc(context.comparison)} / ${esc(context.timepoint)} / ${esc(context.unit)}</p><p>${p ? `本分面汇总：${fmt(p.estimate)} [${fmt(p.ci_low)}, ${fmt(p.ci_high)}]；k=${p.k}；REML + HKSJ` : `不合并：${f.blockers.map(b => esc(reasons[b] ?? '需要人工核对')).join('、')}`}</p><div class="scroll"><table><thead><tr><th>报告 / 研究</th><th>估计 [95% CI]</th><th>独立分面轴（同一分面单位）</th><th>来源位置 / 组成</th></tr></thead><tbody>${rows.map(r => {
      const e = r.record.effect
      const glyph = e?.value !== null && e?.value !== undefined && e.ci_low !== null && e.ci_high !== null ? `<svg viewBox="0 0 240 32" role="img" aria-label="${esc(`${fmt(e.value)} [${fmt(e.ci_low)}, ${fmt(e.ci_high)}]`)}"><line x1="120" x2="120" y1="0" y2="32" stroke="#aab"/><line x1="${120 + e.ci_low * 25}" x2="${120 + e.ci_high * 25}" y1="16" y2="16" stroke="#16766b" stroke-width="2"/><circle cx="${120 + e.value * 25}" cy="16" r="4" fill="#16766b"/></svg>` : '不适用（不画假数值）'
      return `<tr><td>${esc(r.context?.report_id)}<br>${esc(r.context?.study_id)}</td><td>${e ? `${fmt(e.value)} [${fmt(e.ci_low)}, ${fmt(e.ci_high)}]` : '未报告效应量'}</td><td>${glyph}</td><td>${esc(r.context?.locator)}${r.context?.components ? `<br>${r.context.components.map(x => `${esc(x.label)} ${esc(x.value)} ${esc(x.unit)} / 权重 ${esc(x.weight)}`).join('<br>')}<br>${esc(r.context.formula)}` : ''}</td></tr>`
    }).join('')}</tbody></table></div><small>图中点线只表示对应结果与区间；分面之间不可共用“总体效应”。0 为本例 MD 的无差异值。行数不等于独立研究数。</small></section>`
  }).join('')
}
document.querySelector('#scenario')!.addEventListener('change', render)
render()
