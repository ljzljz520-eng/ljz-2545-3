# 槐安老街建筑观察站（oldstreet-observer）

老街建筑全栈观察网站：地图与列表按**年代 / 风格 / 保存状态**联动筛选；后台维护
**建筑实体、门牌沿革、修缮事件**；空间库保存**边界与来源**；照片保留**拍摄朝向**。

关键领域规则：

- 门牌变更**不新建建筑**（门牌号是带生效区间的时段别名）；
- 合院拆分**不沿用单一身份**（子女是新实体 + split 谱系，父实体历史保留）；
- 历史照片只保存**候选对应**（pending → 人工确认），绝不自动认定同一立面；
- 开放状态按**入口 × 时间**管理，一处院门/街门关闭不等于整街不可访问；
- 双时间快照（有效时间 asOf + 事务时间 snapshotAt），支持历史检索、时间旅行与
  「分页中途撤回」；列表与地理分块查询共享同一快照函数。

## 运行

```bash
cd oldstreet
node src/seed.cli.js        # （重新）生成种子数据 data/oldstreet.json
npm start                   # http://localhost:8080
# 后台令牌默认 dev-token（环境变量 OLDSTREET_TOKEN 可改）
```

界面要点：顶部可调**快照日期 / 时刻 / 事务快照时间**；左侧键盘可操作列表，
中间为原创 Canvas 街区地图，右侧为证据/沿革/谱系/照片/开放详情；
「双索引一致性比较」按钮并排展示「仅现门牌」与「稳定实体+时段别名」的差异；
「后台维护」提供 renumber、split、陈述、事件、纠偏边界、照片候选、入口时段等表单与审计日志。

## 测试

```bash
npm test        # 29 个用例：领域 11 + 别名回归 2 + API 集成 16（含拆分边界）
npm run repro   # 8 组实体变更复现用例（临时库，不污染数据）
```

覆盖场景：多来源年代/风格矛盾、证据取舍与撤回重算、坐标纠偏保留旧点、
游标分页中对象撤回（旧快照稳定/新快照收缩/详情 404）、缺失照片真实 404 但元数据保留、
照片候选不自动确认、街门与院门分级开放、周一闭园/预约制、历史日期双索引漏检对比、
列表与地图同筛选实体集合一致、管理鉴权与审计。

## 目录

```
src/db.js      JSON 文档库 + 双时间谓词 + 受控词表
src/seed.js    虚构「槐安老街」种子（内含全部矛盾/拆分/纠偏/候选场景）
src/repo.js    查询：实体视图、证据、空间、谱系、照片、开放状态、分页、地理分块、双索引比较
src/admin.js   后台写入（全部审计；软撤回）
src/server.js  零依赖 HTTP：JSON API + 静态资源 + 令牌
public/        前端（index.html / app.js / styles.css / images）
test/          node:test 领域与 API 测试
scripts/repro.js 实体变更复现用例
docs/DESIGN.md 原创设计说明
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/buildings` | 列表（era/style/status/q/asOf/snapshotAt/time/cursor/limit） |
| GET | `/api/buildings/:id` | 详情：证据、空间、事件、照片候选、谱系、入口 |
| GET | `/api/map/chunks` | 地理分块（与列表同快照同筛选） |
| GET | `/api/compare/indexes` | 现门牌 vs 时段别名 双索引比较 |
| GET | `/api/site` | 街门与整街开放状态 |
| GET | `/api/vocab` | 年代/风格/状态受控词表 |
| POST | `/api/admin/renumber` | 门牌变更（封口旧别名+新别名，实体不变） |
| POST | `/api/admin/split` | 合院拆分（新实体+谱系+事件） |
| POST | `/api/admin/claims` `/claims/:id/withdraw` | 多来源陈述 |
| POST | `/api/admin/footprints` | 边界/纠偏（supersedes） |
| POST | `/api/admin/photos` `/photo-candidates` `/photo-candidates/:id/decide` | 照片与候选对应 |
| POST | `/api/admin/entrance-periods` | 入口开放时段 |
| GET | `/api/audits` | 审计日志（需令牌） |
