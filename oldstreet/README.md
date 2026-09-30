# 老街建筑全栈观察图志（青龙老街）

零第三方运行时依赖（Node 内置 `http` + 自研事件溯源 JSONL + 原生 JS/Canvas），
面向“门牌会改、合院会拆、来源会打架、老照片有误差、院门时开时关”的老街建筑观察。

## 运行

```bash
npm start            # http://localhost:8080 （首次已自带种子数据）
npm run seed         # 重置并重建 data/events.jsonl 与 uploads 占位图
npm test             # 11 组领域不变量测试
npm run demo:cases   # 实体变更复现用例（确定性重放，打印 8 个场景）
```

可选环境变量：`PORT`（默认 8080）、`OS_NOW`（固定系统时钟）。

## 它解决了什么

- **身份 ≠ 门牌**：稳定实体 `stableRef` + 门牌时段别名；改号只关旧别名/开新别名，不新建楼。
- **合院拆分**：新建子实体 + `lineage.linked(kind=split)`，母体“单一身份”到拆分日退役，不沿用、不覆盖。
- **双时态快照**：`asOf`（事实录入时刻）× `validAt`（业务有效时刻）；列表/地图/瓦片/详情同源快照、同筛选谓词。
- **证据差异**：多来源 Claim 并存（年代/风格…），Resolution 只表达“当前采纳”，矛盾不抹除，页面并列展示。
- **坐标纠偏 / 空间库**：坐标观测含来源、精度、`correctedFrom`；边界为带来源与时段的多边形。
- **历史照片**：仅登记候选对应（实体+立面+置信度），可一对多，**不自动认定同一立面**；照片缺失显式占位。
- **开放状态**：按“入口 × 时间规则”判定；院门关闭不代表整街不可访问（`gateClosedButStreetAccessible`）。
- **撤回/复现**：append-only 事件 + 墓碑撤回；分页在物化后切片，撤回不产生缺项/重复；一切变更可重放复现。

## 目录

```
core/config.js       常量/时间/年代分桶
core/event-store.js  append-only JSONL、墓碑撤回、按 asOf 求可见事件
core/domain.js       双时态投影、证据/分歧、坐标择优、开放聚合、门牌索引、瓦片查询
core/api.js          后台写命令（即事件）+ 查询路由
core/http-util.js    JSON / multipart / 静态
public/              原创前端（Canvas 自绘地图、键盘列表、详情、后台、设计说明）
scripts/seed.js      含全部教学场景的种子
scripts/reproduce_cases.js  实体变更复现用例
tests/run_all.js     自动化测试
```

## 主要 API

- `GET /api/buildings?asOf&validAt&era&style&preservation&q&renumbered&includeHistory&page&pageSize` 列表分页
- `GET /api/map`（同筛选、不分页） · `GET /api/tiles?west,south,east,north` 地理分块
- `GET /api/lookup?number=&at=` 现门牌索引 vs 稳定实体+时段别名 对照
- `GET /api/buildings/:id?at=` 详情（证据、照片候选、修缮、开放状态）
- `POST /api/admin/<command>` 写命令（createBuilding/renumber/addClaim/resolve/coord/boundary/
  splitCompound/renovation/photo/markPhotoMissing/candidate/entrance/entranceRule/retract …）
- `POST /api/admin/upload` multipart 图片（前端附带拍摄方位角）
- `GET /api/events` 事件流

前端三个页签：**图志（地图+列表）**、**门牌索引对照**、**后台维护**，另有“设计说明”。
列表支持 `↑/↓` 选择、`Enter/→` 打开，列表与地图同筛选且双向联动。

设计依据与建模权衡见 `public/design.md`。
