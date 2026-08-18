# Scalability Report — Part 12
## Intelligent Emergency Response & Resource Optimization Platform

---

## 1. Architecture Diagram

```
                         CLIENTS
                           │
                           ▼
                    LOAD BALANCER
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
        API-1            API-2            API-3
    (stateless)      (stateless)      (stateless)
          │                │                │
          └────────┬────────────────┬───────┘
                   │                │
                   ▼                ▼
             PostgreSQL           Redis
          (source of truth)   (cache + queue)
                   │                │
                   │                ▼
                   │            BullMQ Queue
                   │                │
                   │     ┌──────────┼──────────┐
                   │     ▼          ▼          ▼
                   │   W-1        W-2        W-3
                   │  (worker)  (worker)  (worker)
                   │
                   ▼
               Outbox Poller
           (writes PENDING → PUBLISHED)
```

**Critical truth:**
- PostgreSQL is authoritative for ALL business state
- Redis holds: cache (TTL-bound), BullMQ queue state, distributed rate-limit counters
- Workers process events asynchronously — independently scalable
- API instances are fully stateless — any instance handles any request

---

## 2. Scalability Strategy

### Stateless API
- No in-process session state
- JWT authentication (self-contained tokens — no server-side session)
- Rate limiting backed by Redis (shared across instances)
- Each API instance is identical — horizontally scalable behind any load balancer

### Horizontal Scaling
Run multiple API instances pointing to the same PostgreSQL + Redis:
```bash
PORT=5000 node dist/index.js   # Instance 1
PORT=5001 node dist/index.js   # Instance 2
PORT=5002 node dist/index.js   # Instance 3
```
Put behind nginx or a cloud load balancer (round-robin or least-connections).

### Worker Scaling
Workers are independently scalable from the API:
```bash
WORKER_CONCURRENCY=5 node dist/workers/worker.js   # Worker 1
WORKER_CONCURRENCY=5 node dist/workers/worker.js   # Worker 2
```
BullMQ coordinates job distribution — multiple workers pull from the same queue without double-processing.

---

## 3. Caching Strategy

### Pattern
Cache-aside (lazy loading):
1. Incoming request checks Redis
2. **HIT** → return cached value (no DB query)
3. **MISS** → query PostgreSQL → store in Redis with TTL → return result

### Cached Endpoints
| Cache Key                    | TTL                        | Invalidated On                    |
|------------------------------|----------------------------|------------------------------------|
| `resource:list`              | `CACHE_DEFAULT_TTL_SECONDS`| Any resource create/update         |
| `resource:{id}`              | `CACHE_DEFAULT_TTL_SECONDS`| Resource update                    |
| `hospital:list`              | `CACHE_DEFAULT_TTL_SECONDS`| Any hospital create/update         |
| `hospital:{id}`              | `CACHE_DEFAULT_TTL_SECONDS`| Hospital update                    |
| `hospital:{id}:availability` | TTL / 2                    | Hospital update                    |

### NOT Cached (by design)
- Assignment state — too volatile, correctness-critical
- Incident state — changes frequently during active emergency response
- Decision logs — immutable but accessed rarely; no cache benefit

### Invalidation
Explicit key deletion on mutation. Conservative: always delete on any update,
even if the specific field didn't change. Prevents stale reads at cost of extra
DB queries on first access post-invalidation (acceptable tradeoff).

### Fail-Open
If Redis is unavailable, ALL cache operations return null/void silently.
The API falls back to direct PostgreSQL queries — slower but correct.

---

## 4. Database Optimization Strategy

### Indexes Added (Part 12)

| Table          | Index                                   | Reason                                            |
|----------------|----------------------------------------|---------------------------------------------------|
| `incidents`    | `status`                               | Most queries filter by status                     |
| `incidents`    | `priorityScore DESC`                   | Coordinator dashboard sorts by priority           |
| `incidents`    | `severity`                             | Filter by severity level                          |
| `incidents`    | `createdAt`                            | Default ordering + time-range queries             |
| `resources`    | `status`                               | Allocation engine filters AVAILABLE resources     |
| `resources`    | `type`                                 | Allocation engine matches by type                 |
| `resources`    | `(status, type)`                       | Composite for combined allocation filter          |
| `hospitals`    | `status`                               | Filter OPERATIONAL hospitals                      |
| `outbox_events`| `(status, createdAt)`                 | Publisher polls PENDING ORDER BY createdAt        |
| `assignments`  | `resourceId`, `incidentId`, `status`   | Already existed from Part 7                       |

### Pre-existing Indexes
- `Assignment`: `resourceId`, `incidentId`, `status` (from Part 7 partial unique indexes)
- `DecisionLog`: `incidentId`, `decisionType`
- `ReoptimizationLog`: `incidentId`, `assignmentId`, `trigger`
- `OutboxEvent`: `status`, `createdAt` (single-column, existed)
- `ProcessedEvent`: `eventId`
- `IdempotencyKey`: `key`, `expiresAt`

### Pagination
All list endpoints now support `?page=N&limit=M` (max 100).
This prevents unbounded `SELECT *` from returning millions of rows.

### N+1 Prevention
- `getIncidents()` uses a single `findMany` with `include: { createdBy: { select: ... } }` — no N+1
- `getAssignments()` uses `include: { incident: { select: ... }, resource: { select: ... } }` — no N+1
- `recommendResource()` fetches all resources in one query, then runs pure in-memory scoring

### Connection Pool
- Single shared `PrismaClient` singleton (global.__prisma in dev)
- Prisma's default pool: `min(cpuCount * 2 + 1, 10)` connections per instance
- With 3 API instances: up to 30 DB connections from API + workers
- PostgreSQL default max_connections = 100 → leaves 70 for admin/monitoring
- Recommendation: adjust `DATABASE_URL?connection_limit=N` per instance if needed

---

## 5. Queue Scaling Strategy

### Current Setup
- Single BullMQ queue: `domain-events`
- 10 event types routed by handler
- Configurable concurrency: `WORKER_CONCURRENCY` (default 5)

### Scaling Workers
Add more worker processes (same queue, different processes):
```bash
WORKER_CONCURRENCY=5 node dist/workers/worker.js &
WORKER_CONCURRENCY=5 node dist/workers/worker.js &
WORKER_CONCURRENCY=5 node dist/workers/worker.js &
```
BullMQ ensures each job is processed by exactly one worker (atomic job locking via Redis).

### Priority Queue (Queue Priority vs. Incident Priority)
These are distinct concepts:

| Concept            | What it means                                                  |
|--------------------|----------------------------------------------------------------|
| **Incident priority** | Business priority score (0–100) calculated by the algorithm. Determines which incidents get resources first in the greedy allocator. |
| **Queue priority**    | BullMQ job priority. Determines which jobs are dequeued first when workers are busy. Could be used to process CRITICAL incident events before LOW ones. |

Current implementation uses a single queue with no BullMQ-level priority differentiation.
The incident priority algorithm (Parts 5–6) is unaffected by queue priority.

### Backpressure
- Outbox publisher processes BATCH_SIZE=50 events per poll tick
- If events arrive faster than workers can process: queue grows in Redis
- Jobs are preserved (not dropped) — at-least-once delivery
- Monitor: `BullMQ queue depth` + Redis memory
- Alert threshold: queue depth > 1000 pending jobs

---

## 6. Worker Scaling Considerations

| `WORKER_CONCURRENCY` | DB connections used | CPU% | Queue throughput |
|---------------------|--------------------|----- |-----------------|
| 2                    | ~2                 | Low  | ~20 jobs/min    |
| 5 (default)          | ~5                 | Med  | ~50 jobs/min    |
| 10                   | ~10                | High | ~100 jobs/min   |
| 20                   | ~20                | High | ~200 jobs/min   |

Relationship: higher concurrency = more DB connections consumed.
Never set concurrency > (PostgreSQL max_connections / total instances / 2).

---

## 7. Load Testing Methodology

### Tool
k6 (https://k6.io) — modern, scriptable, outputs structured metrics.

### Installation
```bash
# Windows
winget install k6 --source winget
# Or download from: https://github.com/grafana/k6/releases

# macOS
brew install k6

# Linux
sudo gpg -k && sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
  https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Test Suite
| Test File                       | Purpose                                        |
|---------------------------------|------------------------------------------------|
| `load-tests/health.js`          | Liveness + readiness under load                |
| `load-tests/incidents.js`       | Incident CRUD with pagination                  |
| `load-tests/assignments.js`     | Concurrency + conflict prevention              |
| `load-tests/reoptimization.js`  | Resource failure + re-optimization load        |
| `load-tests/spike.js`           | Sudden traffic spike simulation                |
| `load-tests/soak.js`            | Sustained 30-minute leak detection             |

### Environment Variables Required
```bash
LOAD_TEST_BASE_URL=http://localhost:5000
LOAD_TEST_EMAIL=admin@test.local
LOAD_TEST_PASSWORD=TestPassword123!
```

**IMPORTANT: NEVER run load tests against the production database.**

---

## 8. Baseline Results

> **NOTE:** The numbers below are TARGETS based on architecture design, not measured values.
> Actual results depend on: hardware, PostgreSQL server specs, Redis specs, dataset size, and network latency.
> Run the tests yourself and record actual values in Section 9.

### How to collect baseline:
```bash
# Start the server
npm run dev

# In another terminal:
k6 run -e LOAD_TEST_EMAIL=admin@test.local \
        -e LOAD_TEST_PASSWORD=TestPassword123! \
        load-tests/health.js
```

### Target Baseline (10 VUs, 30 seconds, small dataset)

| Metric              | Target (Local Dev) | Target (Staging)  |
|---------------------|-------------------|-------------------|
| p50 latency         | < 50ms            | < 30ms            |
| p95 latency         | < 200ms           | < 100ms           |
| p99 latency         | < 500ms           | < 250ms           |
| Error rate          | < 1%              | < 0.5%            |
| Req/sec (10 VUs)    | 50–150 req/s      | 200–500 req/s     |

### Endpoint Cost Ranking (slowest → fastest)
1. `POST /api/incidents` — DB write + priority calculation + outbox write (3 DB ops)
2. `POST /api/assignments` — transaction with 5 DB ops + constraint check
3. `POST /api/:id/reoptimize` — transaction with 8+ DB ops
4. `GET /api/incidents?sort=priority` — DB read + sort on indexed column
5. `GET /api/resources` (cache MISS) — DB read
6. `GET /api/resources` (cache HIT) — Redis read only (~1ms)
7. `GET /health` — no I/O, pure in-process

---

## 9. Actual Test Results

> Run the following commands and record results here after each test.

### Command Template
```bash
k6 run \
  -e LOAD_TEST_EMAIL=admin@test.local \
  -e LOAD_TEST_PASSWORD=TestPassword123! \
  --out json=results/$(date +%Y%m%d_%H%M%S)_test.json \
  load-tests/incidents.js
```

### Results Template

```
Test Name:       [fill in]
Date:            [fill in]
Environment:     [fill in — local / staging / cloud]
Dataset Size:    [fill in — incidents/resources/hospitals count]
Concurrency:     [fill in — VUs]
Duration:        [fill in]

Results:
  Requests/sec:  [fill in]
  p50:           [fill in ms]
  p95:           [fill in ms]
  p99:           [fill in ms]
  Error rate:    [fill in %]
  CPU (API):     [fill in %]
  Memory (API):  [fill in MB]
  DB connections:[fill in]
  Redis memory:  [fill in MB]
  Queue depth:   [fill in]

Bottleneck observed: [fill in]
```

---

## 10. Spike Test Results

> Run `npm run load:spike` and record results.

### Expected behavior during spike:
- API latency increases (acceptable: p95 < 3s)
- Rate limiting kicks in for >100 req/min per IP → HTTP 429
- Queue depth grows temporarily while workers catch up
- After spike subsides: latency returns to baseline within 30s
- No data corruption or double-assignment

### Failure modes to watch:
- PostgreSQL connection pool exhaustion → `connection timeout` errors
- Redis OOM → cache falls back gracefully, rate limiting falls back to in-process
- Worker queue saturation → events preserved in OutboxEvent table (Outbox guarantee)

---

## 11. Soak Test Results

> Run `npm run load:soak` and monitor for 30 minutes.

### What to measure every 5 minutes:
```bash
# Process memory (run from same host)
ps aux | grep node

# PostgreSQL active connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Redis memory
redis-cli INFO memory | grep used_memory_human

# Queue depth (BullMQ)
redis-cli LLEN bull:domain-events:wait
```

### Healthy soak profile:
- Process RSS: stable (no growth > 50MB over 30 minutes)
- DB connections: stable count (not growing)
- Redis memory: stable (TTL-bound keys expire)
- Latency: flat curve (no upward trend)

### Unhealthy indicators (investigate if observed):
- RSS growing > 10MB/min → memory leak in handlers
- DB connections growing → connection not released (check Prisma transaction cleanup)
- Redis keys growing unbounded → cache key generation bug (check `delPattern`)
- Latency trend upward → connection pool saturation or slow query accumulation

---

## 12. Bottleneck Analysis

### Identified Potential Bottlenecks (by design review)

#### 1. Assignment Transaction (highest risk)
```sql
BEGIN;
  SELECT incident FOR UPDATE (implicit via findUnique)
  SELECT resource FOR UPDATE (implicit)
  SELECT assignment WHERE resourceId=? AND status='ACTIVE'
  SELECT assignment WHERE incidentId=? AND status='ACTIVE'
  INSERT assignment
  UPDATE resource SET status='BUSY'
  UPDATE incident SET status='ASSIGNED'
  INSERT decision_log
  INSERT outbox_event
COMMIT;
```
- 8 operations per transaction
- Partial unique indexes prevent double-assignment at DB level
- Lock contention possible under very high concurrent assignment rate
- Mitigation: idempotency keys prevent retry storms

#### 2. Resource Availability Query
- `recommendResource()` fetches ALL resources (`findMany()`) for scoring
- With 5,000+ resources: this query returns large payload
- Mitigation: add `WHERE status='AVAILABLE'` filter (already done with index on `status`)

#### 3. Outbox Publisher Poll
- Runs every 5 seconds, fetches up to 50 PENDING events
- Under high event volume: events queue faster than published
- Mitigation: reduce `OUTBOX_POLL_INTERVAL_MS`, increase `BATCH_SIZE`, run multiple workers

#### 4. Re-optimization Engine
- Loads ALL resources for candidate evaluation (same as recommendation)
- Under resource failure storm (20+ simultaneous failures): queue depth spikes
- Mitigation: BullMQ queues preserve all jobs, workers process in order

---

## 13. Observed Capacity (Local Dev Environment)

> Fill in after running tests. The following are architecture-based estimates only.

| Configuration                | Estimated Capacity      |
|------------------------------|------------------------|
| 1 API + small dataset         | 50–200 req/sec         |
| 3 API instances + Redis cache | 150–600 req/sec        |
| With cache hits (resources/hospitals) | 3–5x improvement on cached endpoints |
| Concurrency test (100 VUs, 1 resource) | Exactly 1 assignment created, 99 conflicts |

---

## 14. Recommended Improvements

### Short-term (no architecture change)
1. **Add `select` clauses** to `recommendResource()` — avoid loading all resource fields
2. **Batch outbox publishing** — publish multiple events to Redis pipeline in one round-trip
3. **Add cursor pagination** to high-volume endpoints for real-time dashboards
4. **Index `assignments.assignedAt`** — used in ORDER BY on list endpoint
5. **Add `WORKER_CONCURRENCY` per event type** — resource-failure events processed first

### Medium-term (minor architecture change)
1. **Separate queues by priority** — `critical-events` vs `background-events` BullMQ queues
2. **Redis connection pooling** — reuse ioredis connection for cache + rate limiting
3. **Materialized views** for dashboard queries (incident count by status, resource utilization)
4. **Read replicas** for PostgreSQL — route GET queries to replica, writes to primary

### Long-term (significant change)
1. **Event sourcing** — store assignment decisions as immutable events for full audit
2. **Spatial indexes** — PostGIS for distance calculations instead of in-process Haversine
3. **CQRS** — separate read model (denormalized) for dashboard queries
4. **Message partitioning** — partition outbox by incident ID for parallel processing

---

## 15. Known Limitations

1. **Rate limiting per-instance fallback**: When Redis is unavailable, each API instance
   has its own rate limit counter. A user can hit N×limit requests by hitting all N instances.
   Acceptable for emergency response (operators need access) but worth noting.

2. **`recommendResource()` full-table scan**: The greedy allocator loads all resources.
   At 100,000+ resources, this becomes slow. Spatial indexing (PostGIS) would fix this.

3. **Singletons are process-local**: `CircuitBreaker` state, in-process rate limit counters,
   and the `_cacheService` singleton are NOT shared across processes. This is by design
   for simplicity but means circuit breaker trips on one instance don't affect others.

4. **No read replica routing**: All queries (reads and writes) go to the same PostgreSQL.
   Under heavy read load, this is the primary bottleneck.

5. **Outbox batch size is fixed at 50**: Under very high event volume, this may cause lag.
   Make `BATCH_SIZE` configurable as a future improvement.

6. **k6 tests require a running server and seeded test data**: Tests are not fully self-contained.
   A dedicated test setup script would improve CI/CD integration.

---

## 16. Production Scaling Considerations

### Connection Pool Tuning
```
DATABASE_URL=...?connection_limit=10&pool_timeout=30
```
- Each API instance: 10 connections max
- 3 instances: 30 connections to PostgreSQL
- Plus workers: 3 workers × 5 concurrency × 1 connection = 15 more
- Total: ~45 connections — well within PostgreSQL default 100

### Load Balancer Health Check
Configure load balancer to call `GET /ready` every 10 seconds.
Remove instance from rotation if response is non-2xx (database down).
Keep instance in rotation if response is `degraded` (Redis only).

### Horizontal Scaling Recipe
```bash
# 1. Start Redis (shared)
redis-server

# 2. Start PostgreSQL (shared)
# (already running)

# 3. Run API instances (stateless — add as many as needed)
PORT=5000 node dist/index.js
PORT=5001 node dist/index.js
PORT=5002 node dist/index.js

# 4. Run workers (independently scalable)
WORKER_CONCURRENCY=5 node dist/workers/worker.js
WORKER_CONCURRENCY=5 node dist/workers/worker.js

# 5. nginx config (round-robin load balancer)
upstream api {
  server localhost:5000;
  server localhost:5001;
  server localhost:5002;
}
```

### Environment Variables for Production
```bash
NODE_ENV=production
CACHE_DEFAULT_TTL_SECONDS=120    # longer cache in prod
WORKER_CONCURRENCY=10            # more concurrency if DB allows
RATE_LIMIT_MAX_REQUESTS=200      # adjust to real traffic patterns
PAGINATION_MAX_LIMIT=100         # keep bounded
OUTBOX_POLL_INTERVAL_MS=2000     # faster publishing in prod
SHUTDOWN_TIMEOUT_MS=30000        # more time for graceful shutdown
```

---

## Summary

| Layer        | Scalability Mechanism                          | Status     |
|--------------|-----------------------------------------------|------------|
| API          | Stateless, horizontally scalable              | ✅ Done    |
| Rate Limiting| Redis-backed distributed (fallback: in-process)| ✅ Done    |
| Caching      | Redis cache-aside for resources + hospitals   | ✅ Done    |
| Pagination   | All list endpoints paginated (max 100)        | ✅ Done    |
| Database     | Indexes on hot columns + connection singleton | ✅ Done    |
| Queue        | BullMQ multi-worker, configurable concurrency | ✅ Done    |
| Workers      | `WORKER_CONCURRENCY` env-configurable         | ✅ Done    |
| Load Tests   | k6 scenarios: baseline/ramp/spike/soak/concurrency | ✅ Done |
| Health/Ready | Liveness + readiness for load balancer        | ✅ Done    |
| Graceful shutdown | Cache + queue + DB closed on SIGTERM     | ✅ Done    |
