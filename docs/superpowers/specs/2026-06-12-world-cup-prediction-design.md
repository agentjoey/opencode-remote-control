# 世界杯比分预测 API — 产品设计文档

> 版本: v1.0 | 日期: 2026-06-12 | 状态: 设计完成

## 1. 产品概述

### 1.1 定位

基于深度学习的足球比分预测引擎，以 RESTful API 形式对外提供服务。

### 1.2 核心能力

- 输入两支国家队名称，返回比分预测及概率分布
- 支持单场预测和批量预测
- 融合传统足球数据与六爻卦象双轨分析

---

## 2. API 接口设计

### 2.1 单场预测

```
POST /api/v1/predict
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

```json
{
  "home_team": "Argentina",
  "away_team": "France",
  "match_time": "2026-07-19T15:00:00Z",
  "home_direction": "北",
  "away_direction": "南",
  "match_type": "final",
  "neutral_venue": true,
  "override": {
    "home_elo": 1920,
    "away_elo": 1885,
    "home_form": "WWWDW",
    "away_form": "WLWDD"
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| home_team | string | 是 | 主队名称（中文或英文） |
| away_team | string | 是 | 客队名称 |
| match_time | datetime | 是 | 比赛时间（UTC），用于六爻起卦 |
| home_direction | string | 否 | 主队方位（用于六爻），默认"北" |
| away_direction | string | 否 | 客队方位，默认"南" |
| match_type | string | 否 | 比赛阶段：group/round16/quarter/semi/final |
| neutral_venue | bool | 否 | 是否中立场，默认 true |
| override | object | 否 | 调用方覆盖特定特征值 |

**响应体：**

```json
{
  "prediction": {
    "most_likely_score": "2:1",
    "score_probabilities": {
      "1:0": 0.08, "1:1": 0.11, "2:1": 0.14,
      "2:0": 0.09, "0:0": 0.05, "2:2": 0.07,
      "3:1": 0.06, "0:1": 0.04, "1:2": 0.05,
      "3:0": 0.04, "0:2": 0.03, "3:2": 0.03,
      "others": 0.21
    },
    "result_probability": {
      "home_win": 0.45,
      "draw": 0.25,
      "away_win": 0.30
    },
    "expected_goals": {
      "home": 1.82,
      "away": 1.15,
      "total": 2.97
    },
    "total_goals_range": {
      "0-1": 0.18,
      "2-3": 0.42,
      "4+": 0.40
    },
    "confidence": 0.73
  },
  "hexagram_info": {
    "original_hexagram": "火风鼎",
    "changing_hexagram": "火水未济",
    "mutual_hexagram": "泽天夬",
    "ti_yong": "用生体",
    "verdict": "吉"
  },
  "model_metadata": {
    "version": "3.2.1",
    "data_freshness": "2026-06-11T18:00:00Z"
  }
}
```

### 2.2 批量预测

```
POST /api/v1/predict/batch
Authorization: Bearer <token>
```

```json
{
  "matches": [
    {"home_team": "Argentina", "away_team": "France", "match_time": "..."},
    {"home_team": "Brazil", "away_team": "England", "match_time": "..."}
  ]
}
```

返回 `{ "predictions": [...] }` 数组。

### 2.3 鉴权与限流

| 等级 | 限流 | 说明 |
|------|------|------|
| Free | 10 req/min | API Key 即可 |
| Pro | 1000 req/min | Bearer Token |
| Enterprise | 自定义 | 独立部署 |

### 2.4 缓存策略

- 同一对阵（主客队相同）30 分钟内返回缓存结果
- Redis TTL = 1800s
- `data_freshness` 字段标记数据时效

---

## 3. 特征体系

### 3.1 七维特征权重

| # | 特征类别 | 具体特征 | 权重 | 数据来源 |
|---|---------|---------|------|---------|
| 1 | 近期状态 | 近10场战绩(W/D/L)、进球/失球趋势、连胜/连败 | **0.20** | MiniMax MCP (ESPN/SofaScore) |
| 2 | 球队实力 | FIFA排名、ELO评分、球队总身价 | **0.18** | MiniMax MCP (FIFA/Transfermarkt) |
| 3 | 六爻卦象 | 本卦/变卦/互卦/体用生克/六亲持世/日辰月建 | **0.18** | 本地起卦引擎 |
| 4 | 历史交锋 | 交锋记录(W/D/L)、进球数、比赛级别 | **0.12** | 内置历史DB |
| 5 | 攻防效率 | 场均进球、场均失球、射门转化率、控球率 | **0.12** | MiniMax MCP (WhoScored) |
| 6 | 球员维度 | 核心球员评分、伤病、停赛 | **0.12** | MiniMax MCP (Transfermarkt/新闻) |
| 7 | 赛事因素 | 比赛阶段、中立场、休息天数 | **0.08** | 赛事日历 |

### 3.2 六爻卦象编码方案

**输入：** 比赛时间 + 主客队方位 → 自动起卦

**编码维度：**

| 编码项 | 维度 | 编码方式 |
|--------|------|---------|
| 本卦 | 384 | 64卦 × 6爻 one-hot embedding |
| 变卦 | 384 | 同上 |
| 互卦 | 384 | 同上 |
| 体用生克 | 5 | 生/克/比和/体生用/用生体 → 5维 |
| 六亲持世 | 6 | 父母/兄弟/妻财/官鬼/子孙/无 → 6维 |
| 日辰月建 | 12 | 地支 × 五行组合 → 12维 |

**融合方式：** 卦象 embedding (1175维) → FC → 64维 → 与球队特征 concat → 输入主模型

---

## 4. 模型架构

### 4.1 整体结构

```
输入层
├── 主队特征 (球队实力+状态+交锋+攻防+球员+赛事)
├── 客队特征 (同上)
└── 六爻卦象 (1175维 embedding)

编码器
├── 主队 Bi-LSTM 编码 → 256维
└── 客队 Bi-LSTM 编码 → 256维
    ↓
交叉注意力层 (Cross-Attention)
    两队特征交互学习 → 512维
    ↓
┌─────────────────┬─────────────────┐
│ 比分预测头       │ 结果分类头       │
│ 全连接 → Softmax │ 全连接 → Softmax │
│ P(h_goals,a_goals)│ P(胜/平/负)      │
└─────────────────┴─────────────────┘
```

### 4.2 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 序列编码器 | Bi-LSTM | 处理球队近期战绩的时间序列 |
| 交互机制 | Cross-Attention | 让两队特征互相影响，模拟真实对抗 |
| 输出方式 | 概率分布 | 足球随机性大，概率比单点预测更有价值 |
| 损失函数 | 交叉熵（比分）+ 交叉熵（胜平负） | 多任务联合训练 |

### 4.3 训练策略

- **训练数据：** 近3届世界杯全部比赛(192场) + 洲际杯赛+预选赛(5000+场)
- **迁移学习：** 先在俱乐部联赛大规模数据预训练，再微调到国家队
- **近期加权：** 越近的比赛采样权重越高
- **数据增强：** 对主客场互换、随机扰动特征做增强
- **评估指标：** 比分命中率、胜平负准确率、对数损失(Log Loss)

---

## 5. 数据采集管线

### 5.1 外部数据采集：MiniMax MCP

| 数据需求 | MCP 工具 | 采集频率 | 示例 Prompt |
|---------|---------|---------|------------|
| FIFA 排名 | WebFetch | 每日 | Fetch FIFA rankings page, extract top 50 teams with scores |
| 近期战绩 | WebSearch | 每6h | "[Team] last 10 match results scores 2026" |
| 球员伤病 | WebSearch | 每日 | "[Team] injuries suspensions World Cup 2026" |
| 攻防数据 | WebFetch | 每日 | Fetch WhoScored team stats, extract possession/shots/conversion |
| 球员身价 | WebFetch | 每周 | Fetch Transfermarkt squad page, extract market values |
| 六爻起卦 | 本地引擎 | 每次预测 | 比赛时间 + 方位 → 计算卦象（不占用 MCP） |

### 5.2 调度器

- **调度器：** APScheduler（集成在 FastAPI 进程中）
- **任务定义：** 每个数据源一个独立 Job，cron 表达式配置
- **降级策略：** MCP 调用失败 → 使用上一次成功数据 → 标记 `data_freshness` 为 warn

### 5.3 存储分层

| 层级 | 存储 | 数据 | TTL |
|------|------|------|-----|
| 热数据 | Redis | 特征缓存、预测结果缓存 | 6h / 30min |
| 温数据 | PostgreSQL | 球队排名、战绩历史、球员信息 | 永久 + 增量 |
| 冷数据 | PostgreSQL | 历史交锋、世界杯历史数据 | 永久 |

### 5.4 降级策略

```
MCP 调用
  ├── 成功 → 写入 PG + 更新 Redis → data_freshness = "fresh"
  └── 失败 → 读取 Redis
       ├── 命中 → 使用缓存 → data_freshness = "cached"
       └── 未命中 → 读取 PG
            ├── 命中 → data_freshness = "stale"
            └── 未命中 → 返回错误
```

---

## 6. 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Web 框架 | FastAPI (Python 3.11) | 异步高性能，类型安全 |
| 深度学习 | PyTorch | 模型训练 + 推理 |
| 数据库 | PostgreSQL 16 + PostGIS | 结构化存储，支持地理查询 |
| 缓存 | Redis 7 | 特征缓存 + 限流 + 卦象缓存 |
| 反向代理 | Nginx | SSL 终止，限流，负载均衡 |
| 调度器 | APScheduler | 定时触发 MCP 数据采集 |
| 容器化 | Docker Compose | 统一部署，环境隔离 |
| 监控 | Prometheus + Grafana | 指标采集 + 可视化看板 |
| 外部数据 | MiniMax MCP | WebSearch + WebFetch |
| 六爻引擎 | 本地 Python 模块 | 周易起卦算法 |

---

## 7. 部署架构

### 7.1 Docker Compose 拓扑

```
                    Internet
                       │
                       ▼
              ┌────────────────┐
              │  Nginx (:80/443)│
              │  SSL + 限流     │
              └───────┬────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ FastAPI  │ │ FastAPI  │ │Scheduler │
   │ Worker 1 │ │ Worker 2 │ │(定时采集)│
   │ :8000    │ │ :8000    │ │          │
   └────┬─────┘ └────┬─────┘ └────┬─────┘
        │            │            │
        └────────────┼────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │PostgreSQL│ │  Redis   │ │  Models  │
   │  :5432   │ │  :6379   │ │ (volume) │
   └──────────┘ └──────────┘ └──────────┘
```

### 7.2 docker-compose.yml 核心配置

```yaml
services:
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on: [fastapi]

  fastapi:
    build: .
    environment:
      - DB_URL=postgresql://user:pass@postgres:5432/worldcup
      - REDIS_URL=redis://redis:6379
      - MCP_API_KEY=${MCP_API_KEY}
    volumes:
      - ./models:/app/models
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
    deploy:
      replicas: 2

  scheduler:
    build: .
    environment:
      - DB_URL=postgresql://user:pass@postgres:5432/worldcup
      - REDIS_URL=redis://redis:6379
    command: python -m app.scheduler

  postgres:
    image: postgis/postgis:16
    environment:
      POSTGRES_DB: worldcup
      POSTGRES_USER: user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - ./pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "user"]
      interval: 10s

  redis:
    image: redis:7-alpine
    volumes:
      - ./redisdata:/data
```

### 7.3 硬件要求

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU | 4 核 | 8 核 |
| RAM | 8 GB | 16 GB |
| 磁盘 | 50 GB | 100 GB SSD |
| GPU | 无（CPU 推理） | NVIDIA T4+（GPU 推理） |
| 月成本 | ~$40 | ~$80 |

---

## 8. 非功能需求

| 指标 | 目标 | 说明 |
|------|------|------|
| 推理延迟 | < 500ms | 单次预测（含六爻起卦） |
| 并发 | 50 QPS (CPU) | 4 Workers，无 GPU |
| 可用性 | 99.9% | Docker Compose 单机 |
| 冷启动 | 无需 | 模型常驻内存 |
| 缓存命中 | 30min 内同对阵 | Redis TTL=1800s |
| 数据新鲜度 | < 6h | MCP 定时采集 |

---

## 9. 项目结构

```
worldcup-predict-api/
├── app/
│   ├── main.py              # FastAPI 应用入口
│   ├── api/
│   │   └── routes.py        # /predict, /predict/batch
│   ├── models/
│   │   ├── encoder.py       # Bi-LSTM 编码器
│   │   ├── attention.py     # Cross-Attention 层
│   │   ├── heads.py         # 比分头 + 胜平负头
│   │   └── inference.py     # 推理管线（含六爻融合）
│   ├── hexagram/
│   │   └── engine.py        # 六爻起卦引擎
│   ├── data/
│   │   ├── mcp_client.py    # MiniMax MCP 封装
│   │   ├── pipeline.py      # 数据清洗 + 特征工程
│   │   └── schemas.py       # Pydantic 数据模型
│   ├── db/
│   │   ├── models.py        # SQLAlchemy ORM
│   │   └── repository.py    # 数据访问层
│   ├── scheduler.py         # APScheduler 定时任务
│   └── config.py            # 配置管理
├── models/                  # 模型权重文件
│   └── v3.2.1/
│       ├── encoder.pkl
│       └── classifier.pt
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── requirements.txt
└── tests/
    ├── test_api.py
    ├── test_hexagram.py
    └── test_inference.py
```

---

## 10. 风险与待定项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| MiniMax MCP 数据质量不稳定 | 特征偏差 → 预测不准 | 降级到缓存数据 + 后续可切换 Scrapy |
| 世界杯样本量少（192场） | 模型过拟合 | 迁移学习 + 数据增强 + 近期加权 |
| 足球比赛随机性 | 单点比分命中率低 | 输出概率分布而非单点预测 |
| 六爻特征有效性待验证 | 可能为噪声 | 权重可调，支持特征消融实验 |
| MCP 调用频率限制 | 数据更新延迟 | 不同数据源错峰采集 |

---

## 11. 后续迭代方向

- [ ] 实时模拟（比赛中动态更新胜率）
- [ ] 模型 A/B Test 框架（对比不同权重配置）
- [ ] Web Dashboard 可视化预测结果
- [ ] 小程序端接入
- [ ] 社区预测排行 / 用户预测准确率追踪
- [ ] 赔率数据源接入（作为参考对比）
