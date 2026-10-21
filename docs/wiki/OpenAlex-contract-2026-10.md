# OpenAlex 合约复核与 CI 回执

2026-10-21；R02。本项的“完成”指当前 REST 适配器范围的官方合约核对、离线保护与有界真实验收，不表示全局额度协调或永久兼容上游未来版本。

上次 `665b890` 的 [check](https://github.com/sairaisaika/scholar-meta-visulization/actions/runs/39057903943)、Pages、release 工作流成功，[live](https://github.com/sairaisaika/scholar-meta-visulization/actions/runs/39057903925) 为 **11 failed / 1 passed**。原日志缺少 429 提前返回原因，不能从这些结果断言密钥、出口或源服务的具体故障；本轮没有把失败隐藏或改成 skip。

| 合约 | 现行来源与处理 | 验收 |
|---|---|---|
| 普通列表页长 | [paging](https://help.openalex.org/api/paging/) 支持 1–100；200 为废弃兼容。兄弟/子节点改为100，页码翻页与 partial 保留 | 离线224节点三页；live100与page2 |
| 分组页长/完整性 | [grouping](https://help.openalex.org/api/grouping/) 仍支持200；group数不是总组数；后续页走cursor，不走page | 布尔/数值key兼容，数值未知哨兵-111归为unknown；最多20页；重复cursor/key、计数漂移、页失败、满页无结束证据均返回null，不能伪造全量。9个离线测试 |
| DOI 批量 | [authentication](https://help.openalex.org/api/authentication/) OR最多100值；现有保守批量50和per_page50合法 | 保留50分批/任一失败null测试；live两个DOI |
| 计费单位 | [pricing](https://help.openalex.org/access/pricing/)、[errors](https://help.openalex.org/api/errors/) 与响应头分开核对 | 本轮列表1 credit对应 cost-usd0.0001；主题实体0、错误400为0。只记录观测，不将换算当永久价格 |
| 预算 | 实例UTC日累计实际有效计费头；每次尝试前重查；坏正文也可能已计费 | 无跨实例/全局硬限额；并发和未知下一次成本可越预算；onCredits回调不是原子预留 |
| 429 | 官方可能表示速率或日额度；明确零remaining停止，长Retry-After交宿主；其余最多重试两次 | 零remaining仅说明上游报告无剩余，不能保证细分所有计费/速率方案；没有解析任意错误正文。日志只记status/有限原因 |
| 密钥/身份 | Bearer头；无key允许基础查询；cursor后续页需要key | 不把key放URL/日志/回执；不自动获取key或买额度 |

有界探针：`node scripts/probe-openalex.mjs <output.json>`，最多6次、无重试，白名单头/形状回执见 [openalex-live-receipt.json](openalex-live-receipt.json)：6/6，通过路径、页长、页2、DOI OR、分组和坏过滤器，合计4 credits。另有先期3次诊断请求2 credits，不混入该回执。没有保存正文、账户身份或meta.notice。

本地完整 live 首次直接运行是11 passed /1 failed，观测到429零remaining导致一项重叠查询未取到。改为测试 harness 串行、250ms间隔并设置最多80次实际请求后，12/12通过，实际32次/30 credits（含成功、零费用与计数查询）。这支持限速能避免本轮自发突发请求的问题，不足以追溯旧CI的全部成因。费用旧注释约25已标为历史，不再作为承诺。

CI现在先跑6次探针并上传脱敏回执，再跑有界完整live；探针失败会让该工作流失败，离线check仍单独报告。GitHub共享匿名出口可能被其他调用用尽；不能通过假成功掩盖。未来上游改变/受控测试失败时，重开R02而不是删除断言。

边界：未强行制造真实429或耗尽账户；HTTP日期/长等待/零remaining/预算行为用受控响应测试。没有验证100个OR值的上限压力、付费账户、多实例额度、所有group_by组合或深游标极端页数；当前只实现既有适配器所需路径。嵌套分组的下级截断若上游不提供结束证据仍需单独评估，不把此合约认定为任意OQL/全数据导出能力。

本轮GitHub真实验证：[live 39550342810](https://github.com/sairaisaika/scholar-meta-visulization/actions/runs/39550342810)成功；探针6/6、4credits，完整12/12、32次/30credits。实现SHA与其余工作流见[结束回执](Development-verification-2026-10.md)。
